import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE_GOMDON_EVENTS } from '../../../jobs/queues';
import { GomdonWebhookService } from './gomdon-webhook.service';

/** Worker xử lý webhook Gomdon đã lưu (inbound, async). Lỗi → event FAILED + BullMQ retry. */
@Processor(QUEUE_GOMDON_EVENTS)
export class GomdonEventsProcessor extends WorkerHost {
  constructor(private readonly webhook: GomdonWebhookService) {
    super();
  }

  async process(job: Job<{ eventId: string }>): Promise<void> {
    await this.webhook.processEvent(job.data.eventId);
  }
}
