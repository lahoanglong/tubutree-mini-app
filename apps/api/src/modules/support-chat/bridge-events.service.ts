import { Injectable, Logger } from '@nestjs/common';
import type { ZaloBridgeEvent } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isForwardHeader } from './forward-format';
import { parseStaffReply } from './staff-reply-parse';

type MessageEvent = Extract<ZaloBridgeEvent, { type: 'message' }>;
export type BridgeEventResult =
  | { status: 200; body: { ok: true; unknownCode?: string } }
  | { status: 503; body: { retry: true } };

const OK: BridgeEventResult = { status: 200, body: { ok: true } };
/** Quá ngần này mà forward vẫn chưa có zaloMsgId thì coi là hỏng, không giữ tin nhân viên chờ mãi. */
const PENDING_FORWARD_WINDOW_MS = 5 * 60_000;
const NOTIFY_DEDUPE_MS = 10 * 60_000;
const PREVIEW_MAX = 60;
const IMAGE_PREVIEW = 'Ảnh từ Tubu Tree';

const isP2002 = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

/** Dòng ngắn cho chuông: không số điện thoại (nhân viên có thể gõ tay), cắt đúng 60 ký tự. */
export function replyPreview(body: string, imageUrl: string | null): string {
  const text = body.replace(/\d[\d .-]{6,}\d/g, '…').replace(/\s+/g, ' ').trim();
  if (!text) return imageUrl ? IMAGE_PREVIEW : '';
  return text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX - 1)}…`;
}

@Injectable()
export class BridgeEventsService {
  private readonly logger = new Logger(BridgeEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(e: ZaloBridgeEvent): Promise<BridgeEventResult> {
    if (e.type === 'message') return this.handleMessage(e);
    if (e.type === 'undo') {
      await this.prisma.supportMessage.updateMany({
        where: { zaloMsgId: e.msgId, sender: 'STAFF', recalledAt: null },
        data: { recalledAt: new Date() },
      });
      return OK;
    }
    if (e.type === 'state') {
      await this.saveState(e);
      return OK;
    }
    return OK;
  }

  private async handleMessage(e: MessageEvent): Promise<BridgeEventResult> {
    const text = e.text ?? '';
    // Echo của chính tin cầu nối vừa gửi (selfListen): bắt theo msgId, và theo đầu tin chuyển khi echo tới trước lúc ghi zaloMsgId.
    // Tài khoản cầu nối gõ câu thường trên điện thoại vẫn là nhân viên nên không bị lọc theo isSelf.
    if (await this.prisma.supportForward.findUnique({ where: { zaloMsgId: e.msgId } })) return OK;
    if (e.isSelf && isForwardHeader(text)) return OK;

    const { code, body } = parseStaffReply(e.text);
    const conv = await this.findConversation(e, code);
    if (conv === 'retry') return { status: 503, body: { retry: true } };
    if (conv === 'unknown') return { status: 200, body: { ok: true, unknownCode: code! } };
    if (!conv) return OK;
    if (!body && !e.imageUrl) return OK;

    let created: { id: string };
    try {
      // createdAt để DB đặt: sự kiện phát lại từ hộp thư đi phải xếp sau con trỏ `after` của khách, không thì khách hỏi định kỳ không thấy.
      created = await this.prisma.supportMessage.create({
        data: {
          conversationId: conv.id,
          sender: 'STAFF',
          source: 'ZALO',
          body,
          imageUrl: e.imageUrl,
          zaloMsgId: e.msgId,
          staffName: e.dName || null,
        },
      });
    } catch (err) {
      if (isP2002(err)) return OK;
      throw err;
    }

    try {
      await this.prisma.supportConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      await this.notifications.notify(
        conv.userId,
        'SUPPORT_CHAT_REPLY',
        { preview: replyPreview(body, e.imageUrl), route: '/chat' },
        { dedupeKey: `support-reply-${conv.id}`, dedupeWithinMs: NOTIFY_DEDUPE_MS },
      );
    } catch (err) {
      // Tin đã lưu; gửi lại sự kiện cũng chỉ đụng unique zaloMsgId nên không giúp được gì.
      this.logger.warn(`Bước phụ sau tin nhân viên ${created.id} lỗi: ${(err as Error).message}`);
    }
    return OK;
  }

  /** `retry`: chưa khớp nhưng forward chưa kịp ghi zaloMsgId; `unknown`: mã đầu câu không có hội thoại; null: không phải trả lời. */
  private async findConversation(
    e: MessageEvent,
    code: string | null,
  ): Promise<{ id: string; userId: string } | 'retry' | 'unknown' | null> {
    if (e.quote) {
      const forward = await this.prisma.supportForward.findUnique({ where: { zaloMsgId: e.quote.globalMsgId } });
      if (forward) {
        const conv = await this.prisma.supportConversation.findUnique({ where: { id: forward.conversationId } });
        if (conv) return conv;
      }
    }
    const byCode = code ? await this.prisma.supportConversation.findUnique({ where: { code } }) : null;
    if (byCode) return byCode;
    if (e.quote) {
      const pending = await this.prisma.supportForward.findFirst({
        where: { status: 'PENDING', zaloMsgId: null, createdAt: { gte: new Date(Date.now() - PENDING_FORWARD_WINDOW_MS) } },
        select: { id: true },
      });
      if (pending) return 'retry';
    }
    return code ? 'unknown' : null;
  }

  private async saveState(e: Extract<ZaloBridgeEvent, { type: 'state' }>): Promise<void> {
    const prev = await this.prisma.supportBridgeStatus.findUnique({ where: { id: 'main' } });
    // since chỉ nhích khi trạng thái đổi: sự kiện lặp cùng trạng thái không được làm "mất kết nối từ lúc nào" trôi theo.
    const since = prev && prev.state === e.state ? prev.since : new Date(e.since);
    const fields = { state: e.state, since, lastError: e.lastError, zaloUid: e.zaloUid, displayName: e.displayName, checkedAt: new Date() };
    await this.prisma.supportBridgeStatus.upsert({ where: { id: 'main' }, create: { id: 'main', ...fields }, update: fields });
  }
}
