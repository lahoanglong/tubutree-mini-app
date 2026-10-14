import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_GOMDON_EVENTS, QUEUE_PANCAKE_EVENTS } from '../../jobs/queues';
import { addGomdonJob, GOMDON_JOB_EVENT } from '../integrations/gomdon/gomdon-queue';
import { GOMDON_EVENT_STATUS } from '../integrations/gomdon/gomdon-webhook.service';
import {
  PANCAKE_CLAIM_STALE_MINUTES,
  PANCAKE_EVENT_STATUS,
  PANCAKE_JOB_EVENT,
  PANCAKE_STOCK_EVENT,
} from '../integrations/pancake/pancake-webhook-dedupe';

export const STOCK_EVENT_NO_RETRY = 'Sự kiện tồn kho cũ không chạy lại được (sẽ đè số tồn mới hơn) — chạy Đồng bộ danh mục Pancake rồi bấm Đã xử lý.';

export type WebhookSource = 'pancake' | 'gomdon';

/**
 * Thao tác tay trên webhook Pancake/Gomdon lỗi ở màn Sức khoẻ hệ thống (R2-PLATFORM-1): "Chạy lại" (đặt lại số lần
 * thử rồi đưa vào hàng đợi — worker claim nguyên tử nên chạy chồng với cron cứu hộ cũng không xử lý hai lần) và
 * "Đã xử lý" (người vận hành đã sửa tay đơn, sự kiện rời báo động; cron cứu hộ và worker bỏ qua sự kiện này).
 * Sự kiện tồn kho Pancake không cho chạy lại: số tồn tuyệt đối đã cũ, áp lại là hồi sinh hàng đã bán.
 */
@Injectable()
export class OpsWebhookEventsService {
  private readonly logger = new Logger(OpsWebhookEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_PANCAKE_EVENTS) private readonly pancakeQueue: Queue,
    @InjectQueue(QUEUE_GOMDON_EVENTS) private readonly gomdonQueue: Queue,
  ) {}

  async retry(source: WebhookSource, id: string, actorId: string): Promise<{ ok: true; message: string }> {
    const reset = { attempts: 0, error: null, dismissedAt: null, dismissedById: null };
    let count: number;
    if (source === 'pancake') {
      const staleClaim = new Date(Date.now() - PANCAKE_CLAIM_STALE_MINUTES * 60_000);
      ({ count } = await this.prisma.pancakeWebhookEvent.updateMany({
        where: {
          id,
          eventType: { not: PANCAKE_STOCK_EVENT },
          OR: [
            { status: { in: [PANCAKE_EVENT_STATUS.FAILED, PANCAKE_EVENT_STATUS.RECEIVED, PANCAKE_EVENT_STATUS.UNMATCHED] } },
            { status: PANCAKE_EVENT_STATUS.PROCESSING, claimedAt: { lt: staleClaim } },
            { status: PANCAKE_EVENT_STATUS.PROCESSING, claimedAt: null },
          ],
        },
        data: { ...reset, status: PANCAKE_EVENT_STATUS.RECEIVED, claimedAt: null },
      }));
    } else {
      ({ count } = await this.prisma.gomdonWebhookEvent.updateMany({
        where: { id, status: { in: [GOMDON_EVENT_STATUS.FAILED, GOMDON_EVENT_STATUS.RECEIVED] } },
        data: { ...reset, status: GOMDON_EVENT_STATUS.RECEIVED },
      }));
    }
    if (count === 0) await this.explainNoop(source, id, 'retry');
    try {
      if (source === 'pancake') await addGomdonJob(this.pancakeQueue, PANCAKE_JOB_EVENT, { eventId: id }, id);
      else await addGomdonJob(this.gomdonQueue, GOMDON_JOB_EVENT, { eventId: id }, id);
    } catch (err) {
      this.logger.error(`Đưa lại webhook ${source} ${id} vào hàng đợi lỗi: ${err instanceof Error ? err.message : err}`);
      throw new ServiceUnavailableException('Hàng đợi xử lý nền không phản hồi. Sự kiện đã được đặt lại, cron cứu hộ sẽ chạy trong 10 phút.');
    }
    this.logger.warn(`Admin ${actorId} chạy lại webhook ${source} ${id}.`);
    return { ok: true, message: 'Đã đưa sự kiện vào hàng đợi xử lý lại. Làm mới sau ít giây để xem kết quả.' };
  }

  async dismiss(source: WebhookSource, id: string, actorId: string): Promise<{ ok: true; message: string }> {
    const where = { id, dismissedAt: null, status: { notIn: ['PROCESSED', 'IGNORED'] } };
    const data = { dismissedAt: new Date(), dismissedById: actorId };
    const { count } =
      source === 'pancake'
        ? await this.prisma.pancakeWebhookEvent.updateMany({ where, data })
        : await this.prisma.gomdonWebhookEvent.updateMany({ where, data });
    if (count === 0) await this.explainNoop(source, id, 'dismiss');
    this.logger.warn(`Admin ${actorId} đánh dấu đã xử lý webhook ${source} ${id}.`);
    return { ok: true, message: 'Đã đánh dấu đã xử lý — sự kiện không còn tính vào báo động.' };
  }

  private async explainNoop(source: WebhookSource, id: string, action: 'retry' | 'dismiss'): Promise<never> {
    const row =
      source === 'pancake'
        ? await this.prisma.pancakeWebhookEvent.findUnique({ where: { id }, select: { status: true, dismissedAt: true, eventType: true } })
        : await this.prisma.gomdonWebhookEvent.findUnique({ where: { id }, select: { status: true, dismissedAt: true } });
    if (!row) throw new NotFoundException('Không tìm thấy sự kiện webhook.');
    if (row.status === 'PROCESSED' || row.status === 'IGNORED') throw new BadRequestException('Sự kiện đã được xử lý xong.');
    if (action === 'retry' && 'eventType' in row && row.eventType === PANCAKE_STOCK_EVENT) throw new BadRequestException(STOCK_EVENT_NO_RETRY);
    if (row.dismissedAt) throw new BadRequestException('Sự kiện đã được đánh dấu đã xử lý trước đó.');
    throw new BadRequestException('Sự kiện đang được xử lý, thử lại sau ít phút.');
  }
}
