import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../../common/decorators/public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import type { Env } from '../../../config/env.validation';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';

interface PancakeWebhookBody {
  /** Luồng cũ {event,data}. Pancake POS thực tế gửi nguyên object đơn (type='orders'). */
  event?: string;
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Nhận webhook Pancake (Build Spec §8.4). URL cấu hình trong Pancake:
 *   https://api.tubutree.com/api/webhooks/pancake
 * Quy trình: verify HMAC → lưu raw (RECEIVED) → enqueue → trả 200 ngay (xử lý async).
 */
@Controller('webhooks/pancake')
export class PancakeWebhookController {
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(QUEUE_PANCAKE_EVENTS) private readonly queue: Queue,
  ) {
    this.secret = config.get('PANCAKE_WEBHOOK_SECRET', { infer: true });
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() body: PancakeWebhookBody,
    @Headers('x-webhook-token') token?: string,
  ) {
    // Pancake POS chỉ gửi Request Header tĩnh (không ký HMAC) → verify token chia sẻ.
    // Gate theo config: chưa đặt secret (dev) → bỏ qua; có secret → bắt buộc khớp.
    if (this.secret && !this.verifyToken(token)) {
      throw new UnauthorizedException('Token webhook không hợp lệ.');
    }
    // Pancake POS không gửi field 'event' — suy ra loại từ 'type' (vd 'orders'), mặc định 'order'.
    const eventType = body.event ?? body.type ?? 'order';
    const event = await this.prisma.pancakeWebhookEvent.create({
      data: { eventType, rawPayload: body as object, status: 'RECEIVED' },
    });
    await this.queue.add('process', { eventId: event.id }, { jobId: event.id });
    return { received: true };
  }

  /** So token tĩnh chống timing-attack (độ dài khác → false ngay, không ném). */
  private verifyToken(token?: string): boolean {
    if (!token) return false;
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(this.secret, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
