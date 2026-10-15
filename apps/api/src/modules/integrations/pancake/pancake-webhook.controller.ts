import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../../common/decorators/public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import type { Env } from '../../../config/env.validation';
import { QUEUE_PANCAKE_EVENTS } from '../../../jobs/queues';
import { addGomdonJob } from '../gomdon/gomdon-queue';
import { PANCAKE_EVENT_DONE, PANCAKE_EVENT_STATUS, PANCAKE_JOB_EVENT, pancakeDedupeKey } from './pancake-webhook-dedupe';

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
 * Quy trình: verify token → lưu raw (RECEIVED, dedupe theo khoá sự kiện) → enqueue → trả 200 ngay (xử lý async).
 */
@SkipThrottle()
@Controller('webhooks/pancake')
export class PancakeWebhookController {
  private readonly logger = new Logger(PancakeWebhookController.name);
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
    // Fail-closed ở production: chưa cấu hình secret = từ chối ngay (không log secret).
    if (!this.secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Webhook chưa cấu hình bí mật ở production.');
      }
      // Dev/test: bỏ qua cho dễ thử nghiệm.
    } else if (!this.verifyToken(token)) {
      throw new UnauthorizedException('Token webhook không hợp lệ.');
    }
    // Pancake POS không gửi field 'event' — suy ra loại từ 'type' (vd 'orders'), mặc định 'order'.
    const eventType = body.event ?? body.type ?? 'order';
    const dedupeKey = pancakeDedupeKey(eventType, body);
    let eventId: string;
    try {
      const event = await this.prisma.pancakeWebhookEvent.create({
        data: { eventType, dedupeKey, rawPayload: body as object, status: PANCAKE_EVENT_STATUS.RECEIVED },
      });
      eventId = event.id;
    } catch (err) {
      // Không đọc trước rồi mới ghi: 2 lần gửi song song cùng thấy "chưa có" — để unique chặn.
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      const existing = await this.prisma.pancakeWebhookEvent.findUnique({ where: { dedupeKey } });
      if (!existing) throw err;
      if (PANCAKE_EVENT_DONE.includes(existing.status)) return { received: true, duplicate: true };
      eventId = existing.id; // lần trước chưa xong/lỗi → đẩy lại, worker claim nên không chạy chồng
    }
    try {
      await addGomdonJob(this.queue, PANCAKE_JOB_EVENT, { eventId }, eventId);
    } catch (err) {
      // Sự kiện đã lưu RECEIVED — PancakeEventsReconcileService enqueue lại, không cần Pancake gửi lại.
      this.logger.error(`Enqueue webhook Pancake ${eventId} lỗi: ${err instanceof Error ? err.message : err}`);
    }
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
