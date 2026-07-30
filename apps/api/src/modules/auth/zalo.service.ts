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
   * Giải mã số điện thoại từ token apis.getPhoneNumber() (spec §6.1 bước 5).
   * Zalo Graph /me/info: header access_token (user) + code (phone token) + secret_key (app).
   * Trả về số đã chuẩn hoá về dạng nội địa 0xxxxxxxxx, hoặc null nếu không lấy được.
   */
  async resolvePhoneNumber(phoneToken: string, accessToken: string): Promise<string | null> {
    const secret = this.config.get('ZALO_APP_SECRET', { infer: true });
    if (!secret) {
      this.logger.warn('resolvePhoneNumber: thiếu ZALO_APP_SECRET — bỏ qua.');
      return null;
    }
    try {
      const res = await axios.get(`${this.graphBase}/me/info`, {
        headers: { access_token: accessToken, code: phoneToken, secret_key: secret },
        timeout: 8000,
      });
      const data = res.data as {
        data?: { number?: string };
        error?: number;
        message?: string;
      };
      if (data.error && data.error !== 0) {
        this.logger.warn(`resolvePhoneNumber Zalo error ${data.error}: ${data.message ?? ''}`);
        return null;
      }
      return this.normalizePhone(data.data?.number);
    } catch (err) {
      const ax = err as AxiosError;
      this.logger.error(`Zalo resolvePhoneNumber error: ${ax.message}`);
      return null; // không chặn đăng nhập nếu giải mã SĐT lỗi
    }
  }

  /** Chuẩn hoá số Zalo (thường trả 84xxxxxxxxx) về dạng nội địa 0xxxxxxxxx. */
  private normalizePhone(raw?: string): string | null {
    if (!raw) return null;
    const digits = raw.replace(/[^0-9]/g, '');
    if (!digits) return null;
    let formatted = digits;
    if (digits.startsWith('84')) formatted = `0${digits.slice(2)}`;
    else if (!digits.startsWith('0')) formatted = `0${digits}`;
    if (!/^0[0-9]{9}$/.test(formatted)) return null;
    return formatted;
  }
}
