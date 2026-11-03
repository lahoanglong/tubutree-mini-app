import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../../../common/decorators/public.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import type { Env } from '../../../config/env.validation';
import { QUEUE_ZALO_OA_EVENTS } from '../../../jobs/queues';
import { withQueueTimeout } from '../../../jobs/queue-timeout';

const USER_SEND_PREFIX = 'user_send_';
/** Chữ ký đúng mà timestamp lệch quá mức này (cũ hoặc tương lai) là tin gửi lại: Zalo thử lại trong vài phút, không hàng giờ. */
const MAX_EVENT_SKEW_MS = 30 * 60 * 1000;

interface ZaloOaWebhookBody {
  event_name?: string;
  sender?: { id?: string };
  message?: { text?: string; msg_id?: string };
  [key: string]: unknown;
}

/**
 * `X-ZEvent-Signature` của webhook Zalo OA: sha256(appId + thân + timestamp + khoá bí mật của OA), hex thường (header có thể
 * mang tiền tố `mac=`). Chữ ký tính trên THÂN THÔ: truyền `body` là chuỗi thô (`req.rawBody`) khi có. Truyền object thì băm
 * JSON.stringify của nó, chỉ khớp khi Zalo gửi JSON gọn không ký tự thoát (`\/`, `\uXXXX`, `&`...), nên đó là đường lùi, không
 * phải đường chính.
 */
export function zaloOaEventSignature(appId: string, body: unknown, timestamp: string, oaSecretKey: string): string {
  return createHash('sha256').update(appId + (typeof body === 'string' ? body : JSON.stringify(body)) + timestamp + oaSecretKey).digest('hex');
}

/**
 * Nhận webhook tin nhắn khách gửi vào Zalo OA (CSKH quick-reply/auto-reply). URL cấu hình
 * trong Zalo OA dashboard: https://api.tubutree.com/api/webhooks/zalo-oa (xem
 * docs/GO-LIVE-KEYS.md). Quy trình mirror `PancakeWebhookController`: verify token tĩnh →
 * lưu raw (RECEIVED) → enqueue → trả 200 ngay (auto-reply xử lý async ở `ZaloOaEventsProcessor`).
 *
 * Xác thực: có ZALO_OA_SECRET_KEY + ZALO_APP_ID thì BẮT BUỘC `X-ZEvent-Signature` đúng và còn mới (token tĩnh bị bỏ qua: nó
 * nằm trong URL/cấu hình nên dễ lộ, để làm cửa thay thế thì chữ ký vô nghĩa). Chưa đủ hai khoá đó thì dùng token tĩnh
 * `x-webhook-token` (ZALO_OA_WEBHOOK_SECRET). Production mà không khoá nào → 401.
 */
@SkipThrottle()
@Controller('webhooks/zalo-oa')
export class ZaloOaWebhookController {
  private readonly logger = new Logger(ZaloOaWebhookController.name);
  private readonly secret: string;
  private readonly oaSecretKey: string;
  private readonly appId: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(QUEUE_ZALO_OA_EVENTS) private readonly queue: Queue,
  ) {
    this.secret = config.get('ZALO_OA_WEBHOOK_SECRET', { infer: true });
    this.oaSecretKey = config.get('ZALO_OA_SECRET_KEY', { infer: true }) ?? '';
    this.appId = config.get('ZALO_APP_ID', { infer: true }) ?? '';
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() body: ZaloOaWebhookBody,
    @Headers('x-webhook-token') token?: string,
    @Headers('x-zevent-signature') signature?: string,
    @Req() req?: { rawBody?: Buffer },
  ) {
    if (!this.secret && !this.oaSecretKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Webhook chưa cấu hình bí mật ở production.');
      }
      // Dev/test: bỏ qua cho dễ thử nghiệm.
    } else if (this.signingReady ? !this.verifySignature(body, signature, req?.rawBody) : !this.verifyToken(token)) {
      throw new UnauthorizedException('Chữ ký hoặc token webhook không hợp lệ.');
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

  private get signingReady(): boolean {
    return Boolean(this.oaSecretKey && this.appId);
  }

  /** So token tĩnh chống timing-attack (độ dài khác → false ngay, không ném). Chưa đặt token thì lớp này không bao giờ qua. */
  private verifyToken(token?: string): boolean {
    if (!this.secret || !token) return false;
    return constantTimeEqual(token, this.secret);
  }

  private verifySignature(body: ZaloOaWebhookBody, signature?: string, rawBody?: Buffer): boolean {
    if (!this.oaSecretKey || !this.appId || !signature || !body || typeof body !== 'object') return false;
    const timestamp = body['timestamp'];
    if (typeof timestamp !== 'string' && typeof timestamp !== 'number') return false;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_EVENT_SKEW_MS) return false;
    const given = signature.trim().toLowerCase().replace(/^mac=\s*/, '');
    const signed: unknown = rawBody && rawBody.length > 0 ? rawBody.toString('utf8') : body;
    return constantTimeEqual(given, zaloOaEventSignature(this.appId, signed, String(timestamp), this.oaSecretKey));
  }
}

function constantTimeEqual(x: string, y: string): boolean {
  const a = Buffer.from(x, 'utf8');
  const b = Buffer.from(y, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
