import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_PANCAKE_PUSH } from '../../jobs/queues';
import { withQueueTimeout } from '../../jobs/queue-timeout';

type Status = 'up' | 'down';
/** IRedisClient của BullMQ chuyển tiếp mọi lệnh sang ioredis nhưng không khai báo kiểu cho PING. */
type RedisPing = { ping(): Promise<string> };

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_PANCAKE_PUSH) private readonly queue: Queue,
  ) {}

  /**
   * 503 khi DB hoặc Redis không dùng được, để Docker healthcheck và monitor báo động.
   * Redis down thì đặt hàng/webhook vẫn chạy nhưng mọi job đồng bộ Pancake/Gomdon/ZNS chỉ chờ
   * cron reconcile — cần người xử lý, không được báo "ok".
   */
  @Public()
  @Get()
  async check() {
    const ts = new Date().toISOString();
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);
    if (db === 'up' && redis === 'up') return { status: 'ok', db, redis, ts };
    throw new ServiceUnavailableException({ status: 'error', db, redis, ts });
  }

  private async checkDb(): Promise<Status> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch (err) {
      this.logger.error(`Health check: DB không truy vấn được — ${(err as Error).message}`);
      return 'down';
    }
  }

  private async checkRedis(): Promise<Status> {
    try {
      const ping = this.queue.client.then((c) => (c as unknown as RedisPing).ping());
      await withQueueTimeout(ping, 'health ping');
      return 'up';
    } catch (err) {
      this.logger.error(`Health check: Redis không phản hồi — ${(err as Error).message}`);
      return 'down';
    }
  }
}
