import { Injectable, Logger } from '@nestjs/common';
import type { ZaloBridgeEvent } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isForwardHeader } from './forward-format';
import { parseStaffReply } from './staff-reply-parse';

type MessageEvent = Extract<ZaloBridgeEvent, { type: 'message' }>;
export type BridgeEventResult =
  | { status: 200; body: { ok: true; unknownCode?: string; conflict?: { routed: string; typed: string } } }
  | { status: 503; body: { retry: true } };

const OK: BridgeEventResult = { status: 200, body: { ok: true } };
/** Quá ngần này mà forward vẫn chưa có zaloMsgId thì coi là hỏng, không giữ tin nhân viên chờ mãi. */
const PENDING_FORWARD_WINDOW_MS = 5 * 60_000;
/** Chuông luôn báo (gộp trong 10 phút), kể cả khi khách đang mở màn chat: API không biết chắc khách còn xem, mà bỏ sót chuông thì khách lỡ câu trả lời. */
export const NOTIFY_DEDUPE_MS = 10 * 60_000;
const PREVIEW_MAX = 60;
const IMAGE_PREVIEW = 'Ảnh từ Tubu Tree';

type ConversationHit = { id: string; userId: string; code: string };

const isP2002 = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

/** Dòng ngắn cho chuông: không số điện thoại (nhân viên có thể gõ tay), cắt đúng 60 ký tự. */
export function replyPreview(body: string, imageUrl: string | null): string {
  const text = body.replace(/\d[\d .-]{6,}\d/g, '…').replace(/\s+/g, ' ').trim();
  if (!text) return imageUrl ? IMAGE_PREVIEW : '';
  // Cắt theo ký tự (code point), không theo đơn vị UTF-16: cắt giữa cặp thay thế của emoji sinh ký tự hỏng.
  const chars = Array.from(text);
  return chars.length <= PREVIEW_MAX ? text : `${chars.slice(0, PREVIEW_MAX - 1).join('')}…`;
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
    if (conv && 'conflict' in conv) return { status: 200, body: { ok: true, conflict: conv.conflict } };
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

  /** `retry`: chưa khớp nhưng forward chưa kịp ghi zaloMsgId; `unknown`: mã đầu câu không có hội thoại; `conflict`: tin trích và mã đầu câu chỉ hai khách khác nhau; null: không phải trả lời. */
  private async findConversation(e: MessageEvent, code: string | null): Promise<ConversationHit | 'retry' | 'unknown' | { conflict: { routed: string; typed: string } } | null> {
    if (e.quote) {
      const quoted = await this.findByQuote(e.quote);
      if (quoted === 'gone') return null;
      if (quoted) {
        // Hai tín hiệu chỉ hai khách khác nhau thì không đoán: gửi nhầm khách tệ hơn là bắt nhân viên gửi lại.
        if (code && quoted.code.toUpperCase() !== code) return { conflict: { routed: quoted.code, typed: code } };
        return quoted;
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

  /** `gone`: tin trích khớp nhưng hội thoại đã bị xoá. */
  private async findByQuote(quote: NonNullable<MessageEvent['quote']>): Promise<ConversationHit | 'gone' | null> {
    const forward = await this.prisma.supportForward.findUnique({ where: { zaloMsgId: quote.globalMsgId } });
    // Forward khớp mà khách đã xoá: bỏ hẳn, không để rơi xuống nhánh 503 chờ mãi một tin không bao giờ khớp.
    if (forward) return (await this.prisma.supportConversation.findUnique({ where: { id: forward.conversationId } })) ?? 'gone';
    // Nhân viên trích lại chính câu trả lời trước đó của mình.
    const staffMsg = await this.prisma.supportMessage.findUnique({ where: { zaloMsgId: quote.globalMsgId, sender: 'STAFF' }, select: { conversationId: true } });
    if (staffMsg) return (await this.prisma.supportConversation.findUnique({ where: { id: staffMsg.conversationId } })) ?? 'gone';
    // Forward kết thúc UNKNOWN thì chưa có zaloMsgId, nhưng đầu tin được trích vẫn mang mã hội thoại.
    const quotedCode = quote.text && isForwardHeader(quote.text) ? parseStaffReply(quote.text).code : null;
    return quotedCode ? this.prisma.supportConversation.findUnique({ where: { code: quotedCode } }) : null;
  }

  private async saveState(e: Extract<ZaloBridgeEvent, { type: 'state' }>): Promise<void> {
    const prev = await this.prisma.supportBridgeStatus.findUnique({ where: { id: 'main' } });
    // since chỉ nhích khi trạng thái đổi: sự kiện lặp cùng trạng thái không được làm "mất kết nối từ lúc nào" trôi theo.
    const since = prev && prev.state === e.state ? prev.since : new Date(e.since);
    const fields = { state: e.state, since, lastError: e.lastError, zaloUid: e.zaloUid, displayName: e.displayName, checkedAt: new Date() };
    await this.prisma.supportBridgeStatus.upsert({ where: { id: 'main' }, create: { id: 'main', ...fields }, update: fields });
  }
}
