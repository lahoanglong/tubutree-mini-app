import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/decorators/public.decorator';
import type { Env } from '../../config/env.validation';
import { UsersService } from './users.service';

export const ZALO_REVOKE_CONSENT_EVENT = 'user.revoke.consent';
export const ZALO_REVOKE_REASON = 'Zalo: người dùng rút lại sự đồng ý / yêu cầu xoá dữ liệu trong Mini App';

const MAX_BODY_KEYS = 20;
const EVENT_KEYS = ['appId', 'event', 'timestamp', 'userId'];
const MAX_EVENT_AGE_MS = 7 * 24 * 3600 * 1000;
const ZALO_USER_ID = /^\d{10,25}$/;

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
 * liệu. URL: https://api.tubutree.com/api/webhooks/zalo-miniapp, dán ở mini.zalo.me/developers > Open APIs > Quản lý APIs > Webhook URL
 * (cũng có ô "Thiết lập Webhook URL" ở bước 2 của Xét duyệt phiên bản). Không xoá thẳng: tạo đúng yêu cầu xoá tài khoản như
 * `POST /me/deletion-request` (PENDING, admin xử lý và ẩn danh qua AccountDeletionService, có kiểm vướng mắc đơn/Ví/công nợ).
 */
@SkipThrottle()
@Controller('webhooks/zalo-miniapp')
export class ZaloConsentWebhookController {
  private readonly logger = new Logger(ZaloConsentWebhookController.name);
  private readonly apiKey: string;
  private readonly appIds: string[];

  constructor(
    private readonly users: UsersService,
    config: ConfigService<Env, true>,
  ) {
    this.apiKey = config.get('ZALO_OPEN_API_KEY', { infer: true });
    this.appIds = [config.get('ZALO_MINIAPP_ID', { infer: true }), config.get('ZALO_APP_ID', { infer: true })].filter((v): v is string => !!v);
  }

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Body() body: ZaloConsentWebhookBody, @Headers('x-zevent-signature') signature?: string) {
    // Không có khoá thì từ chối ở mọi môi trường: endpoint này dẫn tới xoá tài khoản nên không có chế độ bỏ qua cho dev.
    if (!this.apiKey) throw new UnauthorizedException('Webhook chưa cấu hình khoá xác thực.');
    // Chặn trước khi băm: body to không được tốn CPU.
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > MAX_BODY_KEYS || !this.verify(body, signature)) {
      throw new UnauthorizedException('Chữ ký webhook không hợp lệ.');
    }
    if (body.event !== ZALO_REVOKE_CONSENT_EVENT) return { received: true };
    // Chữ ký nối giá trị không có dấu ngăn, nên body đã ký có thể bị cắt lại ranh giới trường: chỉ nhận đúng hình dạng Zalo gửi.
    // Sai hình dạng vẫn trả 200 để Zalo không gửi lại mãi.
    const reject = (why: string) => {
      this.logger.warn(`Zalo rút đồng ý: bỏ qua sự kiện (${why}).`);
      return { received: true };
    };
    const keys = Object.keys(body).sort();
    if (keys.length !== EVENT_KEYS.length || keys.some((k, i) => k !== EVENT_KEYS[i])) return reject('sai tập trường');
    const { userId: zaloUserId, timestamp, appId } = body;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_EVENT_AGE_MS) return reject('timestamp sai hoặc quá hạn');
    if (typeof zaloUserId !== 'string' || !ZALO_USER_ID.test(zaloUserId)) return reject('userId sai định dạng');
    if (this.appIds.length > 0 && (typeof appId !== 'string' || !this.appIds.includes(appId))) return reject('appId không khớp');

    const res = await this.users.requestAccountDeletionByZaloId(zaloUserId, ZALO_REVOKE_REASON);
    // Không log userId Zalo, tên, SĐT hay body: chỉ id nội bộ, hoặc 12 ký tự đầu băm sha256 khi không khớp ai.
    if (res.userId) {
      this.logger.log(`Zalo rút đồng ý: user ${res.userId}, ${res.alreadyRequested ? 'đã có yêu cầu xoá đang chờ' : 'đã tạo yêu cầu xoá'}.`);
    } else {
      const h = createHash('sha256').update(zaloUserId).digest('hex').slice(0, 12);
      this.logger.warn(`Zalo rút đồng ý: không có user khớp (userId băm ${h}), cần CSKH xử lý tay nếu đây là yêu cầu xoá thật.`);
    }
    return { received: true };
  }

  private verify(body: ZaloConsentWebhookBody, signature?: string): boolean {
    if (!signature) return false;
    const a = Buffer.from(signature.trim().toLowerCase(), 'utf8');
    const b = Buffer.from(zaloEventSignature(body, this.apiKey), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
