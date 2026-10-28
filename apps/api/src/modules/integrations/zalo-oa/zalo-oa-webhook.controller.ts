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
import { Prisma } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../../common/decorators/public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import type { Env } from '../../../config/env.validation';
import { QUEUE_ZALO_OA_EVENTS } from '../../../jobs/queues';
import { withQueueTimeout } from '../../../jobs/queue-timeout';

const USER_SEND_PREFIX = 'user_send_';

interface ZaloOaWebhookBody {
  event_name?: string;
  sender?: { id?: string };
  message?: { text?: string; msg_id?: string };
  [key: string]: unknown;
}

/**
 * Nhận webhook tin nhắn khách gửi vào Zalo OA (CSKH quick-reply/auto-reply). URL cấu hình
 * trong Zalo OA dashboard: https://api.tubutree.com/api/webhooks/zalo-oa (xem
 * docs/GO-LIVE-KEYS.md). Quy trình mirror `PancakeWebhookController`: verify token tĩnh →
 * lưu raw (RECEIVED) → enqueue → trả 200 ngay (auto-reply xử lý async ở `ZaloOaEventsProcessor`).
 *
 * TODO xác nhận cơ chế verify chính thức của Zalo OA webhook (có thể là HMAC ký payload thay
 * vì header token tĩnh) khi đăng ký webhook thật — tạm dùng token tĩnh như Pancake vì Zalo OA
 * cũng cho phép khai báo 1 giá trị xác thực tuỳ chỉnh lúc đăng ký webhook.
 */
@SkipThrottle()
@Controller('webhooks/zalo-oa')
export class ZaloOaWebhookController {
  private readonly logger = new Logger(ZaloOaWebhookController.name);
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(QUEUE_ZALO_OA_EVENTS) private readonly queue: Queue,
  ) {
    this.secret = config.get('ZALO_OA_WEBHOOK_SECRET', { infer: true });
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Body() body: ZaloOaWebhookBody, @Headers('x-webhook-token') token?: string) {
    if (!this.secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Webhook chưa cấu hình bí mật ở production.');
      }
      // Dev/test: bỏ qua cho dễ thử nghiệm.
    } else if (!this.verifyToken(token)) {
      throw new UnauthorizedException('Token webhook không hợp lệ.');
    }

    // Chỉ tin khách gửi vào OA (user_send_text/image/...): sự kiện OA tự gửi (oa_send_*) mang sender là chính OA nên nếu lưu
    // sẽ bị worker khớp từ khoá và "trả lời" lại OA. Trả 200 để Zalo không gửi lại.
    if (typeof body.event_name !== 'string' || !body.event_name.startsWith(USER_SEND_PREFIX)) return { received: true };

    const zaloUserId = body.sender?.id;
    if (!zaloUserId) return { received: true }; // tin khách không có người gửi → bỏ qua êm

    // msgId dedup: Zalo có thể gửi lại cùng 1 tin (retry/at-least-once) → unique index chặn
    // tạo trùng row + enqueue trùng job (nếu không, "tin đầu tiên" có thể bị coi là 2 tin
    // khác nhau → gửi lời chào 2 lần). Tin không có msg_id (hiếm) thì không dedup được, chấp nhận.
    const msgId = body.message?.msg_id ?? null;
    let event: { id: string };
    try {
      event = await this.prisma.oaInboundMessage.create({
        data: { zaloUserId, msgId, messageText: body.message?.text ?? null, rawPayload: body as object },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return { received: true }; // đã xử lý tin này rồi (webhook gửi trùng)
      }
      throw err;
    }
    try {
      await withQueueTimeout(this.queue.add('process', { eventId: event.id }, { jobId: event.id }), `${QUEUE_ZALO_OA_EVENTS} ${event.id}`);
    } catch (err) {
      // Tin đã lưu DB; Zalo gửi lại sẽ đụng unique msgId nên trả lỗi cũng không giúp enqueue lại.
      this.logger.error(`Enqueue tin OA ${event.id} lỗi: ${err instanceof Error ? err.message : err}`);
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
