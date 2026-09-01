import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CskhService } from '../../cskh/cskh.service';
import { ZaloOaMessageClient } from './zalo-oa-message.client';
import { QUEUE_ZALO_OA_EVENTS } from '../../../jobs/queues';

/**
 * Worker xử lý tin nhắn khách gửi vào Zalo OA (async, theo `ZaloOaWebhookController`):
 * so khớp từ khoá với `QuickReplyTemplate` đang bật → gửi tin trả lời; nếu không khớp
 * nhưng là tin ĐẦU TIÊN của user này → gửi lời chào (`isGreeting`); không thì bỏ qua.
 *
 * Side-effect không critical (khác Pancake): lỗi gửi tin chỉ đánh dấu FAILED, KHÔNG throw
 * để BullMQ retry — auto-reply trễ/thất bại 1 lần không ảnh hưởng nghiệp vụ cốt lõi.
 */
@Processor(QUEUE_ZALO_OA_EVENTS)
export class ZaloOaEventsProcessor extends WorkerHost {
  private readonly logger = new Logger(ZaloOaEventsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cskh: CskhService,
    private readonly client: ZaloOaMessageClient,
  ) {
    super();
  }

  async process(job: Job<{ eventId: string }>): Promise<void> {
    const event = await this.prisma.oaInboundMessage.findUnique({ where: { id: job.data.eventId } });
    if (!event || event.status !== 'RECEIVED') return;

    try {
      const template = (await this.cskh.matchTemplate(event.messageText ?? '')) ?? (await this.greetingIfFirstMessage(event.zaloUserId));

      if (!template) {
        await this.prisma.oaInboundMessage.update({ where: { id: event.id }, data: { status: 'SKIPPED' } });
        return;
      }

      const sent = await this.client.sendText(event.zaloUserId, template.content);
      await this.prisma.oaInboundMessage.update({
        where: { id: event.id },
        data: { status: sent ? 'REPLIED' : 'FAILED', matchedTemplateId: template.id },
      });
    } catch (err) {
      this.logger.error(`Xử lý tin OA thất bại: ${err instanceof Error ? err.message : String(err)}`);
      await this.prisma.oaInboundMessage
        .update({ where: { id: event.id }, data: { status: 'FAILED' } })
        .catch(() => undefined);
    }
  }

  /**
   * Lời chào chỉ gửi 1 lần cho mỗi zaloUserId. Guard thật là unique constraint trên
   * OaGreetedUser.zaloUserId (create() ở đây là compare-and-swap: thắng race → gửi chào,
   * thua race → P2002 → bỏ qua) — KHÔNG đếm OaInboundMessage trước đó (không atomic, 2
   * webhook đồng thời của cùng tin đầu tiên sẽ cùng đọc "chưa có tin nào" và cùng gửi chào).
   */
  private async greetingIfFirstMessage(zaloUserId: string) {
    try {
      await this.prisma.oaGreetedUser.create({ data: { zaloUserId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return null; // đã gửi (hoặc đang gửi) lời chào cho user này rồi
      }
      throw err;
    }
    return this.cskh.getGreetingTemplate();
  }
}
