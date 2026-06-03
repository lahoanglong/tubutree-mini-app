import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Env } from '../../../config/env.validation';

/**
 * Client ZNS (Zalo Notification Service) — Build Spec §11.
 * Gate bằng OA access token; chưa cấu hình → trả false (caller log INAPP fallback).
 */
@Injectable()
export class ZnsClient {
  private readonly logger = new Logger(ZnsClient.name);
  private readonly baseUrl: string;
  private readonly oaToken: string;

  constructor(config: ConfigService<Env, true>) {
    this.baseUrl = config.get('ZNS_BASE_URL', { infer: true });
    this.oaToken = config.get('ZALO_OA_ACCESS_TOKEN', { infer: true });
  }

  isConfigured(): boolean {
    return Boolean(this.oaToken);
  }

  async sendTemplate(
    phone: string,
    templateId: string,
    templateData: Record<string, string>,
  ): Promise<boolean> {
    if (!this.isConfigured() || !templateId) {
      this.logger.warn(`ZNS chưa cấu hình — skip gửi template ${templateId} cho ${phone}.`);
      return false;
    }
    try {
      await axios.post(
        `${this.baseUrl}/message/template`,
        { phone, template_id: templateId, template_data: templateData },
        { headers: { access_token: this.oaToken }, timeout: 10000 },
      );
      return true;
    } catch (err) {
      this.logger.error(`Gửi ZNS thất bại: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
