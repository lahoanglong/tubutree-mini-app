import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../../config/env.validation';
import { ZaloOaTokenService } from './zalo-oa-token.service';
import { interpretZnsBody, interpretZnsException, znsFailure, type ZnsSendResult } from './zns-result';

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
  ): Promise<ZnsSendResult> {
    const accessToken = await this.tokens.getAccessToken();
    if (!accessToken || !templateId) {
      this.logger.warn(`ZNS chưa cấu hình — skip gửi template ${templateId} cho ${phone}.`);
      return znsFailure(false, null, 'ZNS chưa cấu hình (thiếu access token Zalo OA hoặc mã mẫu).');
    }
    try {
      const res = await axios.post(
        `${this.baseUrl}/message/template`,
        { phone, template_id: templateId, template_data: templateData },
        { headers: { access_token: accessToken }, timeout: 10000 },
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
