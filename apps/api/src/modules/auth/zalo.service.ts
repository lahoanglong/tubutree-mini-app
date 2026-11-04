import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import axios, { AxiosError } from 'axios';
import type { Env } from '../../config/env.validation';
import { normalizeZaloPhone } from '../../common/phone';

const ZALO_BUSY_MESSAGE = 'Zalo đang bận, bạn thử lại sau ít phút nhé.';

/** Zalo không trả lời được (mất kết nối, quá hạn chờ, 5xx, quá tải 429): lỗi tạm của Zalo, không phải lỗi của khách. */
function isZaloUnavailable(err: AxiosError): boolean {
  const status = err.response?.status;
  return status === undefined || status >= 500 || status === 429;
}

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
/** Lời lỗi trong thân phản hồi Zalo (chuỗi hoặc {message}), cắt ngắn; không bao giờ chứa token vì Zalo không phản chiếu header. */
function errorMessageOf(data: unknown): string | undefined {
  const raw = typeof data === 'string' ? data : (data as { message?: unknown } | null | undefined)?.message;
  return typeof raw === 'string' && raw ? raw.slice(0, 200) : undefined;
}

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
        // Lời của Zalo ("invalid code") chỉ để chẩn đoán; khách nhận câu tiếng Việt và biết phải làm gì tiếp.
        this.logger.warn(`Zalo exchangeOAuthCode bị từ chối: ${data.error ?? '?'} ${data.error_description ?? 'unknown'}`);
        throw new UnauthorizedException('Mã đăng nhập Zalo không hợp lệ hoặc đã hết hạn. Bạn đăng nhập lại nhé.');
      }
      return data.access_token;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      const ax = err as AxiosError;
      this.logger.error(`Zalo exchangeOAuthCode error: ${ax.message}`);
      if (isZaloUnavailable(ax)) throw new ServiceUnavailableException(ZALO_BUSY_MESSAGE);
      throw new UnauthorizedException('Không đổi được mã đăng nhập Zalo. Bạn đăng nhập lại nhé.');
    }
  }

  /**
   * Lấy thông tin user từ access token của mini app.
   * Mini app gọi apis.getUserInfo()/getAccessToken(); BE verify token với Zalo.
   */
  async getUserInfo(accessToken: string): Promise<ZaloUserInfo> {
    const secret = this.config.get('ZALO_APP_SECRET', { infer: true });
    try {
      // appsecret_proof buộc access token chỉ dùng được bởi máy chủ giữ app secret: token lộ ra ngoài không đổi được lấy hồ sơ người dùng.
      // Zalo từ chối lượt có proof (cách tính khác dự kiến) thì thử đúng một lần không proof để không làm hỏng đăng nhập; hàng rào thật
      // nằm ở Zalo: khi bật "bắt buộc appsecret_proof" thì lượt không proof cũng bị từ chối.
      const proof = secret ? createHmac('sha256', secret).update(accessToken).digest('hex') : null;
      let result = await this.fetchMe(accessToken, proof);
      let retried = false;
      let firstDetail = '';
      let proofNamed = false;
      if (proof && result.kind !== 'ok') {
        if (result.kind === 'unavailable') throw result.error;
        firstDetail = result.kind === 'rejected' ? `HTTP ${result.status}` : `error ${result.code ?? '?'} ${result.message ?? ''}`.trim();
        proofNamed = /appsecret/i.test(result.message ?? '');
        retried = true;
        result = await this.fetchMe(accessToken, null);
        if (result.kind === 'ok') {
          this.logger.error(`Zalo từ chối appsecret_proof nhưng chấp nhận khi không có proof (${firstDetail}); kiểm tra cách tính proof.`);
        }
      }
      if (result.kind === 'unavailable') throw result.error;
      if (result.kind !== 'ok') {
        if (retried && proofNamed) this.logger.error(`Zalo từ chối cả hai lượt và phản hồi nhắc appsecret_proof (${firstDetail}); kiểm tra ZALO_APP_SECRET và cách tính proof.`);
        else if (retried) this.logger.warn(`Zalo getUserInfo bị từ chối cả hai lượt (${firstDetail}).`);
        else if (result.kind === 'body') this.logger.warn(`Zalo getUserInfo bị từ chối: ${result.code ?? '?'} ${result.message ?? 'unknown'}`);
        else this.logger.error(`Zalo getUserInfo error: HTTP ${result.status ?? '?'}`);
        throw new UnauthorizedException('Không xác thực được tài khoản Zalo.');
      }
      return result.info;
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ServiceUnavailableException) throw err;
      const ax = err as AxiosError;
      this.logger.error(`Zalo getUserInfo error: ${ax.message}`);
      if (isZaloUnavailable(ax)) throw new ServiceUnavailableException(ZALO_BUSY_MESSAGE);
      throw new UnauthorizedException('Không xác thực được tài khoản Zalo.');
    }
  }

  private async fetchMe(
    accessToken: string,
    proof: string | null,
  ): Promise<
    | { kind: 'ok'; info: ZaloUserInfo }
    | { kind: 'body'; code?: number; message?: string }
    | { kind: 'rejected'; status: number | undefined; message?: string }
    | { kind: 'unavailable'; error: AxiosError }
  > {
    try {
      const res = await axios.get(`${this.graphBase}/me`, {
        params: { fields: 'id,name,picture' },
        headers: { access_token: accessToken, ...(proof ? { appsecret_proof: proof } : {}) },
        timeout: 8000,
      });
      const data = res.data as {
        id?: string;
        error?: number;
        message?: string;
        name?: string;
        picture?: { data?: { url?: string } };
      };
      if (!data.id || (data.error && data.error !== 0)) return { kind: 'body', code: data.error, message: data.message };
      return { kind: 'ok', info: { zaloId: data.id, name: data.name, avatar: data.picture?.data?.url } };
    } catch (err) {
      const ax = err as AxiosError;
      if (isZaloUnavailable(ax)) return { kind: 'unavailable', error: ax };
      return { kind: 'rejected', status: ax.response?.status, message: errorMessageOf(ax.response?.data) };
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
      return normalizeZaloPhone(data.data?.number);
    } catch (err) {
      const ax = err as AxiosError;
      this.logger.error(`Zalo resolvePhoneNumber error: ${ax.message}`);
      return null; // không chặn đăng nhập nếu giải mã SĐT lỗi
    }
  }
}
