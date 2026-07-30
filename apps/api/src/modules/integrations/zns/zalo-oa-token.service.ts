import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { Env } from '../../../config/env.validation';
import { needsRefresh, computeExpiresAt } from './zalo-oa-token.util';

const K_ACCESS = 'zalo.oa_access_token';
const K_REFRESH = 'zalo.oa_refresh_token';
const K_EXPIRES = 'zalo.oa_token_expires_at';

/**
 * Quản lý OA Access Token của Zalo (Build Spec §11). Access token hết hạn ~25h và refresh_token
 * XOAY VÒNG mỗi lần làm mới → phải LƯU BỀN (DB, không chỉ env). Token mới lưu thẳng vào
 * SystemConfig (qua prisma, KHÔNG dùng config.set để tránh ghi secret vào SystemConfigHistory).
 * Bootstrap lần đầu: lấy token/refresh_token từ env do OAuth cấp; sau đó DB là nguồn chính.
 */
@Injectable()
export class ZaloOaTokenService {
  private readonly logger = new Logger(ZaloOaTokenService.name);
  private readonly oauthBase: string;
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly envAccess: string;
  private readonly envRefresh: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.oauthBase = config.get('ZALO_OAUTH_BASE', { infer: true });
    this.appId = config.get('ZALO_APP_ID', { infer: true });
    this.appSecret = config.get('ZALO_APP_SECRET', { infer: true });
    this.envAccess = config.get('ZALO_OA_ACCESS_TOKEN', { infer: true });
    this.envRefresh = config.get('ZALO_OA_REFRESH_TOKEN', { infer: true });
  }

  /** Token hiện hành: ưu tiên token đã lưu (do refresh), fallback env (bootstrap). */
  async getAccessToken(): Promise<string> {
    return (await this.readConfig(K_ACCESS)) || this.envAccess;
  }

  /** Cron gọi: chỉ refresh khi sắp hết hạn (tránh xoay refresh_token vô ích). */
  async refreshIfNeeded(now: Date = new Date()): Promise<boolean> {
    const expiresAt = await this.readConfig(K_EXPIRES);
    if (!needsRefresh(expiresAt || null, now)) return false;
    return this.refresh(now);
  }

  /** Gọi Zalo OAuth làm mới access_token + LƯU access/refresh(mới, xoay vòng)/hạn. */
  async refresh(now: Date = new Date()): Promise<boolean> {
    const refreshToken = (await this.readConfig(K_REFRESH)) || this.envRefresh;
    if (!refreshToken || !this.appId || !this.appSecret) {
      this.logger.warn('Zalo OA refresh: thiếu refresh_token/app_id/app_secret — skip.');
      return false;
    }
    try {
      const body = new URLSearchParams({
        refresh_token: refreshToken,
        app_id: this.appId,
        grant_type: 'refresh_token',
      });
      const res = await axios.post(`${this.oauthBase}/v4/oa/access_token`, body.toString(), {
        headers: { secret_key: this.appSecret, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });
      const data = (res?.data ?? {}) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: string | number;
        message?: string;
      };
      if (!data.access_token || !data.refresh_token) {
        this.logger.error(`Zalo OA refresh lỗi: ${data.message ?? 'thiếu token trong response'}`);
        return false;
      }
      const expiresAt = computeExpiresAt(Number(data.expires_in), now);
      await this.writeConfig(K_ACCESS, data.access_token);
      await this.writeConfig(K_REFRESH, data.refresh_token); // refresh_token XOAY VÒNG → lưu cái mới
      await this.writeConfig(K_EXPIRES, expiresAt);
      this.logger.log(`Zalo OA token đã làm mới (hết hạn ${expiresAt}).`);
      return true;
    } catch (e) {
      this.logger.error(`Zalo OA refresh thất bại: ${(e as Error).message}`);
      return false;
    }
  }

  private async readConfig(key: string): Promise<string> {
    const row = await this.prisma.systemConfig.findUnique({ where: { key } });
    return typeof row?.value === 'string' ? row.value : '';
  }

  private async writeConfig(key: string, value: string): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key },
      update: { value, updatedBy: 'system' },
      create: { key, value, category: 'zalo', updatedBy: 'system' },
    });
  }
}
