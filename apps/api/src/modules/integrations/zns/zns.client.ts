import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../../config/env.validation';
import { ZaloOaTokenService } from './zalo-oa-token.service';
import { maskPhone } from '../../../common/mask-pii';
import { interpretZnsBody, interpretZnsException, znsFailure, type ZnsSendResult } from './zns-result';

/**
 * Hạn chờ phản hồi của một lần gọi ZNS. Gọi chạy trong worker nền (không nằm trên đường đặt hàng/thanh toán) nên chờ lâu
 * không làm khách chậm; hết hạn mà Zalo vẫn xử lý thì lần gửi lại làm khách nhận hai tin xác nhận và tốn phí hai lần.
 */
export const ZNS_REQUEST_TIMEOUT_MS = 25_000;

/**
 * Ví dụ của Zalo ZNS dùng SĐT quốc tế 84xxxxxxxxx, còn User.phone lưu 0xxxxxxxxx. Chỉ đổi đúng dạng 0 + 9 số; dạng khác
 * gửi nguyên để Zalo báo lỗi số điện thoại rõ ràng thay vì đoán sai số của khách.
 */
function toZnsPhone(phone: string): string {
  return /^0\d{9}$/.test(phone) ? `84${phone.slice(1)}` : phone;
}

/**
 * Client ZNS (Zalo Notification Service) — Build Spec §11.
 * Lấy OA access token ĐỘNG từ ZaloOaTokenService (token được cron làm mới ~mỗi 6h, lưu DB)
 * → KHÔNG chết sau ~25h như token tĩnh trong env. Chưa cấu hình → thất bại vĩnh viễn (caller vẫn có INAPP).
 * Thành công CHỈ khi body Zalo có `error === 0`: Zalo trả HTTP 200 kèm lỗi nghiệp vụ trong body.
 */
@Injectable()
export class ZnsClient {
  private readonly logger = new Logger(ZnsClient.name);
  private readonly baseUrl: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly tokens: ZaloOaTokenService,
  ) {
    this.baseUrl = config.get('ZNS_BASE_URL', { infer: true });
  }

  async sendTemplate(
    phone: string,
    templateId: string,
    templateData: Record<string, string>,
    trackingId?: string,
  ): Promise<ZnsSendResult> {
    const accessToken = await this.tokens.getAccessToken();
    if (!accessToken || !templateId) {
      this.logger.warn(`ZNS chưa cấu hình — skip gửi template ${templateId} cho ${maskPhone(phone)}.`);
      return znsFailure(false, null, 'ZNS chưa cấu hình (thiếu access token Zalo OA hoặc mã mẫu).');
    }
    try {
      const res = await axios.post(
        `${this.baseUrl}/message/template`,
        { phone: toZnsPhone(phone), template_id: templateId, template_data: templateData, ...(trackingId ? { tracking_id: trackingId } : {}) },
        { headers: { access_token: accessToken }, timeout: ZNS_REQUEST_TIMEOUT_MS },
      );
      const result = interpretZnsBody(res?.data);
      if (!result.ok) this.logger.error(`Gửi ZNS thất bại: ${result.reason} (mã ${result.code ?? 'n/a'})`);
      return result;
    } catch (err) {
      const result = interpretZnsException(err);
      this.logger.error(`Gửi ZNS thất bại: ${result.reason}`);
      return result;
    }
  }
}
