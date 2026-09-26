import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { SystemConfigService } from '../../system-config/system-config.service';
import type {
  GomdonConfig,
  GomdonCreateOrderBody,
  GomdonCreateOrderResponse,
  GomdonLoginResponse,
} from './gomdon.types';
import {
  DEFAULT_GOMDON_WAREHOUSE,
  DEFAULT_GOMDON_WEIGHT_FALLBACK,
  GOMDON_CONFIG_KEY,
  hasGomdonCredentials,
  isGomdonRecyclingEnabled,
  loadGomdonConfig,
  resolveGomdonBaseUrl,
} from './gomdon-config';
import {
  GomdonAmbiguousError,
  GomdonRejectedError,
  classifyGomdonCreateError,
  looksLikeAuthFailure,
} from './gomdon.errors';

export { GOMDON_CONFIG_KEY };

/** Giá trị mặc định của phần cấu hình KHÔNG bí mật (seed + fallback). */
export const DEFAULT_GOMDON_CONFIG = {
  defaultWarehouse: DEFAULT_GOMDON_WAREHOUSE,
  defaultWeightFallback: DEFAULT_GOMDON_WEIGHT_FALLBACK,
};

export interface GomdonCancelResult {
  ok: boolean;
  message?: string;
}

@Injectable()
export class GomdonClient {
  private readonly logger = new Logger(GomdonClient.name);
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  // Token chỉ cache trong bộ nhớ (không ghi vào SystemConfig — trước đây có đọc token/tokenExpiresAt
  // từ config nhưng không nơi nào ghi, nên chỉ là đường đọc chết).
  private cachedToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  /** Single-flight: nhiều request cùng 401 chỉ đăng nhập 1 lần, không đá token của nhau. */
  private loginInFlight: Promise<string> | null = null;

  constructor(private readonly systemConfig: SystemConfigService) {
    this.baseUrl = resolveGomdonBaseUrl();
    this.http = axios.create({
      baseURL: this.baseUrl || undefined,
      timeout: 15000,
    });
  }

  async getConfig(): Promise<GomdonConfig> {
    return loadGomdonConfig(this.systemConfig);
  }

  /** Đủ base URL + tài khoản để gọi API (dev/test mặc định KHÔNG có base URL → false). */
  async isConfigured(): Promise<boolean> {
    return hasGomdonCredentials(await this.getConfig());
  }

  /** Cờ tính năng checkout: đã cấu hình VÀ admin bật công tắc. */
  async isRecyclingEnabled(): Promise<boolean> {
    return isGomdonRecyclingEnabled(this.systemConfig);
  }

  private async assertConfigured(): Promise<GomdonConfig> {
    const cfg = await this.getConfig();
    if (!hasGomdonCredentials(cfg)) {
      throw new ServiceUnavailableException('Gomdon chưa được cấu hình (GOMDON_BASE_URL/GOMDON_PHONE/GOMDON_PASSWORD).');
    }
    return cfg;
  }

  /** Đăng nhập Gomdon lấy token (POST /api/v2/auth/login). Single-flight. */
  async login(): Promise<string> {
    if (!this.loginInFlight) {
      this.loginInFlight = this.doLogin().finally(() => {
        this.loginInFlight = null;
      });
    }
    return this.loginInFlight;
  }

  private async doLogin(): Promise<string> {
    const cfg = await this.assertConfigured();
    // Không log số điện thoại/mật khẩu.
    this.logger.log('Đang đăng nhập Gomdon...');
    const formData = new FormData();
    formData.append('phone', cfg.phone);
    formData.append('password', cfg.password);

    try {
      const res = await this.http.post<GomdonLoginResponse>('/api/v2/auth/login', formData);

      if (!res.data.result || !res.data.data?.access_token) {
        throw new Error(`Đăng nhập Gomdon thất bại: ${res.data.message ?? 'Không có access_token'}`);
      }

      const token = res.data.data.access_token;
      // Cache token trong 24 giờ (hoặc expires_in nếu có), trừ 5 phút buffer.
      const expiresInSeconds = res.data.data.expires_in ?? 86400;
      this.cachedToken = token;
      this.tokenExpiresAt = Date.now() + Math.max(expiresInSeconds - 300, 60) * 1000;
      return token;
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const data = err.response?.data as { message?: string } | undefined;
        const errorDetail = data?.message ?? JSON.stringify(err.response?.data ?? err.message);
        throw new Error(`Đăng nhập Gomdon thất bại (HTTP ${err.response?.status ?? 'ERR'}): ${errorDetail}`);
      }
      throw err;
    }
  }

  async getValidToken(): Promise<string> {
    if (this.cachedToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }
    return this.login();
  }

  private invalidateToken(): void {
    this.cachedToken = null;
    this.tokenExpiresAt = null;
  }

  /**
   * Tạo đơn đổi hàng Gomdon (POST /api/v2/order/create, multipart/form-data).
   *
   * Lỗi được PHÂN LOẠI để caller không tạo trùng vận đơn:
   *  - GomdonRejectedError: chắc chắn chưa tạo (lỗi đăng nhập, 4xx, result:false, chưa gửi được) → retry an toàn.
   *  - GomdonAmbiguousError: có thể đã tạo (timeout, rớt kết nối, 5xx, result:true thiếu data) → KHÔNG retry.
   */
  async createOrder(body: GomdonCreateOrderBody): Promise<GomdonCreateOrderResponse> {
    let token: string;
    try {
      await this.assertConfigured();
      token = await this.getValidToken();
    } catch (err) {
      // Chưa gửi request tạo đơn nào → retry an toàn.
      throw new GomdonRejectedError(err instanceof Error ? err.message : String(err));
    }

    const sendRequest = (authToken: string): Promise<AxiosResponse<GomdonCreateOrderResponse>> => {
      const formData = new FormData();
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) {
          formData.append(key, String(value));
        }
      }
      return this.http.post<GomdonCreateOrderResponse>('/api/v2/order/create', formData, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
    };

    const reLogin = async (): Promise<string> => {
      this.invalidateToken();
      try {
        return await this.login();
      } catch (err) {
        throw new GomdonRejectedError(err instanceof Error ? err.message : String(err));
      }
    };

    let res: AxiosResponse<GomdonCreateOrderResponse>;
    let retriedAuth = false;
    try {
      res = await sendRequest(token);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        // 401 = Gomdon từ chối token, chưa tạo đơn → đăng nhập lại và thử đúng 1 lần.
        this.logger.warn('Token Gomdon 401, đang đăng nhập lại và thử lại...');
        retriedAuth = true;
        token = await reLogin();
        try {
          res = await sendRequest(token);
        } catch (retryErr) {
          throw classifyGomdonCreateError(retryErr, 'Gomdon tạo đơn thất bại sau khi đăng nhập lại');
        }
      } else {
        throw classifyGomdonCreateError(err, 'Gomdon tạo đơn thất bại');
      }
    }

    if (!res.data?.result) {
      // Một số API trả 200 + result:false khi token hết hạn (không phải 401) — đăng nhập lại 1 lần.
      if (!retriedAuth && looksLikeAuthFailure(res.data?.message)) {
        this.logger.warn(`Gomdon báo lỗi xác thực (${res.data?.message}) — đăng nhập lại và thử lại...`);
        token = await reLogin();
        try {
          res = await sendRequest(token);
        } catch (retryErr) {
          throw classifyGomdonCreateError(retryErr, 'Gomdon tạo đơn thất bại sau khi đăng nhập lại');
        }
        if (res.data?.result && res.data.data) return res.data;
      }
      if (!res.data?.result) {
        throw new GomdonRejectedError(`Gomdon trả về lỗi tạo đơn: ${res.data?.message ?? JSON.stringify(res.data)}`);
      }
    }
    if (!res.data.data) {
      throw new GomdonAmbiguousError(`Gomdon báo tạo đơn thành công nhưng không trả dữ liệu: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  }

  /**
   * Hủy đơn Gomdon (POST /api/v2/order/cancel/{id}). Idempotent phía caller (gomdonCancelStatus).
   * 401 → đăng nhập lại 1 lần. result:false → { ok:false } để caller retry/báo CSKH.
   */
  async cancelOrder(gomdonOrderId: string | number): Promise<GomdonCancelResult> {
    await this.assertConfigured();
    const send = async (token: string) =>
      this.http.post<{ result?: boolean; message?: string }>(
        `/api/v2/order/cancel/${encodeURIComponent(String(gomdonOrderId))}`,
        new FormData(),
        { headers: { Authorization: `Bearer ${token}` } },
      );

    let res: AxiosResponse<{ result?: boolean; message?: string }>;
    try {
      res = await send(await this.getValidToken());
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        this.invalidateToken();
        res = await send(await this.login());
      } else {
        throw err;
      }
    }
    if (res.data?.result === false && looksLikeAuthFailure(res.data.message)) {
      this.invalidateToken();
      res = await send(await this.login());
    }
    // Chỉ coi là huỷ xong khi Gomdon nói rõ result:true — không rõ thì để caller retry rồi báo CSKH
    // (báo nhầm "chưa huỷ được" rẻ hơn nhiều so với để bưu tá tới lấy hàng của đơn đã huỷ).
    return { ok: res.data?.result === true, message: res.data?.message };
  }
}
