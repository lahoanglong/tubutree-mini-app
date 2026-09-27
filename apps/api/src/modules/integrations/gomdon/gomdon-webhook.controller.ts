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
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../../common/decorators/public.decorator';
import type { Env } from '../../../config/env.validation';
import type { GomdonWebhookPayload } from './gomdon.types';
import { GomdonWebhookService } from './gomdon-webhook.service';

/**
 * Nhận webhook trạng thái vận đơn Gomdon. Tài liệu Gomdon: webhook do quản trị Gomdon cấu hình giúp (liên
 * hệ Gomdon), KHÔNG mô tả chữ ký hay header tuỳ chỉnh — nên nhận cả 3 dạng, dùng header nếu Gomdon cho
 * đặt header, không thì token trong đường dẫn (docs/integrations/gomdon.md):
 *   https://<api>/api/webhooks/gomdon            + header x-webhook-token: <GOMDON_WEBHOOK_SECRET>
 *   https://<api>/api/webhooks/gomdon/<secret>   (hoặc ?token=<secret>)
 *
 * Quy trình (như PancakeWebhookController): xác thực token chia sẻ (timingSafeEqual) TRƯỚC mọi truy
 * vấn DB → lưu event (dedupe) → enqueue → trả 200 ngay. Tài liệu: Gomdon chỉ coi HTTP 200 là thành công,
 * khác 200 thì gửi lại sau 30 giây, tối đa 3 lần rồi BỎ — 401 (sai/thiếu secret) hay API sập quá ~2 phút
 * là mất event vĩnh viễn (Gomdon không có API tra cứu trạng thái để đối soát lại). Fail-closed ở production
 * khi chưa cấu hình secret. Có throttle riêng (không @SkipThrottle) — endpoint public.
 */
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('webhooks/gomdon')
export class GomdonWebhookController {
  private readonly logger = new Logger(GomdonWebhookController.name);
  private readonly secret: string;

  constructor(
    private readonly webhook: GomdonWebhookService,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('GOMDON_WEBHOOK_SECRET', { infer: true }) ?? '';
    if (!this.secret && process.env.NODE_ENV !== 'production') {
      this.logger.warn(
        '⚠️ GOMDON_WEBHOOK_SECRET chưa đặt — webhook Gomdon đang CHẤP NHẬN MỌI REQUEST (chỉ cho dev/test). Production sẽ từ chối toàn bộ.',
      );
    }
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Body() body: GomdonWebhookPayload,
    @Headers('x-webhook-token') headerToken?: string,
    @Query('token') queryToken?: string,
  ) {
    this.assertAuthorized(headerToken || queryToken);
    return this.webhook.receive(body ?? {});
  }

  @Public()
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async handleWithPathToken(
    @Param('token') pathToken: string,
    @Body() body: GomdonWebhookPayload,
    @Headers('x-webhook-token') headerToken?: string,
  ) {
    this.assertAuthorized(headerToken || pathToken);
    return this.webhook.receive(body ?? {});
  }

  private assertAuthorized(token?: string): void {
    if (!this.secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException('Webhook Gomdon chưa cấu hình bí mật ở production.');
      }
      this.logger.warn('Webhook Gomdon nhận request KHÔNG xác thực (GOMDON_WEBHOOK_SECRET trống — chỉ dev/test).');
      return;
    }
    if (!this.verifyToken(token)) {
      throw new UnauthorizedException('Token webhook không hợp lệ.');
    }
  }

  /** So token tĩnh chống timing-attack (độ dài khác → false ngay, không ném). */
  private verifyToken(token?: string): boolean {
    if (!token) return false;
    const a = Buffer.from(token, 'utf8');
    const b = Buffer.from(this.secret, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
