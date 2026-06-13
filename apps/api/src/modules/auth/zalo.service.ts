import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { Env } from '../../config/env.validation';

export interface ZaloUserInfo {
  zaloId: string; // openId / id
  name?: string;
  avatar?: string;
}

/**
 * Bọc Zalo Open API (Graph API) cho luồng đăng nhập Mini App.
 * Flow spec 6.1: miniapp gửi { code, accessToken } → backend đổi lấy zaloId + profile.
 *
 * Tham chiếu:
 *  - https://developers.zalo.me/docs/api/social-api ... /me
 * Header `access_token` là token do zmp-sdk apis.login() / getAccessToken() trả về.
 */
@Injectable()
export class ZaloService {
  private readonly logger = new Logger(ZaloService.name);
  private readonly graphBase = 'https://graph.zalo.me/v2.0';
  private readonly oauthBase = 'https://oauth.zaloapp.com/v4';

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Đổi authorization code (Zalo Web Login OAuth v4, có PKCE) lấy access token.
   * Gate theo ZALO_APP_ID/SECRET — báo lỗi rõ khi chưa cấu hình (dev).
   */
  async exchangeOAuthCode(code: string, codeVerifier?: string): Promise<string> {
    const appId = this.config.get('ZALO_APP_ID', { infer: true });
    const secret = this.config.get('ZALO_APP_SECRET', { infer: true });
    if (!appId || !secret) {
      throw new UnauthorizedException('Đăng nhập Zalo (web) chưa được cấu hình.');
    }
    try {
      const params = new URLSearchParams({ app_id: appId, code, grant_type: 'authorization_code' });
      if (codeVerifier) params.set('code_verifier', codeVerifier);
      const res = await axios.post(`${this.oauthBase}/access_token`, params.toString(), {
        headers: { secret_key: secret, 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 8000,
      });
      const data = res.data as { access_token?: string; error?: number; error_description?: string };
      if (!data.access_token) {
        throw new UnauthorizedException(`Zalo OAuth thất bại: ${data.error_description ?? 'unknown'}`);
      }
      return data.access_token;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const ax = err as AxiosError;
      this.logger.error(`Zalo exchangeOAuthCode error: ${ax.message}`);
      throw new UnauthorizedException('Không đổi được mã đăng nhập Zalo.');
    }
  }

  /**
   * Lấy thông tin user từ access token của mini app.
   * Mini app gọi apis.getUserInfo()/getAccessToken(); BE verify token với Zalo.
   */
  async getUserInfo(accessToken: string): Promise<ZaloUserInfo> {
    try {
      const res = await axios.get(`${this.graphBase}/me`, {
        params: { fields: 'id,name,picture' },
        headers: { access_token: accessToken },
        timeout: 8000,
      });
      const data = res.data as {
        id?: string;
        error?: number;
        message?: string;
        name?: string;
        picture?: { data?: { url?: string } };
      };
      if (!data.id || (data.error && data.error !== 0)) {
        throw new UnauthorizedException(`Zalo verify thất bại: ${data.message ?? 'unknown'}`);
      }
      return {
        zaloId: data.id,
        name: data.name,
        avatar: data.picture?.data?.url,
      };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const ax = err as AxiosError;
      this.logger.error(`Zalo getUserInfo error: ${ax.message}`);
      throw new UnauthorizedException('Không xác thực được tài khoản Zalo.');
    }
  }

  /**
   * Giải mã số điện thoại từ token getPhoneNumber() (spec 6.1 bước 5).
   * Phase 0 để stub — hoàn thiện khi tích hợp checkout (Phase 1).
   */
  async resolvePhoneNumber(_phoneToken: string, _accessToken: string): Promise<string | null> {
    this.logger.warn('resolvePhoneNumber chưa implement (Phase 1).');
    return null;
  }
}
