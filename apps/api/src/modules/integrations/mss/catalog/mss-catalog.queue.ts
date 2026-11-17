import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Job, Queue } from 'bullmq';
import { CRON_TZ } from '../../../../common/cron-tz';
import { markCronSkipped, noteCronError, TrackCron } from '../../../../common/cron-run/track-cron';
import { withQueueTimeout } from '../../../../jobs/queue-timeout';
import { MssCatalogService, type MssCatalogRunKind, type MssCatalogRunResult, type MssCatalogTrigger } from './mss-catalog.service';

export const MSS_CATALOG_QUEUE = 'mss-catalog';
/** Mã `pancake_product_id` chuông báo, chờ lượt kéo theo mã (Redis set, gộp trùng). */
export const MSS_CATALOG_PENDING_KEY = 'tubu:mss:catalog:pending';
/** Gộp chuông: mọi chuông trong cùng khung 10 giây thành một lượt kéo, chạy lúc khung đóng. */
export const MSS_DOORBELL_WINDOW_MS = 10_000;
/** Quá chừng này mã chờ thì kéo theo mốc (một trang) rẻ hơn hỏi từng mã. */
export const MSS_DOORBELL_MAX_IDS = 300;
const PENDING_TTL_S = 24 * 3600;
const REDIS_TIMEOUT_MS = 2_000;
/** 30 phút một lượt theo mốc (wave tubu-mss-catalog-enrichment; hợp đồng gợi ý 15 phút, chuông bù phần trễ). */
export const MSS_CATALOG_INCREMENTAL_CRON = '0 5,35 * * * *';
/** Kéo toàn bộ mỗi đêm, lệch giờ đồng bộ Pancake (03:37) và tính lại số đã bán (03:00). */
export const MSS_CATALOG_FULL_CRON = '0 40 2 * * *';

export interface MssCatalogJobData {
  kind: MssCatalogRunKind;
  trigger: MssCatalogTrigger;
}

/** Lệnh Redis dùng ở đây (client ioredis của Queue). */
interface RedisSetOps {
  sadd(key: string, ...members: string[]): Promise<number>;
  scard(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  multi(): { smembers(key: string): RedisMulti; del(key: string): RedisMulti; exec(): Promise<[Error | null, unknown][] | null> };
}
interface RedisMulti {
  smembers(key: string): RedisMulti;
  del(key: string): RedisMulti;
  exec(): Promise<[Error | null, unknown][] | null>;
}

/** jobId theo khung: hai tiến trình xếp cùng khung thì BullMQ giữ một job. */
export function doorbellJobId(now: number): { jobId: string; delay: number } {
  const start = Math.floor(now / MSS_DOORBELL_WINDOW_MS) * MSS_DOORBELL_WINDOW_MS;
  return { jobId: `ids-${start}`, delay: start + MSS_DOORBELL_WINDOW_MS - now };
}

@Injectable()
export class MssCatalogQueue {
  private readonly logger = new Logger(MssCatalogQueue.name);

  constructor(@InjectQueue(MSS_CATALOG_QUEUE) private readonly queue: Queue<MssCatalogJobData>) {}

  private redis<T>(label: string, fn: (r: RedisSetOps) => Promise<T>): Promise<T> {
    return withQueueTimeout(
      this.queue.client.then((c) => fn(c as unknown as RedisSetOps)),
      `mss-catalog:${label}`,
      REDIS_TIMEOUT_MS,
    );
  }

  /** Chuông: thêm mã vào tập chờ rồi hẹn một lượt kéo lúc khung 10 giây hiện tại đóng. Trả số mã mới (chưa có trong tập chờ). */
  async ring(ids: readonly string[], now = Date.now()): Promise<number> {
    const added = await this.redis('sadd', async (r) => {
      const n = await r.sadd(MSS_CATALOG_PENDING_KEY, ...ids);
      await r.expire(MSS_CATALOG_PENDING_KEY, PENDING_TTL_S);
      return n;
    });
    const { jobId, delay } = doorbellJobId(now);
    await this.queue.add('ids', { kind: 'ids', trigger: 'doorbell' }, { jobId, delay, removeOnComplete: 100, removeOnFail: 100 });
    return added;
  }

  /** Lấy và xoá tập chờ trong một lần (MULTI): chuông đến sau đó vào tập mới cho khung sau. */
  async drainPending(): Promise<string[]> {
    return this.redis('drain', async (r) => {
      const res = await r.multi().smembers(MSS_CATALOG_PENDING_KEY).del(MSS_CATALOG_PENDING_KEY).exec();
      const members = res?.[0]?.[1];
      return Array.isArray(members) ? members.filter((m): m is string => typeof m === 'string') : [];
    });
  }

  /** Lượt kéo theo mốc/toàn bộ phủ mọi mã đang chờ (mã chuông báo đều có `updated_at` mới): xoá tập chờ để khỏi hỏi lại từng mã. */
  async clearPending(): Promise<void> {
    await this.redis('del', (r) => r.del(MSS_CATALOG_PENDING_KEY)).catch((err: Error) => this.logger.warn(`Không xoá được tập chờ chuông MSS: ${err.message}`));
  }

  async pendingCount(): Promise<number | null> {
    return this.redis('scard', (r) => r.scard(MSS_CATALOG_PENDING_KEY)).catch(() => null);
  }

  /** Xếp lượt theo mốc/toàn bộ; jobId theo phút để cron trên hai tiến trình và nút bấm liên tiếp không xếp trùng. */
  async enqueue(kind: 'incremental' | 'full', trigger: MssCatalogTrigger, now = Date.now()): Promise<void> {
    await this.queue.add(kind, { kind, trigger }, { jobId: `${kind}-${Math.floor(now / 60_000)}`, removeOnComplete: 100, removeOnFail: 100 });
  }
}

/** Một luồng: hai lượt kéo song song chỉ tốn lượt gọi MSS (câu upsert đã chặn lùi phiên bản). */
@Processor(MSS_CATALOG_QUEUE, { concurrency: 1 })
export class MssCatalogProcessor extends WorkerHost {
  private readonly logger = new Logger(MssCatalogProcessor.name);

  constructor(
    private readonly catalog: MssCatalogService,
    private readonly queue: MssCatalogQueue,
  ) {
    super();
  }

  async process(job: Job<MssCatalogJobData>): Promise<MssCatalogRunResult | { status: 'empty' }> {
    const { kind, trigger } = job.data;
    if (kind === 'ids') {
      const ids = await this.queue.drainPending();
      if (ids.length === 0) return { status: 'empty' };
      if (ids.length > MSS_DOORBELL_MAX_IDS) return this.catalog.run('incremental', trigger);
      return this.catalog.run('ids', trigger, ids);
    }
    if (await this.catalog.effective()) await this.queue.clearPending();
    const res = await this.catalog.run(kind, trigger);
    if (res.status === 'failed') this.logger.warn(`Lượt kéo nội dung MSS ${kind} (${trigger}) hỏng: ${res.error}`);
    return res;
  }
}

/** Lịch kéo: chỉ xếp job khi cờ có hiệu lực, cờ tắt thì không chạm Redis hay MSS. */
@Injectable()
export class MssCatalogCron {
  constructor(
    private readonly catalog: MssCatalogService,
    private readonly queue: MssCatalogQueue,
  ) {}

  @Cron(MSS_CATALOG_INCREMENTAL_CRON, { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 3 })
  async incremental(): Promise<void> {
    await this.schedule('incremental', 'cron');
  }

  @Cron(MSS_CATALOG_FULL_CRON, { timeZone: CRON_TZ })
  @TrackCron({ alertAfter: 2 })
  async full(): Promise<void> {
    await this.schedule('full', 'full');
  }

  private async schedule(kind: 'incremental' | 'full', trigger: MssCatalogTrigger): Promise<void> {
    try {
      if (!(await this.catalog.effective())) {
        markCronSkipped('DISABLED');
        return;
      }
      await this.queue.enqueue(kind, trigger);
    } catch (err) {
      noteCronError(`Không xếp được lượt kéo nội dung MSS: ${err instanceof Error ? err.message : err}`);
    }
  }
}
