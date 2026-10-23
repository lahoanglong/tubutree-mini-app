import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { SupportChatContext } from '@tubutree/shared-types';
import type { SupportForward, SupportMessage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { QUEUE_SUPPORT_CHAT_FORWARD } from '../../jobs/queues';
import { BridgeClient } from './bridge-client';
import { formatForward, forwardItemLength } from './forward-format';
import { SupportChatService } from './support-chat.service';
import { CHAT_GROUP_KEY } from './support-chat.config';

/** Một tin nhóm Zalo chứa tối đa chừng này ký tự nội dung khách; phần dư để job sau. */
const MAX_FORWARD_CHARS = 3000;

interface ForwardJobData {
  conversationId: string;
}

/**
 * Gom tin khách chưa chuyển của một hội thoại thành một SupportForward rồi gửi qua cầu nối.
 * Mỗi lượt chỉ xử lý một forward; tin còn lại (vượt 3.000 ký tự, đến giữa chừng) được đặt lịch lại ở cuối lượt.
 * Gửi lại cùng idempotencyKey = forward.id là an toàn vì cầu nối chống đăng đôi.
 */
@Processor(QUEUE_SUPPORT_CHAT_FORWARD)
export class SupportChatForwardProcessor extends WorkerHost {
  private readonly logger = new Logger(SupportChatForwardProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly bridge: BridgeClient,
    private readonly chat: SupportChatService,
  ) {
    super();
  }

  async process(job: Job<ForwardJobData>): Promise<void> {
    const { conversationId } = job.data;
    const conv = await this.prisma.supportConversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.blockedAt) return;

    const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    // Forward còn dang dở (lượt trước hỏng giữa chừng) phải xong trước, nếu không tin sẽ bị gửi hai lần dưới hai forward.
    const pending = await this.prisma.supportForward.findFirst({
      where: { conversationId, status: 'PENDING', zaloMsgId: null },
      orderBy: { createdAt: 'asc' },
    });
    const claimed = pending ? { forward: pending, messages: await this.messagesOf(pending.id, conversationId) } : await this.claim(conversationId);
    if (!claimed) return;

    const retryError = await this.sendForward(conv, claimed.forward, claimed.messages, final);
    await this.rescheduleIfLeft(conversationId);
    if (retryError) throw new Error(retryError);
  }

  private messagesOf(forwardId: string, conversationId: string): Promise<SupportMessage[]> {
    return this.prisma.supportMessage.findMany({ where: { conversationId, forwardId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  /** Khoá theo hội thoại: hai job chồng nhau (`conv-x` và `conv-x-next`) không thể cùng nhận một tin. */
  private async claim(conversationId: string): Promise<{ forward: SupportForward; messages: SupportMessage[] } | null> {
    const groupId = await this.config.get<string>(CHAT_GROUP_KEY, '');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support-chat-forward:${conversationId}`}))`;
      const all = await tx.supportMessage.findMany({
        where: { conversationId, sender: 'CUSTOMER', forwardId: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const taken: SupportMessage[] = [];
      let total = 0;
      for (const m of all) {
        const len = forwardItemLength(m);
        if (taken.length > 0 && total + len > MAX_FORWARD_CHARS) break;
        taken.push(m);
        total += len;
      }
      if (taken.length === 0) return null;
      const forward = await tx.supportForward.create({ data: { conversationId, groupId } });
      await tx.supportMessage.updateMany({ where: { id: { in: taken.map((m) => m.id) }, forwardId: null }, data: { forwardId: forward.id } });
      return { forward, messages: taken };
    });
  }

  /** Trả về lý do để ném cho BullMQ thử lại, hoặc null khi lượt này đã chốt. */
  private async sendForward(
    conv: { id: string; userId: string; code: string },
    forward: SupportForward,
    messages: SupportMessage[],
    final: boolean,
  ): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: conv.userId }, select: { fullName: true, phone: true, tier: { select: { name: true } } } });
    const context = [...messages].reverse().find((m) => m.context)?.context as SupportChatContext | null | undefined;
    const text = formatForward({
      code: conv.code,
      name: user?.fullName || 'Khách',
      phone: user?.phone ?? null,
      tier: user?.tier ? `Hạng ${user.tier.name}` : null,
      context: context ?? null,
      items: messages.map((m) => ({ body: m.body, imageUrl: m.imageUrl })),
    });

    await this.prisma.supportForward.update({ where: { id: forward.id }, data: { attempts: { increment: 1 } } });
    const r = await this.bridge.send(forward.id, text);
    if (r.ok) {
      await this.prisma.supportForward.update({ where: { id: forward.id }, data: { status: 'SENT', zaloMsgId: r.msgId, sentAt: new Date(), lastError: null } });
      return null;
    }
    const lastError = `${r.code}: ${r.message}`.slice(0, 500);
    if (r.unknown) {
      // Không tự gửi lại để khỏi đăng đôi; admin bấm "Gửi lại" với cùng khoá.
      await this.prisma.supportForward.update({ where: { id: forward.id }, data: { status: 'UNKNOWN', lastError } });
      return null;
    }
    if (r.retry && !final) {
      await this.prisma.supportForward.update({ where: { id: forward.id }, data: { lastError } });
      return lastError;
    }
    await this.prisma.supportForward.update({ where: { id: forward.id }, data: { status: 'FAILED', lastError } });
    return null;
  }

  private async rescheduleIfLeft(conversationId: string): Promise<void> {
    try {
      const left = await this.prisma.supportMessage.count({ where: { conversationId, sender: 'CUSTOMER', forwardId: null } });
      if (left > 0) await this.chat.scheduleForward(conversationId);
    } catch (e) {
      this.logger.warn(`Không đặt lại lịch chuyển hội thoại ${conversationId}: ${(e as Error).message}`);
    }
  }
}
