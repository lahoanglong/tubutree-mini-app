import { Injectable, Logger, type OnApplicationBootstrap, Optional, ServiceUnavailableException } from '@nestjs/common';
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import { SystemConfigService } from '../../system-config/system-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  GomdonAddressCheck,
  GomdonConfig,
  GomdonCreateOrderBody,
  GomdonCreateOrderResponse,
  GomdonLoginResponse,
  GomdonRegisterWebhookResult,
  GomdonShopFeeParams,
  GomdonShopFeeQuote,
} from './gomdon.types';
import {
  DEFAULT_GOMDON_WAREHOUSE,
  DEFAULT_GOMDON_WEIGHT_FALLBACK,
  GOMDON_CONFIG_KEY,
  GOMDON_SHOP_FEE_FALLBACK,
  hasGomdonCredentials,
  isGomdonRecyclingEnabled,
  loadGomdonConfig,
  resolveGomdonBaseUrl,
} from './gomdon-config';
import {
  GomdonAmbiguousError,
  GomdonDuplicateOrderError,
  GomdonRejectedError,
  classifyGomdonCreateError,
  looksLikeAuthFailure,
  looksLikeDuplicateOrder,
} from './gomdon.errors';
import { gomdonHealth, type GomdonHealthSnapshot } from './gomdon-health';
import { PrismaGomdonHealthStore } from './gomdon-health-store';
import { maskWebhookUrl, scrubWebhookUrl } from './gomdon-webhook-url';

export { GOMDON_CONFIG_KEY };

/** Giữ token tối đa 24 giờ kể cả khi Gomdon trả expires_at = null (token không tự hết hạn). */
const TOKEN_MAX_CACHE_MS = 24 * 3600_000;
/** Đăng nhập lại trước mốc expires_at một khoảng để không gửi request sát giờ hết hạn. */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60_000;
const TOKEN_MIN_CACHE_MS = 60_000;
/**
 * Gomdon vừa từ chối tài khoản → không đăng nhập lại trong khoảng này (mỗi job tạo/huỷ vận đơn đang thử lại
 * đều gọi đăng nhập; gõ sai mật khẩu liên tục có thể làm Gomdon khoá tài khoản).
 */
const LOGIN_REJECTED_COOLDOWN_MS = 60_000;
/** Kết quả kiểm tra địa chỉ HỢP LỆ giữ 24 giờ (tài liệu: /order/check-address giới hạn 120 lượt/phút). */
const ADDRESS_CACHE_MS = 24 * 3600_000;
const ADDRESS_CACHE_MAX_ENTRIES = 10_000;
/** Giới hạn nội bộ thấp hơn trần 120/phút của Gomdon: vượt thì bỏ qua bước kiểm tra thay vì chặn khách. */
const ADDRESS_CHECK_MAX_PER_MINUTE = 100;

/** Khoá cache địa chỉ: bỏ khác biệt khoảng trắng/hoa thường giữa các lần khách nhập. */
function addressKey(province: string, ward: string): string {
  const norm = (v: string) => v.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(province)}|${norm(ward)}`;
}

/** id đơn Gomdon dùng được: số dương hoặc chuỗi khác rỗng/0. */
function validGomdonId(v: unknown): string | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? String(v) : null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s !== '' && s !== '0' ? s : null;
  }
  return null;
}

/** Mô tả lỗi gọi Gomdon không kèm dữ liệu khách (HTTP status/mã lỗi + message của Gomdon). */
function describeHttpError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: unknown } | undefined)?.message;
    return `HTTP ${err.response?.status ?? err.code ?? 'ERR'}${typeof message === 'string' ? `: ${message}` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Lỗi đăng nhập mà Gomdon đã trả lời rõ là TỪ CHỐI tài khoản (khác lỗi mạng/quá tải). */
class GomdonLoginRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GomdonLoginRejectedError';
  }
}

/**
 * Thời gian giữ token theo `data.expires_at` của API đăng nhập (tài liệu: null, hoặc thời điểm kiểu
 * Laravel "2026-09-27T00:10:00.000000Z"). Không đọc được → 24 giờ; 401 luôn kéo đăng nhập lại.
 */
function tokenCacheMs(expiresAt: unknown, now: number): number {
  if (typeof expiresAt !== 'string' || !expiresAt.trim()) return TOKEN_MAX_CACHE_MS;
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return TOKEN_MAX_CACHE_MS;
  return Math.min(TOKEN_MAX_CACHE_MS, Math.max(at - now - TOKEN_EXPIRY_BUFFER_MS, TOKEN_MIN_CACHE_MS));
}

/** Giá trị mặc định của phần cấu hình KHÔNG bí mật (seed + fallback). */
export const DEFAULT_GOMDON_CONFIG = {
  defaultWarehouse: DEFAULT_GOMDON_WAREHOUSE,
  defaultWeightFallback: DEFAULT_GOMDON_WEIGHT_FALLBACK,
};

export interface GomdonCancelResult {
  ok: boolean;
  message?: string;
}

export interface GomdonConnectionCheck {
  ok: boolean;
  message: string;
  checkedAt: string;
}

@Injectable()
export class GomdonClient implements OnApplicationBootstrap {
  private readonly logger = new Logger(GomdonClient.name);
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;
  // Token chỉ cache trong bộ nhớ (không ghi vào SystemConfig — trước đây có đọc token/tokenExpiresAt
  // từ config nhưng không nơi nào ghi, nên chỉ là đường đọc chết).
  private cachedToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  /** Single-flight: nhiều request cùng 401 chỉ đăng nhập 1 lần, không đá token của nhau. */
  private loginInFlight: Promise<string> | null = null;
  private readonly health = gomdonHealth;
  /** `province|ward` hợp lệ → thời điểm hết hạn cache (ms). Kết quả không hợp lệ không cache. */
  private readonly addressCache = new Map<string, number>();
  private addressCheckCalls: number[] = [];

  constructor(
    private readonly systemConfig: SystemConfigService,
    // Optional: test dựng tay không có DB thì trạng thái đăng nhập chỉ nằm trong bộ nhớ như trước.
    @Optional() prisma?: PrismaService,
  ) {
    if (prisma) this.health.attachStore(new PrismaGomdonHealthStore(prisma));
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

  /** Cờ tính năng checkout: đã cấu hình, admin bật công tắc VÀ Gomdon không đang từ chối tài khoản. */
  async isRecyclingEnabled(): Promise<boolean> {
    return isGomdonRecyclingEnabled(this.systemConfig, process.env, this.health);
  }

  /** Trạng thái chung của mọi replica (đọc lại bản ghi chung nếu đã cũ). */
  async getHealth(): Promise<GomdonHealthSnapshot> {
    await this.health.refresh();
    return this.health.snapshot();
  }

  /** Admin bấm "Kiểm tra kết nối": luôn đăng nhập thật (bỏ token cache và thời gian chờ sau khi bị từ chối). */
  async checkConnection(): Promise<GomdonConnectionCheck> {
    const checkedAt = new Date().toISOString();
    try {
      await this.assertConfigured();
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), checkedAt };
    }
    this.invalidateToken();
    try {
      await this.login({ force: true });
      return { ok: true, message: 'Đăng nhập Gomdon thành công.', checkedAt };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), checkedAt };
    }
  }

  /**
   * Cron cứu hộ: tài khoản đang bị từ chối thì thử đăng nhập lại thưa thớt, để lựa chọn thu gom tự bật lại
   * khi Gomdon mở khoá/khôi phục tài khoản mà không phải khởi động lại API.
   */
  async probeRejectedLogin(minIntervalMs: number): Promise<void> {
    // Chỉ leader chạy cron này: phải thấy cả lần từ chối của replica khác, không chỉ của chính nó.
    await this.health.refresh();
    const since = this.health.msSinceCredentialsRejected();
    if (since == null || since < minIntervalMs) return;
    this.invalidateToken();
    await this.login({ force: true }).catch(() => undefined);
  }

  /**
   * Lần bị từ chối nằm trong bản ghi chung nên sống qua lần khởi động lại; ops sửa env rồi khởi động lại API (lời dặn ở thẻ Gomdon
   * của admin) mà không thử đăng nhập ngay thì thu gom vẫn ẩn tới lượt cron dò lại (tới ~40 phút). Không chặn khởi động.
   */
  onApplicationBootstrap(): void {
    void this.recheckRejectedLoginOnBoot();
  }

  /**
   * Bản ghi chung báo đang bị từ chối → đăng nhập thử đúng một lần, bỏ thời gian chờ chống khoá tài khoản: tiến trình này chưa
   * gửi tài khoản (có thể đã sửa) của nó lần nào. Được thì mọi replica bật lại thu gom; vẫn sai thì chỉ ghi lại lần từ chối.
   */
  async recheckRejectedLoginOnBoot(): Promise<void> {
    try {
      if (!(await this.isConfigured())) return;
      await this.health.refresh();
      if (!this.health.credentialsRejected) return;
      this.invalidateToken();
      await this.login({ force: true });
      this.logger.log('Gomdon đã nhận tài khoản khi khởi động — gỡ trạng thái bị từ chối cho mọi replica.');
    } catch (err) {
      this.logger.warn(`Thử đăng nhập Gomdon lúc khởi động không được: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async assertConfigured(): Promise<GomdonConfig> {
    const cfg = await this.getConfig();
    if (!hasGomdonCredentials(cfg)) {
      throw new ServiceUnavailableException('Gomdon chưa được cấu hình (GOMDON_BASE_URL/GOMDON_PHONE/GOMDON_PASSWORD).');
    }
    return cfg;
  }

  /** Đăng nhập Gomdon lấy token (POST /api/v2/auth/login). Single-flight. */
  async login(opts: { force?: boolean } = {}): Promise<string> {
    if (!opts.force) await this.health.refresh();
    const since = this.health.msSinceCredentialsRejected();
    if (!opts.force && since != null && since < LOGIN_REJECTED_COOLDOWN_MS) {
      throw new GomdonLoginRejectedError(
        `Gomdon vừa từ chối đăng nhập, chưa thử lại: ${this.health.snapshot().lastError ?? 'sai tài khoản'}`,
      );
    }
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

    let res: AxiosResponse<GomdonLoginResponse>;
    try {
      res = await this.http.post<GomdonLoginResponse>('/api/v2/auth/login', formData);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const data = err.response?.data as { message?: string } | undefined;
        const errorDetail = data?.message ?? JSON.stringify(err.response?.data ?? err.message);
        const message = `Đăng nhập Gomdon thất bại (HTTP ${status ?? 'ERR'}): ${errorDetail}`;
        // Gomdon trả lời 4xx (trừ 429 quá tải) = từ chối tài khoản; không có response / 5xx = lỗi tạm.
        const rejected = status !== undefined && status >= 400 && status < 500 && status !== 429;
        await this.health.recordError(message, { credentialsRejected: rejected });
        throw rejected ? new GomdonLoginRejectedError(message) : new Error(message);
      }
      await this.health.recordError(err instanceof Error ? err.message : String(err));
      throw err;
    }

    if (!res.data?.result || !res.data.data?.access_token) {
      const message = `Đăng nhập Gomdon thất bại: ${res.data?.message ?? 'Không có access_token'}`;
      await this.health.recordError(message, { credentialsRejected: true });
      throw new GomdonLoginRejectedError(message);
    }

    const token = res.data.data.access_token;
    const now = Date.now();
    this.cachedToken = token;
    this.tokenExpiresAt = now + tokenCacheMs(res.data.data.expires_at, now);
    await this.health.recordOk();
    return token;
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
   * Tạo đơn đổi hàng Gomdon (POST /api/v2/order/create, multipart/form-data, header Bearer).
   *
   * Lỗi được PHÂN LOẠI để caller không tạo trùng vận đơn:
   *  - GomdonRejectedError: chắc chắn chưa tạo (lỗi đăng nhập, 4xx, result:false, chưa gửi được) → retry an toàn.
   *  - GomdonDuplicateOrderError: Gomdon báo order_customer_id đã có đơn → ĐÃ có vận đơn, KHÔNG retry.
   *  - GomdonAmbiguousError: có thể đã tạo (timeout, rớt kết nối, 5xx, result:true thiếu data) → KHÔNG retry.
   * Gomdon không có API tra cứu đơn (theo id hay order_customer_id) nên không tự đối soát được — kiểm tra tay.
   */
  async createOrder(body: GomdonCreateOrderBody): Promise<GomdonCreateOrderResponse> {
    let token: string;
    try {
      await this.assertConfigured();
      token = await this.getValidToken();
    } catch (err) {
      // Chưa gửi request tạo đơn nào → retry an toàn. Đăng nhập lỗi (kể cả sai tài khoản) là lỗi TẠM: admin
      // sửa tài khoản / Gomdon hết sự cố thì đơn đang chờ tự tạo được, không cần kho tạo tay.
      throw new GomdonRejectedError(err instanceof Error ? err.message : String(err), { transient: true });
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
        throw new GomdonRejectedError(err instanceof Error ? err.message : String(err), { transient: true });
      }
    };

    try {
      const created = await this.sendCreate(token, sendRequest, reLogin);
      await this.health.recordOk();
      return created;
    } catch (err) {
      if (!(err instanceof GomdonDuplicateOrderError) && (!(err instanceof GomdonRejectedError) || err.transient)) {
        await this.health.recordError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }

  private async sendCreate(
    initialToken: string,
    sendRequest: (authToken: string) => Promise<AxiosResponse<GomdonCreateOrderResponse>>,
    reLogin: () => Promise<string>,
  ): Promise<GomdonCreateOrderResponse> {
    let token = initialToken;
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
      // Tài liệu: token sai → HTTP 401 (nhánh trên). Phòng khi Gomdon trả 200 + result:false kèm thông
      // điệp token (không phải 401) — đăng nhập lại 1 lần; result:false nghĩa là chưa tạo nên gửi lại an toàn.
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
        const detail = res.data?.message ?? JSON.stringify(res.data);
        // Tài liệu: order_customer_id đã có đơn còn hiệu lực → result:false + duplicate:true + data.id (mã đơn cũ).
        // Gửi lại vì mất mạng thì đây chính là đơn của lần gửi trước → coi là tạo thành công.
        if (res.data?.duplicate === true) {
          const existing = res.data.data ?? {};
          const existingId = validGomdonId(existing.id);
          if (existingId) {
            this.logger.warn('Gomdon báo order_customer_id đã có đơn — dùng mã đơn cũ như tạo thành công.');
            return {
              result: true,
              message: res.data.message,
              data: {
                ...existing,
                id: existingId,
                partner_code: existing.partner_code ?? existing.order_code,
                status: existing.status ?? 1,
              },
            };
          }
          throw new GomdonDuplicateOrderError(`Gomdon báo mã đơn (order_customer_id) đã có đơn nhưng không trả id: ${detail}`);
        }
        // order_customer_id "dùng để check unique" (tài liệu): bị từ chối vì trùng = Gomdon ĐÃ CÓ đơn này.
        if (looksLikeDuplicateOrder(res.data?.message)) {
          throw new GomdonDuplicateOrderError(`Gomdon báo mã đơn (order_customer_id) đã có đơn: ${detail}`);
        }
        // Lỗi validate/nghiệp vụ của Gomdon trả HTTP 200 + result:false (tài liệu) → chắc chắn chưa tạo.
        // Vẫn báo lỗi xác thực sau khi đã đăng nhập lại → lỗi tài khoản (tạm), không phải lỗi dữ liệu đơn.
        throw new GomdonRejectedError(`Gomdon trả về lỗi tạo đơn: ${detail}`, {
          transient: looksLikeAuthFailure(res.data?.message),
        });
      }
    }
    if (!res.data.data) {
      throw new GomdonAmbiguousError(`Gomdon báo tạo đơn thành công nhưng không trả dữ liệu: ${JSON.stringify(res.data)}`);
    }
    return res.data;
  }

  /**
   * Hủy đơn Gomdon (POST /api/v2/order/cancel/{id}, id = mã số đơn Gomdon = data.id lúc tạo, form rỗng).
   * Tài liệu: chỉ huỷ được đơn CHƯA lấy hàng; kết quả luôn HTTP 200 + result true/false + message
   * (vd "Không tìm thấy đơn hàng"). Idempotent phía caller (gomdonCancelStatus).
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

  /**
   * POST có Bearer cho các API phụ (kiểm tra địa chỉ, báo phí, đăng ký webhook): 401 hoặc result:false kèm thông điệp
   * token → đăng nhập lại và gửi lại đúng 1 lần. Form dựng lại mỗi lần gửi.
   */
  private async postWithRelogin<T extends { result?: boolean; message?: string }>(
    path: string,
    buildForm: () => FormData,
  ): Promise<AxiosResponse<T>> {
    const send = (token: string) =>
      this.http.post<T>(path, buildForm(), { headers: { Authorization: `Bearer ${token}` } });
    let res: AxiosResponse<T>;
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
    return res;
  }

  /** Còn lượt gọi check-address trong giới hạn nội bộ (cửa sổ trượt 60 giây)? Còn thì ghi nhận một lượt. */
  private takeAddressCheckSlot(now: number): boolean {
    this.addressCheckCalls = this.addressCheckCalls.filter((t) => now - t < 60_000);
    if (this.addressCheckCalls.length >= ADDRESS_CHECK_MAX_PER_MINUTE) return false;
    this.addressCheckCalls.push(now);
    return true;
  }

  /**
   * Kiểm tra Gomdon có nhận diện địa chỉ 2 cấp (tỉnh/thành + phường/xã) không — POST /api/v2/order/check-address.
   * Chỉ cache kết quả HỢP LỆ (24 giờ). Không bao giờ chặn khách vì lỗi phía hạ tầng: chưa cấu hình, lỗi mạng/5xx/429,
   * vượt giới hạn nội bộ → `{ ok:true, skipped:true }`. Chỉ `ok:false` khi Gomdon nói rõ không nhận diện được.
   */
  async checkAddress(province: string, ward: string): Promise<GomdonAddressCheck> {
    const p = (province ?? '').trim();
    const w = (ward ?? '').trim();
    if (!p || !w) return { ok: false, message: 'Thiếu tỉnh/thành hoặc phường/xã.' };

    const key = addressKey(p, w);
    const now = Date.now();
    const cachedUntil = this.addressCache.get(key);
    if (cachedUntil !== undefined) {
      if (cachedUntil > now) return { ok: true };
      this.addressCache.delete(key);
    }

    try {
      if (!(await this.isConfigured())) return { ok: true, skipped: true };
      if (!this.takeAddressCheckSlot(now)) {
        this.logger.warn('Gomdon check-address: vượt giới hạn nội bộ, bỏ qua bước kiểm tra địa chỉ.');
        return { ok: true, skipped: true };
      }
      const res = await this.postWithRelogin<{ result?: boolean; message?: string }>('/api/v2/order/check-address', () => {
        const form = new FormData();
        form.append('province', p);
        form.append('ward', w);
        return form;
      });
      if (res.data?.result === true) {
        if (this.addressCache.size >= ADDRESS_CACHE_MAX_ENTRIES) this.addressCache.clear();
        this.addressCache.set(key, now + ADDRESS_CACHE_MS);
        return { ok: true, message: res.data.message };
      }
      if (res.data?.result === false) {
        return { ok: false, message: res.data.message ?? 'Gomdon không nhận diện được địa chỉ.' };
      }
      this.logger.warn('Gomdon check-address trả phản hồi không có result — bỏ qua bước kiểm tra địa chỉ.');
      return { ok: true, skipped: true };
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 422) {
        const message = (err.response.data as { message?: string } | undefined)?.message;
        return { ok: false, message: message ?? 'Thiếu tỉnh/thành hoặc phường/xã.' };
      }
      this.logger.warn(`Gomdon check-address lỗi (${describeHttpError(err)}) — bỏ qua bước kiểm tra địa chỉ.`);
      return { ok: true, skipped: true };
    }
  }

  /**
   * Tạm tính phí vận chuyển — POST /api/v2/order/shop-fee (weight gram, tiền VND, kích thước mm). Không bao giờ ném lỗi:
   * Gomdon chưa cấu hình, lỗi mạng/5xx/timeout, result:false hoặc phí không phải số dương → phí ước lượng cố định
   * (`estimated: true`) để checkout vẫn hiển thị được một con số.
   */
  async quoteShopFeeDetailed(params: GomdonShopFeeParams): Promise<GomdonShopFeeQuote> {
    const estimate = (reason: string): GomdonShopFeeQuote => {
      this.logger.warn(`Gomdon shop-fee: dùng phí ước lượng ${GOMDON_SHOP_FEE_FALLBACK}đ (${reason}).`);
      return { fee: GOMDON_SHOP_FEE_FALLBACK, estimated: true };
    };
    try {
      if (!(await this.isConfigured())) return estimate('Gomdon chưa cấu hình');
      const res = await this.postWithRelogin<{ result?: boolean; message?: string; data?: unknown }>(
        '/api/v2/order/shop-fee',
        () => {
          const form = new FormData();
          const fields: Array<[string, number | undefined]> = [
            ['weight', params.weight],
            ['collect_amount', params.collectAmount],
            ['product_price', params.productPrice],
            ['width', params.width],
            ['height', params.height],
            ['length', params.length],
          ];
          for (const [name, value] of fields) {
            if (typeof value === 'number' && Number.isFinite(value)) form.append(name, String(Math.round(value)));
          }
          return form;
        },
      );
      const fee = Number(res.data?.data);
      if (res.data?.result === true && Number.isFinite(fee) && fee > 0) return { fee, estimated: false };
      return estimate('phản hồi không dùng được');
    } catch (err) {
      return estimate(describeHttpError(err));
    }
  }

  async quoteShopFee(params: GomdonShopFeeParams): Promise<number> {
    return (await this.quoteShopFeeDetailed(params)).fee;
  }

  /**
   * Đăng ký URL nhận webhook (POST /api/v2/auth/user/update, trường webhook_url). Chỉ nhận https. URL có thể mang secret
   * ở cuối đường dẫn nên log/thông báo lỗi chỉ dùng dạng đã che (`.../gomdon/***`). Không ném lỗi — trả `{ ok:false, message }`.
   */
  async registerWebhookUrl(webhookUrl: string): Promise<GomdonRegisterWebhookResult> {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      return { ok: false, message: 'URL webhook không hợp lệ.' };
    }
    if (parsed.protocol !== 'https:') return { ok: false, message: 'Gomdon chỉ nhận webhook_url dạng https.' };

    const masked = maskWebhookUrl(webhookUrl);
    try {
      await this.assertConfigured();
      this.logger.log(`Đăng ký webhook Gomdon: ${masked}`);
      const res = await this.postWithRelogin<{ result?: boolean; message?: string }>('/api/v2/auth/user/update', () => {
        const form = new FormData();
        form.append('webhook_url', webhookUrl);
        return form;
      });
      const message = res.data?.message ? scrubWebhookUrl(res.data.message, webhookUrl) : undefined;
      if (res.data?.result === true) {
        this.logger.log(`Gomdon đã nhận webhook_url ${masked}.`);
        return { ok: true, message };
      }
      this.logger.warn(`Gomdon không nhận webhook_url ${masked}: ${message ?? 'không có thông điệp'}`);
      return { ok: false, message: message ?? 'Gomdon không xác nhận đăng ký webhook.' };
    } catch (err) {
      const message = scrubWebhookUrl(describeHttpError(err), webhookUrl);
      this.logger.warn(`Đăng ký webhook Gomdon ${masked} lỗi: ${message}`);
      return { ok: false, message };
    }
  }
}
