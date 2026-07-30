import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../../config/env.validation';
import { ZaloOaTokenService } from './zalo-oa-token.service';

/**
 * Client ZNS (Zalo Notification Service) — Build Spec §11.
 * Lấy OA access token ĐỘNG từ ZaloOaTokenService (token được cron làm mới ~mỗi 6h, lưu DB)
 * → KHÔNG chết sau ~25h như token tĩnh trong env. Chưa cấu hình → trả false (caller log INAPP).
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
  ): Promise<boolean> {
    const accessToken = await this.tokens.getAccessToken();
    if (!accessToken || !templateId) {
      this.logger.warn(`ZNS chưa cấu hình — skip gửi template ${templateId} cho ${phone}.`);
      return false;
    }
    try {
      await axios.post(
        `${this.baseUrl}/message/template`,
        { phone, template_id: templateId, template_data: templateData },
        { headers: { access_token: accessToken }, timeout: 10000 },
      );
      return true;
    } catch (err) {
      this.logger.error(`Gửi ZNS thất bại: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
