import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env.validation';
import { UsersService } from './users.service';

export const ZALO_REVOKE_CONSENT_EVENT = 'user.revoke.consent';
export const ZALO_REVOKE_REASON = 'Zalo: người dùng rút lại sự đồng ý / yêu cầu xoá dữ liệu trong Mini App';

type ZaloConsentWebhookBody = Record<string, unknown>;

/**
 * sha256(giá trị các trường xếp theo tên khoá A-Z, nối liền, object thì JSON.stringify, rồi nối API Key), hex thường — đúng mục
 * "Hướng dẫn verify signature" của Zalo (header `x-zevent-signature`). Chữ ký phủ mọi trường kể cả `timestamp`.
 */
export function zaloEventSignature(data: ZaloConsentWebhookBody, apiKey: string): string {
  const content = Object.keys(data)
    .sort()
    .map((k) => {
      const v = data[k];
      return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
    })
    .join('');
  return createHash('sha256').update(content + apiKey).digest('hex');
}

/**
 * Webhook URL của Zalo Mini App (console, Xét duyệt phiên bản > Thiết lập chung): Zalo gọi khi user rút lại sự đồng ý và xoá dữ
 * liệu. URL: https://api.tubutree.com/api/webhooks/zalo-miniapp. Không xoá thẳng: tạo đúng yêu cầu xoá tài khoản như
 * `POST /me/deletion-request` (PENDING, admin xử lý và ẩn danh qua AccountDeletionService, có kiểm vướng mắc đơn/Ví/công nợ).
 */
@SkipThrottle()
@Controller('webhooks/zalo-miniapp')
export class ZaloConsentWebhookController {
  private readonly logger = new Logger(ZaloConsentWebhookController.name);
  private readonly apiKey: string;

  constructor(
    private readonly users: UsersService,
    config: ConfigService<Env, true>,
  ) {
    this.apiKey = config.get('ZALO_OPEN_API_KEY', { infer: true });
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Body() body: ZaloConsentWebhookBody, @Headers('x-zevent-signature') signature?: string) {
    // Không có khoá thì từ chối ở mọi môi trường: endpoint này dẫn tới xoá tài khoản nên không có chế độ bỏ qua cho dev.
    if (!this.apiKey) throw new UnauthorizedException('Webhook chưa cấu hình khoá xác thực.');
    if (!body || typeof body !== 'object' || Array.isArray(body) || !this.verify(body, signature)) {
      throw new UnauthorizedException('Chữ ký webhook không hợp lệ.');
    }
    if (body.event !== ZALO_REVOKE_CONSENT_EVENT) return { received: true };
    const zaloUserId = body.userId;
    if (typeof zaloUserId !== 'string' || !zaloUserId) return { received: true };

    const res = await this.users.requestAccountDeletionByZaloId(zaloUserId, ZALO_REVOKE_REASON);
    // Không log userId Zalo, tên, SĐT hay body: chỉ id nội bộ.
    this.logger.log(
      res.userId ? `Zalo rút đồng ý: user ${res.userId}, ${res.alreadyRequested ? 'đã có yêu cầu xoá đang chờ' : 'đã tạo yêu cầu xoá'}.` : 'Zalo rút đồng ý: không có user khớp, bỏ qua.',
    );
    return { received: true };
  }

  private verify(body: ZaloConsentWebhookBody, signature?: string): boolean {
    if (!signature) return false;
    const a = Buffer.from(signature.trim().toLowerCase(), 'utf8');
    const b = Buffer.from(zaloEventSignature(body, this.apiKey), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
