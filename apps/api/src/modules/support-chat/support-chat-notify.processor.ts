import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_SUPPORT_CHAT_NOTIFY } from '../../jobs/queues';
import { ReplyNotifier, replyPreview } from './reply-notifier';

/** Chạy 20 giây sau khi tin trả lời được lưu: khách đã xem (màn chat mở gọi markRead khi có tin mới) hoặc tin đã thu hồi thì không báo. */
@Processor(QUEUE_SUPPORT_CHAT_NOTIFY)
export class SupportChatNotifyProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ReplyNotifier,
  ) {
    super();
  }

  async process(job: Job<{ messageId: string }>): Promise<void> {
    const message = await this.prisma.supportMessage.findUnique({ where: { id: job.data.messageId } });
    if (!message || message.recalledAt) return;
    const conv = await this.prisma.supportConversation.findUnique({ where: { id: message.conversationId } });
    if (!conv) return;
    if (conv.customerReadAt && conv.customerReadAt >= message.createdAt) return;
    await this.notifier.notifyNow(conv, replyPreview(message.body, message.imageUrl));
  }
}
