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
import { addGomdonJob } from '../integrations/gomdon/gomdon-queue';
import { startOfVnDay, vnDateKey } from '../../common/vn-time';
import { isWithinHours } from './chat-hours';
import { newConversationCode } from './conversation-code';
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
    const cursorId = q.after ?? q.before;
    if (!cursorId) {
      const t = await this.getThread(userId);
      return { messages: t.messages, hasMore: t.hasMore };
    }
    const cursor = await this.prisma.supportMessage.findFirst({
      where: { id: cursorId, conversationId: conv.id },
      select: { id: true, createdAt: true },
    });
    if (!cursor) return { messages: [], hasMore: false };

    const forward = q.after !== undefined;
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
    const body = (input.body ?? '').trim();
    if (!body && !input.imageUrl) throw new BadRequestException('Cần nhập nội dung hoặc gửi ảnh.');

    const enabled = await this.config.get<boolean>(CHAT_ENABLED_KEY, false);
    if (!enabled) throw new ConflictException({ statusCode: 409, error: 'Conflict', code: 'CHAT_DISABLED', message: CHAT_DISABLED_MESSAGE });
    const conv = await this.getOrCreate(userId);
    if (conv.blockedAt) throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', code: 'CHAT_BLOCKED', message: CHAT_BLOCKED_MESSAGE });

    const existing = await this.findByClientMsgId(conv.id, input.clientMsgId);
    if (existing) return toCustomerDTO(existing);

    const now = new Date();
    const sentToday = await this.prisma.supportMessage.count({
      where: { conversationId: conv.id, sender: 'CUSTOMER', createdAt: { gte: startOfVnDay(now) } },
    });
    if (sentToday >= MAX_MESSAGES_PER_DAY) {
      throw new HttpException({ statusCode: 429, error: 'Too Many Requests', code: 'CHAT_DAILY_LIMIT', message: 'Bạn đã gửi quá nhiều tin hôm nay. Cần hỗ trợ, gọi hotline.' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    let created: SupportMessage;
    try {
      created = await this.prisma.supportMessage.create({
        data: {
          conversationId: conv.id,
          sender: 'CUSTOMER',
          source,
          body,
          imageUrl: input.imageUrl ?? null,
          context: input.context ? (input.context as Prisma.InputJsonValue) : undefined,
          clientMsgId: input.clientMsgId,
        },
      });
    } catch (e) {
      // Hai request cùng clientMsgId đua nhau: bên thua trả tin của bên thắng, không đặt lịch lần nữa.
      if (!isP2002(e)) throw e;
      const winner = await this.findByClientMsgId(conv.id, input.clientMsgId);
      if (!winner) throw e;
      return toCustomerDTO(winner);
    }

    await this.prisma.supportConversation.update({ where: { id: conv.id }, data: { lastMessageAt: created.createdAt } });
    await this.maybeOffHoursNotice(conv, now);
    try {
      await this.scheduleForward(conv.id);
    } catch (e) {
      // Tin đã lưu; chỉ mất lịch chuyển. Bộ xử lý quét tin chưa chuyển sẽ nhặt lại.
      this.logger.warn(`Không đặt được lịch chuyển hội thoại ${conv.id}: ${(e as Error).message}`);
    }
    return toCustomerDTO(created);
  }

  async markRead(userId: string): Promise<{ ok: true }> {
    await this.prisma.supportConversation.updateMany({ where: { userId }, data: { customerReadAt: new Date() } });
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
        ...(conv.customerReadAt ? { createdAt: { gt: conv.customerReadAt } } : {}),
      },
    });
  }

  scheduleForward(conversationId: string): Promise<void> {
    return addGomdonJob(this.forwardQueue, SUPPORT_FORWARD_JOB, { conversationId }, `conv-${conversationId}`, { delay: FORWARD_DELAY_MS });
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
        return await this.prisma.supportConversation.create({ data: { userId, code: newConversationCode() } });
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
