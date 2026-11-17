import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { MSS_ORDER_EVENTS_QUEUE } from './mss-order-event-types';
import type { MssOrderEventJobData } from './mss-order-event.dispatch';
import { MssOrderEventSender, type MssDeliverOutcome } from './mss-order-event.sender';

/** Ít luồng song song: MSS gián cách tin và có trần tần suất (hợp đồng mục 8.4), gửi dồn chỉ đổi lấy 429. */
@Processor(MSS_ORDER_EVENTS_QUEUE, { concurrency: 2 })
export class MssOrderEventsProcessor extends WorkerHost {
  constructor(private readonly sender: MssOrderEventSender) {
    super();
  }

  async process(job: Job<MssOrderEventJobData>): Promise<MssDeliverOutcome> {
    const outcome = await this.sender.deliver(job.data.eventId);
    // Job được xếp từ trong transaction nghiệp vụ: dòng chưa hiện thì chờ commit vài giây (lượt thử của job). Lượt cuối vẫn chưa có
    // nghĩa là transaction đã rollback, không còn gì để gửi.
    if (outcome === 'not_found' && job.attemptsMade + 1 < (job.opts.attempts ?? 1)) {
      throw new Error(`Dòng outbox ${job.data.eventId} chưa hiện, chờ transaction commit`);
    }
    return outcome;
  }
}
