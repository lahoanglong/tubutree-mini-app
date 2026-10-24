import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Prisma, SupportConversation, SupportMessage } from '@prisma/client';
import type {
  SupportChatContext,
  SupportChatMessageDTO,
  SupportChatPageDTO,
  SupportChatSendInput,
  SupportChatThreadDTO,
  SupportSender as SupportSenderDTO,
} from '@tubutree/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { QUEUE_SUPPORT_CHAT_FORWARD } from '../../jobs/queues';
import { withQueueTimeout } from '../../jobs/queue-timeout';
import { startOfVnDay, vnDateKey } from '../../common/vn-time';
import { isWithinHours } from './chat-hours';
import { issueConversationCode } from './conversation-code';
import { CHAT_ENABLED_KEY, CHAT_HOURS_KEY, CHAT_OFF_HOURS_TEXT_KEY, DEFAULT_CHAT_HOURS, DEFAULT_OFF_HOURS_TEXT } from './support-chat.config';

export const SUPPORT_FORWARD_JOB = 'forward';
/** Gộp các tin khách gửi liền nhau thành một tin chuyển. */
export const FORWARD_DELAY_MS = 15_000;
export const PAGE_SIZE = 50;
export const MAX_MESSAGES_PER_DAY = 200;
const SLOW_AFTER_MS = 10 * 60_000;
const CODE_ATTEMPTS = 8;

export const CHAT_DISABLED_MESSAGE = 'Chat với Tubu Tree đang tạm đóng. Cần hỗ trợ, gọi hotline.';
export const CHAT_BLOCKED_MESSAGE = 'Bạn tạm thời không gửi được tin. Cần hỗ trợ, gọi hotline.';

type MessageRow = Pick<SupportMessage, 'id' | 'sender' | 'body' | 'imageUrl' | 'context' | 'clientMsgId' | 'createdAt'>;

/** Không có staffName, adminUserId, zaloMsgId, forwardId: khách chỉ thấy "Tubu Tree". */
export function toCustomerDTO(m: MessageRow): SupportChatMessageDTO {
  return {
    id: m.id,
    sender: m.sender as SupportSenderDTO,
    body: m.body,
    imageUrl: m.imageUrl,
    context: (m.context as SupportChatContext | null) ?? null,
    clientMsgId: m.clientMsgId,
    createdAt: m.createdAt.toISOString(),
  };
}

const isP2002 = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

// Tin STAFF bị thu hồi trên Zalo phải biến mất khỏi màn khách.
const VISIBLE: Prisma.SupportMessageWhereInput = { OR: [{ sender: { not: 'STAFF' } }, { recalledAt: null }] };

@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @InjectQueue(QUEUE_SUPPORT_CHAT_FORWARD) private readonly forwardQueue: Queue,
  ) {}

  async getThread(userId: string): Promise<SupportChatThreadDTO> {
    const conv = await this.getOrCreate(userId);
    const [rows, enabled, slow] = await Promise.all([
      this.prisma.supportMessage.findMany({
        where: { conversationId: conv.id, ...VISIBLE },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
      }),
      this.config.get<boolean>(CHAT_ENABLED_KEY, false),
      this.isSlow(),
    ]);
    const hasMore = rows.length > PAGE_SIZE;
    return {
      code: conv.code,
      blocked: conv.blockedAt !== null,
      enabled,
      slow,
      messages: rows.slice(0, PAGE_SIZE).reverse().map(toCustomerDTO),
      hasMore,
    };
  }

  async page(userId: string, q: { after?: string; before?: string }): Promise<SupportChatPageDTO> {
    const conv = await this.getOrCreate(userId);
    const forward = !!q.after;
    const cursorId = q.after || q.before;
    if (!cursorId) {
      const t = await this.getThread(userId);
      return { messages: t.messages, hasMore: t.hasMore };
    }
    const cursor = await this.prisma.supportMessage.findFirst({
      where: { id: cursorId, conversationId: conv.id },
      select: { id: true, createdAt: true },
    });
    if (!cursor) return { messages: [], hasMore: false };

    const tuple: Prisma.SupportMessageWhereInput = {
      OR: forward
        ? [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }]
        : [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }],
    };
    const dir = forward ? 'asc' : 'desc';
    const rows = await this.prisma.supportMessage.findMany({
      where: { conversationId: conv.id, AND: [tuple, VISIBLE] },
      orderBy: [{ createdAt: dir }, { id: dir }],
      take: PAGE_SIZE + 1,
    });
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE);
    return { messages: (forward ? page : page.reverse()).map(toCustomerDTO), hasMore };
  }

  async send(userId: string, input: SupportChatSendInput, source: 'MINIAPP' | 'WEB'): Promise<SupportChatMessageDTO> {
    const conv = await this.getOrCreate(userId);
    // Thử lại tin đã lưu phải trả tin cũ dù khách vừa bị chặn hay chat vừa tắt, kẻo khách thấy tin đã lưu là lỗi.
    const existing = await this.findByClientMsgId(conv.id, input.clientMsgId);
    if (existing) return toCustomerDTO(existing);

    const body = (input.body ?? '').trim();
    if (!body && !input.imageUrl) throw new BadRequestException('Cần nhập nội dung hoặc gửi ảnh.');

    const enabled = await this.config.get<boolean>(CHAT_ENABLED_KEY, false);
    if (!enabled) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'CHAT_DISABLED', message: CHAT_DISABLED_MESSAGE });
    if (conv.blockedAt) throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'CHAT_BLOCKED', message: CHAT_BLOCKED_MESSAGE });

    const now = new Date();
    const context = await this.ownedContext(userId, input.context);
    let created: SupportMessage;
    try {
      // Đếm và tạo dưới cùng một khoá: gửi song song không cùng đọc "còn chỗ" rồi cùng ghi vượt trần ngày.
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support-chat-send:${conv.id}`}))`;
        const dup = await tx.supportMessage.findFirst({ where: { conversationId: conv.id, clientMsgId: input.clientMsgId } });
        if (dup) return { row: dup, fresh: false };
        const sentToday = await tx.supportMessage.count({
          where: { conversationId: conv.id, sender: 'CUSTOMER', createdAt: { gte: startOfVnDay(now) } },
        });
        if (sentToday >= MAX_MESSAGES_PER_DAY) {
          throw new HttpException({ statusCode: 429, error: 'Too Many Requests', code: 'CHAT_DAILY_LIMIT', message: 'Bạn đã gửi quá nhiều tin hôm nay. Cần hỗ trợ, gọi hotline.' }, HttpStatus.TOO_MANY_REQUESTS);
        }
        const row = await tx.supportMessage.create({
          data: {
            conversationId: conv.id,
            sender: 'CUSTOMER',
            source,
            body,
            imageUrl: input.imageUrl ?? null,
            context: context ? (context as Prisma.InputJsonValue) : undefined,
            clientMsgId: input.clientMsgId,
          },
        });
        return { row, fresh: true };
      });
      if (!result.fresh) return toCustomerDTO(result.row);
      created = result.row;
    } catch (e) {
      // Hai request cùng clientMsgId đua nhau: bên thua trả tin của bên thắng, không đặt lịch lần nữa.
      if (!isP2002(e)) throw e;
      const winner = await this.findByClientMsgId(conv.id, input.clientMsgId);
      if (!winner) throw e;
      return toCustomerDTO(winner);
    }

    try {
      await this.scheduleForward(conv.id);
    } catch (e) {
      // Tin đã lưu; chỉ mất lịch chuyển. Bộ quét tin chưa chuyển sẽ nhặt lại.
      this.logger.warn(`Không đặt được lịch chuyển hội thoại ${conv.id}: ${(e as Error).message}`);
    }
    try {
      await this.prisma.supportConversation.update({ where: { id: conv.id }, data: { lastMessageAt: created.createdAt } });
      await this.maybeOffHoursNotice(conv, now);
    } catch (e) {
      // Lời nhắn ngoài giờ chỉ là phụ: lỗi ở đây không được làm hỏng tin đã lưu.
      this.logger.warn(`Bước phụ sau khi lưu tin hội thoại ${conv.id} lỗi: ${(e as Error).message}`);
    }
    return toCustomerDTO(created);
  }

  /** Mã đơn đi tới nhân viên như một dòng hệ thống đáng tin, nên chỉ giữ khi đơn thuộc chính người gửi (mã đơn lấy từ URL, dễ nhầm hoặc bị chép). */
  private async ownedContext(userId: string, context: SupportChatSendInput['context']): Promise<SupportChatSendInput['context']> {
    if (!context?.orderCode) return context;
    const { orderCode, ...rest } = context;
    const own = await this.prisma.order.findFirst({ where: { code: orderCode, userId }, select: { id: true } });
    const kept = own ? context : rest;
    return Object.keys(kept).length > 0 ? kept : undefined;
  }

  /**
   * `ids`: các tin STAFF/SYSTEM màn khách thực sự đã hiển thị, đánh dấu từng tin (seenAt) chứ không theo thời điểm: tin commit muộn
   * hoặc trùng createdAt với tin đã hiển thị không bị coi là đã thấy. Không có `ids` (Mini App bản cũ) thì đánh dấu mọi tin
   * có createdAt tới tin `upToId`, hoặc tới bây giờ.
   */
  async markRead(userId: string, input: { ids?: string[]; upToId?: string } = {}): Promise<{ ok: true }> {
    const conv = await this.prisma.supportConversation.findUnique({ where: { userId }, select: { id: true } });
    if (!conv) return { ok: true };
    const now = new Date();
    const staffRows = { conversationId: conv.id, sender: { in: ['STAFF', 'SYSTEM'] as ('STAFF' | 'SYSTEM')[] }, seenAt: null };
    if (input.ids) {
      if (input.ids.length > 0) {
        await this.prisma.supportMessage.updateMany({ where: { id: { in: input.ids }, ...staffRows }, data: { seenAt: now } });
        // Màn chat luôn vẽ trang mới nhất (PAGE_SIZE tin): tin cũ hơn ranh giới đó là lịch sử khách đã mở, nên không kẹt "chưa đọc" mãi.
        // Rủi ro commit muộn/trùng thời điểm chỉ ở sát tin mới nhất, không ở 50 tin trước.
        const [boundary] = await this.prisma.supportMessage.findMany({
          where: { conversationId: conv.id, ...VISIBLE },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: PAGE_SIZE - 1,
          take: 1,
          select: { id: true, createdAt: true },
        });
        if (boundary) {
          await this.prisma.supportMessage.updateMany({
            where: { ...staffRows, OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] },
            data: { seenAt: now },
          });
        }
      }
    } else {
      const rendered = input.upToId ? await this.prisma.supportMessage.findFirst({ where: { id: input.upToId, conversationId: conv.id }, select: { createdAt: true } }) : null;
      await this.prisma.supportMessage.updateMany({ where: { ...staffRows, createdAt: { lte: rendered?.createdAt ?? now } }, data: { seenAt: now } });
    }
    // Chỉ tiến lên: một yêu cầu đến muộn không được kéo mốc lùi lại.
    await this.prisma.supportConversation.updateMany({
      where: { id: conv.id, OR: [{ customerReadAt: null }, { customerReadAt: { lt: now } }] },
      data: { customerReadAt: now },
    });
    return { ok: true };
  }

  async unreadCount(userId: string): Promise<number> {
    const conv = await this.prisma.supportConversation.findUnique({ where: { userId } });
    if (!conv) return 0;
    return this.prisma.supportMessage.count({
      where: {
        conversationId: conv.id,
        sender: { in: ['STAFF', 'SYSTEM'] },
        recalledAt: null,
        seenAt: null,
      },
    });
  }

  scheduleForward(conversationId: string): Promise<void> {
    return withQueueTimeout(this.scheduleForwardUnbounded(conversationId), `${QUEUE_SUPPORT_CHAT_FORWARD} conv-${conversationId}`);
  }

  /**
   * BullMQ coi job cùng jobId đang chạy là trùng nên tin gửi lúc job đang chạy sẽ không được đặt lịch.
   * Vì vậy khi job chính đang ACTIVE ta đặt thêm job `-next`; bộ xử lý nhận tin nguyên tử nên hai job chồng nhau vẫn an toàn.
   */
  private async scheduleForwardUnbounded(conversationId: string): Promise<void> {
    const mainId = `conv-${conversationId}`;
    const mainState = await this.jobState(mainId);
    if (mainState === 'waiting' || mainState === 'delayed') return;
    if (mainState === 'active') {
      const nextId = `${mainId}-next`;
      const nextState = await this.jobState(nextId);
      if (nextState === 'waiting' || nextState === 'delayed') return;
      await this.addForwardJob(conversationId, nextId);
      return;
    }
    await this.addForwardJob(conversationId, mainId);
  }

  private async jobState(jobId: string): Promise<string | null> {
    const job = await this.forwardQueue.getJob(jobId);
    return job ? job.getState() : null;
  }

  private async addForwardJob(conversationId: string, jobId: string): Promise<void> {
    // Job đã xong vẫn giữ hash nên phải gỡ, nếu không add bị bỏ qua như trùng.
    const old = await this.forwardQueue.getJob(jobId);
    if (old) {
      const state = await old.getState();
      if (state === 'completed' || state === 'failed') await old.remove();
    }
    await this.forwardQueue.add(SUPPORT_FORWARD_JOB, { conversationId }, { jobId, delay: FORWARD_DELAY_MS });
  }

  private findByClientMsgId(conversationId: string, clientMsgId: string) {
    return this.prisma.supportMessage.findFirst({ where: { conversationId, clientMsgId } });
  }

  private async maybeOffHoursNotice(conv: SupportConversation, now: Date): Promise<void> {
    const hours = await this.config.get(CHAT_HOURS_KEY, { ...DEFAULT_CHAT_HOURS });
    if (isWithinHours(now, hours)) return;
    const today = vnDateKey(now);
    if (conv.lastOffHoursNoticeOn === today) return;
    // Chiếm lượt bằng updateMany có điều kiện: hai tin đến cùng lúc chỉ một bên nhắn.
    const claim = await this.prisma.supportConversation.updateMany({
      where: { id: conv.id, OR: [{ lastOffHoursNoticeOn: null }, { lastOffHoursNoticeOn: { not: today } }] },
      data: { lastOffHoursNoticeOn: today },
    });
    if (claim.count === 0) return;
    const text = await this.config.get(CHAT_OFF_HOURS_TEXT_KEY, DEFAULT_OFF_HOURS_TEXT);
    await this.prisma.supportMessage.create({
      data: { conversationId: conv.id, sender: 'SYSTEM', source: 'SYSTEM', body: text },
    });
  }

  private async isSlow(): Promise<boolean> {
    const row = await this.prisma.supportBridgeStatus.findUnique({ where: { id: 'main' } });
    return !!row && row.state !== 'CONNECTED' && Date.now() - row.since.getTime() > SLOW_AFTER_MS;
  }

  private async getOrCreate(userId: string): Promise<SupportConversation> {
    const found = await this.prisma.supportConversation.findUnique({ where: { userId } });
    if (found) return found;
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      try {
        return await this.prisma.supportConversation.create({ data: { userId, code: await issueConversationCode(this.prisma) } });
      } catch (e) {
        if (!isP2002(e)) throw e;
        // P2002 có thể do userId (request song song đã tạo) hoặc code trùng.
        const raced = await this.prisma.supportConversation.findUnique({ where: { userId } });
        if (raced) return raced;
      }
    }
    throw new ConflictException('Không tạo được hội thoại, thử lại sau.');
  }
}
