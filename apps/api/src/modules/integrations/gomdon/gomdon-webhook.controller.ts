import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import { createHmac } from 'node:crypto';
import { SkipThrottle } from '@nestjs/throttler';
import { safeEqualStrings } from '../../../common/safe-equal';
import { Public } from '../../../common/decorators/public.decorator';
import type { Env } from '../../../config/env.validation';
import type { GomdonWebhookPayload } from './gomdon.types';
import { GomdonWebhookService } from './gomdon-webhook.service';

/** Payload webhook Gomdon chỉ vài chục trường ngắn — chặn form khổng lồ trước khi kiểm token. */
const WEBHOOK_FORM_LIMITS = { limits: { fields: 60, fieldSize: 4 * 1024, parts: 60 } };

/** Lệch giờ tối đa giữa X-Gomdon-Timestamp và đồng hồ máy chủ (giây) — theo tài liệu Gomdon. */
const SIGNATURE_MAX_SKEW_SEC = 300;

/** Phần của request mà controller cần: thân thô (giữ ở common/body-limits.ts) và header. */
interface GomdonWebhookRequest {
  rawBody?: Buffer;
  headers?: Record<string, string | string[] | undefined>;
}

const headerValue = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/**
 * Nhận webhook trạng thái vận đơn Gomdon. Chấp nhận khi MỘT trong hai cơ chế xác thực hợp lệ, để dù Gomdon ký
 * HMAC hay chỉ gọi thẳng URL có secret thì event cũng không bị rớt:
 *  (a) chữ ký (tài liệu Gomdon 27/10/2026): header `X-Gomdon-Timestamp` + `X-Gomdon-Signature` =
 *      HMAC-SHA256-hex("<timestamp>.<thân thô>", webhook_secret), lệch giờ <= 300 giây. Khoá = GOMDON_WEBHOOK_HMAC_SECRET
 *      (webhook_secret Gomdon cấp), không đặt thì dùng GOMDON_WEBHOOK_SECRET. Cần thân thô JSON (`req.rawBody`) —
 *      multipart không có thân thô nên chỉ xác thực được bằng token.
 *  (b) token chia sẻ GOMDON_WEBHOOK_SECRET (docs/integrations/gomdon.md):
 *      https://<api>/api/webhooks/gomdon            + header x-webhook-token: <secret>
 *      https://<api>/api/webhooks/gomdon/<secret>   (hoặc ?token=<secret>)
 * Header chữ ký có mặt nhưng sai/lệch giờ mà không có token hợp lệ → 401.
 *
 * Quy trình (như PancakeWebhookController): xác thực TRƯỚC mọi truy vấn DB → lưu event (dedupe) → enqueue → trả
 * 200 ngay. Tài liệu: Gomdon chỉ coi HTTP 200 là thành công, khác 200 thì gửi lại sau 30 giây, tối đa 3 lần rồi
 * BỎ — 401 (sai/thiếu secret) hay API sập quá ~2 phút là mất event vĩnh viễn (Gomdon không có API tra cứu trạng
 * thái để đối soát lại). Fail-closed ở production khi chưa cấu hình secret nào.
 *
 * KHÔNG throttle (như webhook Pancake): trước đây giới hạn 120 request/phút/IP đếm cả request đúng,
 * bưu cục quét hàng loạt là Gomdon bị 429 và bỏ event sau 3 lần gửi lại. Request sai chỉ tốn một phép so
 * timingSafeEqual/HMAC (không chạm DB/queue); secret 32 byte ngẫu nhiên không dò được.
 *
 * Nhận cả multipart/form-data (mọi API Gomdon dùng form-data; tài liệu chưa nói Content-Type của webhook) —
 * chỉ trường chữ, không nhận file. Payload không đọc được → 400 (xem GomdonWebhookService.receive).
 */
@SkipThrottle()
@Controller('webhooks/gomdon')
export class GomdonWebhookController {
  private readonly logger = new Logger(GomdonWebhookController.name);
  private readonly secret: string;
  private readonly hmacSecret: string;

  constructor(
    private readonly webhook: GomdonWebhookService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('GOMDON_WEBHOOK_SECRET', { infer: true }) ?? '';
    this.hmacSecret = config.get('GOMDON_WEBHOOK_HMAC_SECRET', { infer: true }) || this.secret;
    if (!this.secret && !this.hmacSecret && process.env.NODE_ENV !== 'production') {
      this.logger.warn(
        '⚠️ GOMDON_WEBHOOK_SECRET chưa đặt — webhook Gomdon đang CHẤP NHẬN MỌI REQUEST (chỉ cho dev/test). Production sẽ từ chối toàn bộ.',
      );
    }
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(NoFilesInterceptor(WEBHOOK_FORM_LIMITS))
  async handle(
    @Body() body: GomdonWebhookPayload,
    @Headers('x-webhook-token') headerToken?: string,
    @Query('token') queryToken?: string,
    @Headers('content-type') contentType?: string,
    @Req() req?: GomdonWebhookRequest,
  ) {
    this.assertAuthorized([headerToken, queryToken], req);
    return this.webhook.receive(body ?? {}, { contentType });
  }

  @Public()
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(NoFilesInterceptor(WEBHOOK_FORM_LIMITS))
  async handleWithPathToken(
    @Param('token') pathToken: string,
    @Body() body: GomdonWebhookPayload,
    @Headers('x-webhook-token') headerToken?: string,
    @Headers('content-type') contentType?: string,
    @Req() req?: GomdonWebhookRequest,
  ) {
    this.assertAuthorized([headerToken, pathToken], req);
    return this.webhook.receive(body ?? {}, { contentType });
  }

  private assertAuthorized(tokens: Array<string | undefined>, req?: GomdonWebhookRequest): void {
    if (!this.secret && !this.hmacSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Webhook Gomdon chưa cấu hình bí mật ở production.');
      }
      this.logger.warn('Webhook Gomdon nhận request KHÔNG xác thực (GOMDON_WEBHOOK_SECRET trống — chỉ dev/test).');
      return;
    }
    if (this.verifyToken(tokens)) return;
    const signatureProblem = this.checkSignature(req);
    if (signatureProblem === null) return;
    if (signatureProblem !== 'no-signature') {
      this.logger.warn(`Webhook Gomdon bị từ chối: chữ ký không hợp lệ (${signatureProblem}) và không có token hợp lệ.`);
    }
    throw new UnauthorizedException('Xác thực webhook không hợp lệ.');
  }

  /** So token tĩnh chống timing-attack (so băm nên không lộ độ dài secret). Hợp lệ khi BẤT KỲ token nào gửi kèm khớp. */
  private verifyToken(tokens: Array<string | undefined>): boolean {
    if (!this.secret) return false;
    return tokens.some((token) => !!token && safeEqualStrings(token, this.secret));
  }

  /** null = chữ ký hợp lệ; ngược lại là lý do (không chứa secret/chữ ký). */
  private checkSignature(req?: GomdonWebhookRequest): 'no-signature' | 'bad-timestamp' | 'clock-skew' | 'no-raw-body' | 'mismatch' | null {
    const timestamp = headerValue(req?.headers?.['x-gomdon-timestamp'])?.trim();
    const signature = headerValue(req?.headers?.['x-gomdon-signature'])?.trim();
    if (!this.hmacSecret || !timestamp || !signature) return 'no-signature';
    if (!/^\d{1,13}$/.test(timestamp)) return 'bad-timestamp';
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_MAX_SKEW_SEC) return 'clock-skew';
    const rawBody = req?.rawBody;
    if (!rawBody) {
      this.logger.error('Webhook Gomdon có chữ ký nhưng không mang thân thô (req.rawBody): kiểm parser webhook ở common/body-limits.ts.');
      return 'no-raw-body';
    }
    const expected = createHmac('sha256', this.hmacSecret).update(`${timestamp}.`).update(rawBody).digest('hex');
    return safeEqualStrings(signature.toLowerCase(), expected) ? null : 'mismatch';
  }
}
