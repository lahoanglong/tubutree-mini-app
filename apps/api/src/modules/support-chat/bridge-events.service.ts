import { Injectable, Logger } from '@nestjs/common';
import type { ZaloBridgeEvent } from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { isForwardHeader } from './forward-format';
import { ReplyNotifier } from './reply-notifier';
import { parseStaffReply } from './staff-reply-parse';

type MessageEvent = Extract<ZaloBridgeEvent, { type: 'message' }>;
export type BridgeEventResult =
  | { status: 200; body: { ok: true; unknownCode?: string; conflict?: { routed: string; typed: string }; notStored?: NotStoredReason } }
  | { status: 503; body: { retry: true } };

/** Lý do một tin trả lời của nhân viên không tới khách; cầu nối đổi thành thông báo trong nhóm. */
export type NotStoredReason = 'unsupported' | 'gone' | 'empty';

const OK: BridgeEventResult = { status: 200, body: { ok: true } };
/** Quá ngần này mà forward vẫn chưa có zaloMsgId thì coi là hỏng, không giữ tin nhân viên chờ mãi. */
const PENDING_FORWARD_WINDOW_MS = 5 * 60_000;
type ConversationHit = { id: string; userId: string; code: string; customerReadAt?: Date | null };

const isP2002 = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

@Injectable()
export class BridgeEventsService {
  private readonly logger = new Logger(BridgeEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ReplyNotifier,
  ) {}

  async handle(e: ZaloBridgeEvent): Promise<BridgeEventResult> {
    if (e.type === 'message') return this.handleMessage(e);
    if (e.type === 'undo') {
      await this.recall(e.msgId);
      return OK;
    }
    if (e.type === 'state') {
      await this.saveState(e);
      return OK;
    }
    return OK;
  }

  private async markRecalled(msgId: string): Promise<number> {
    const r = await this.prisma.supportMessage.updateMany({ where: { zaloMsgId: msgId, sender: 'STAFF', recalledAt: null }, data: { recalledAt: new Date() } });
    return r.count;
  }

  /**
   * Thu hồi và tin có thể được xử lý song song hoặc ngược thứ tự. Thu hồi ghi tombstone TRƯỚC rồi mới đánh dấu hàng (nếu có);
   * tin kiểm tombstone trước khi lưu và kiểm lại sau khi lưu. Theo cặp này, dù xen kẽ thế nào cũng có một bên thấy bên kia.
   */
  private async recall(msgId: string): Promise<void> {
    await this.prisma.supportRecallTombstone.upsert({ where: { zaloMsgId: msgId }, create: { zaloMsgId: msgId }, update: {} });
    await this.markRecalled(msgId);
  }

  private hasTombstone(msgId: string): Promise<boolean> {
    return this.prisma.supportRecallTombstone.findUnique({ where: { zaloMsgId: msgId } }).then((t) => !!t);
  }

  private async handleMessage(e: MessageEvent): Promise<BridgeEventResult> {
    const text = e.text ?? '';
    // Echo của chính tin cầu nối vừa gửi (selfListen): bắt theo msgId, và theo đầu tin chuyển khi echo tới trước lúc ghi zaloMsgId.
    // Tài khoản cầu nối gõ câu thường trên điện thoại vẫn là nhân viên nên không bị lọc theo isSelf.
    if (await this.prisma.supportForward.findUnique({ where: { zaloMsgId: e.msgId } })) return OK;
    if (e.isSelf && isForwardHeader(text)) return OK;

    // Thu hồi đã tới trước tin này: bỏ tin. Tombstone giữ lại (lần gửi lại vẫn bị bỏ), việc dọn để retention lo.
    // Đánh dấu luôn cả hàng nếu đã có: lần gửi trước có thể đã lưu tin rồi chết trước bước kiểm lại sau lưu.
    if (await this.hasTombstone(e.msgId)) {
      await this.markRecalled(e.msgId);
      return OK;
    }

    const { code, body } = parseStaffReply(e.text);
    const conv = await this.findConversation(e, code);
    if (conv === 'retry') return { status: 503, body: { retry: true } };
    if (conv === 'gone') return { status: 200, body: { ok: true, notStored: 'gone' } };
    if (conv && 'unknown' in conv) return { status: 200, body: { ok: true, unknownCode: conv.unknown } };
    if (conv && 'conflict' in conv) return { status: 200, body: { ok: true, conflict: conv.conflict } };
    if (!conv) return OK;
    if (e.unsupportedType) return { status: 200, body: { ok: true, notStored: 'unsupported' } };
    if (!body && !e.imageUrl) return { status: 200, body: { ok: true, notStored: 'empty' } };

    let created: { id: string; body: string; imageUrl: string | null };
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
      if (!isP2002(err)) throw err;
      // Hàng đã có từ lần gửi trước: lần đó có thể chết trước bước kiểm lại nên kiểm ở đây, rồi không báo chuông lần nữa.
      if (await this.hasTombstone(e.msgId)) await this.markRecalled(e.msgId);
      return OK;
    }

    // Thu hồi có thể ghi tombstone sau lần kiểm đầu mà trước khi tin này lưu xong: kiểm lại sau khi lưu.
    // Lỗi ở đây ném ra để cầu nối gửi lại; lần gửi lại thấy tombstone ở lần kiểm đầu và đánh dấu hàng đã lưu.
    if (await this.hasTombstone(e.msgId)) {
      await this.markRecalled(e.msgId);
      return OK;
    }

    try {
      await this.prisma.supportConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
      await this.notifier.scheduleReplyBell(conv, created);
    } catch (err) {
      // Tin đã lưu; gửi lại sự kiện cũng chỉ đụng unique zaloMsgId nên không giúp được gì.
      this.logger.warn(`Bước phụ sau tin nhân viên ${created.id} lỗi: ${(err as Error).message}`);
    }
    return OK;
  }

  /** `gone`: hội thoại của tin trích đã bị xoá; `retry`: tin trích chưa khớp mà forward chưa kịp ghi zaloMsgId; `unknown`: mã (đầu câu hoặc đầu tin trích) không có hội thoại; `conflict`: tin trích và mã đầu câu chỉ hai khách khác nhau; null: không phải trả lời. */
  private async findConversation(
    e: MessageEvent,
    code: string | null,
  ): Promise<ConversationHit | 'retry' | 'gone' | { unknown: string } | { conflict: { routed: string; typed: string } } | null> {
    if (e.quote) {
      const quoted = await this.findByQuote(e.quote);
      if (quoted === 'gone') return 'gone';
      if (quoted && 'unknown' in quoted) return quoted;
      if (quoted) {
        // Hai tín hiệu chỉ hai khách khác nhau thì không đoán: gửi nhầm khách tệ hơn là bắt nhân viên gửi lại.
        if (code && quoted.code.toUpperCase() !== code) return { conflict: { routed: quoted.code, typed: code } };
        return quoted;
      }
      // Trích chưa khớp mà có forward đang gửi dở: chờ nó ghi zaloMsgId rồi thử lại, kể cả khi câu có #MÃ, để quy tắc conflict còn áp được.
      // Chỉ chờ khi chính sự kiện còn mới: nhóm bận không được giữ một câu trả lời ở 503 hàng giờ.
      const fresh = Number.isFinite(e.ts) && Math.abs(Date.now() - e.ts) <= PENDING_FORWARD_WINDOW_MS;
      const pending = fresh && (await this.prisma.supportForward.findFirst({
        where: { status: 'PENDING', zaloMsgId: null, createdAt: { gte: new Date(Date.now() - PENDING_FORWARD_WINDOW_MS) } },
        select: { id: true },
      }));
      if (pending) return 'retry';
    }
    if (!code) return null;
    // Mã của khách đã xoá tài khoản nằm trong sổ mã nghỉ và không bao giờ được cấp lại, nên không có hội thoại là đủ để coi là mã lạ.
    return (await this.prisma.supportConversation.findUnique({ where: { code } })) ?? { unknown: code };
  }

  /** `gone`: tin trích khớp nhưng hội thoại đã bị xoá; `unknown`: đầu tin trích mang mã không có hội thoại. */
  private async findByQuote(quote: NonNullable<MessageEvent['quote']>): Promise<ConversationHit | 'gone' | { unknown: string } | null> {
    const forward = await this.prisma.supportForward.findUnique({ where: { zaloMsgId: quote.globalMsgId } });
    // Forward khớp mà khách đã xoá: bỏ hẳn, không để rơi xuống nhánh 503 chờ mãi một tin không bao giờ khớp.
    if (forward) return (await this.prisma.supportConversation.findUnique({ where: { id: forward.conversationId } })) ?? 'gone';
    // Nhân viên trích lại chính câu trả lời trước đó của mình.
    const staffMsg = await this.prisma.supportMessage.findUnique({ where: { zaloMsgId: quote.globalMsgId, sender: 'STAFF' }, select: { conversationId: true } });
    if (staffMsg) return (await this.prisma.supportConversation.findUnique({ where: { id: staffMsg.conversationId } })) ?? 'gone';
    // Forward kết thúc UNKNOWN thì chưa có zaloMsgId, nhưng đầu tin được trích vẫn mang mã hội thoại.
    const quotedCode = quote.text && isForwardHeader(quote.text) ? parseStaffReply(quote.text).code : null;
    if (!quotedCode) return null;
    return (await this.prisma.supportConversation.findUnique({ where: { code: quotedCode } })) ?? { unknown: quotedCode };
  }

  private async saveState(e: Extract<ZaloBridgeEvent, { type: 'state' }>): Promise<void> {
    const prev = await this.prisma.supportBridgeStatus.findUnique({ where: { id: 'main' } });
    // since chỉ nhích khi trạng thái đổi: sự kiện lặp cùng trạng thái không được làm "mất kết nối từ lúc nào" trôi theo.
    const since = prev && prev.state === e.state ? prev.since : new Date(e.since);
    const fields = { state: e.state, since, lastError: e.lastError, zaloUid: e.zaloUid, displayName: e.displayName, checkedAt: new Date() };
    await this.prisma.supportBridgeStatus.upsert({ where: { id: 'main' }, create: { id: 'main', ...fields }, update: fields });
  }
}
