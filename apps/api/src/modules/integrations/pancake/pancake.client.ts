import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { isAxiosError, type AxiosInstance } from 'axios';
import type { Env } from '../../../config/env.validation';
import type {
  PancakeCreateOrderBody,
  PancakeCreateOrderResponse,
  PancakeOrderDTO,
  PancakeOrderListResponse,
  PancakeUpdateOrderBody,
  PancakeProductsResponse,
  PancakeCategoryNode,
  PancakeProvinceDTO,
  PancakeCommuneDTO,
  PancakeGeoResponse,
} from './pancake.types';
import { PancakeApiError } from './pancake-outbound';

/** Thời gian chờ mặc định; huỷ đơn đồng bộ trên đường request của khách dùng mức ngắn hơn (PancakeSyncHooks). */
export const PANCAKE_HTTP_TIMEOUT_MS = 15_000;

type PancakeBody = { success?: boolean; message?: string; error?: string } | null | undefined;

/** `success:false` trong HTTP 200 → lỗi dứt khoát (kèm lời Pancake); `order_not_found` → notFound. */
function assertSuccess<T extends PancakeBody>(body: T, what: string): T {
  if (body && body.success === false) {
    const reason = body.message ?? body.error ?? 'không rõ lý do';
    throw new PancakeApiError(`Pancake từ chối ${what}: ${reason}`, false, body.error === 'order_not_found');
  }
  return body;
}

/** Phân loại lỗi axios: không có phản hồi / 5xx / 408 / 429 là lỗi tạm (Pancake CÓ THỂ đã xử lý); 4xx là từ chối. */
function toPancakeError(err: unknown, what: string): Error {
  if (err instanceof PancakeApiError || !isAxiosError(err)) return err as Error;
  const status = err.response?.status;
  const body = err.response?.data as PancakeBody;
  const bodyReason = body && typeof body === 'object' ? (body.message ?? body.error) : undefined;
  // axios tự đặt "Request failed with status code N" (tiếng Anh, lặp lại mã đã có trong câu) — không đưa vào lời báo.
  const reason = bodyReason || (/^Request failed with status code \d+$/.test(err.message) ? '' : err.message);
  const detail = reason ? `: ${reason}` : '';
  if (status === undefined) return new PancakeApiError(`Không kết nối được Pancake khi ${what}: ${err.message}`, true);
  if (status === 404) return new PancakeApiError(`Pancake không tìm thấy (${what})${detail}`, false, true);
  const transient = status >= 500 || status === 408 || status === 429;
  return new PancakeApiError(`Pancake trả ${status} khi ${what}${detail}`, transient);
}

/**
 * Pancake có thể trả HTTP 200 kèm `success:false` (hạn mức, lỗi phía họ) — đọc thành `[]` thì GeoService coi là
 * "không có tỉnh nào" và khách không tạo được địa chỉ. Ném lỗi để phía trên giữ bản cache tốt hoặc báo thử lại.
 */
function geoList<T>(res: PancakeGeoResponse<T> | null | undefined, what: string): T[] {
  if (!res || res.success === false || !Array.isArray(res.data)) {
    throw new ServiceUnavailableException(`Pancake không trả danh sách ${what}.`);
  }
  return res.data;
}

/**
 * HTTP client cho Pancake POS. Gate bằng config: nếu chưa có PANCAKE_API_KEY/SHOP_ID,
 * `isConfigured()` = false → các service gọi sẽ skip gracefully (dev dùng seed mẫu).
 */
@Injectable()
export class PancakeClient {
  private readonly logger = new Logger(PancakeClient.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly shopId: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.apiKey = config.get('PANCAKE_API_KEY', { infer: true });
    this.shopId = config.get('PANCAKE_SHOP_ID', { infer: true });
    this.http = axios.create({
      baseURL: config.get('PANCAKE_BASE_URL', { infer: true }),
      timeout: PANCAKE_HTTP_TIMEOUT_MS,
    });
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.shopId);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Pancake chưa được cấu hình (PANCAKE_API_KEY/SHOP_ID).');
    }
  }

  /** GET danh mục/geo: lỗi HTTP thành câu tiếng Việt có ngữ cảnh (admin và báo động vận hành đọc thẳng câu này). */
  private async getCatalog<T>(url: string, params: Record<string, unknown>, what: string): Promise<T> {
    try {
      const { data } = await this.http.get<T>(url, { params });
      return data;
    } catch (err) {
      throw toPancakeError(err, what);
    }
  }

  async fetchProducts(page: number, updatedSince?: string): Promise<PancakeProductsResponse> {
    this.assertConfigured();
    const data = await this.getCatalog<PancakeProductsResponse>(
      `/shops/${this.shopId}/products`,
      { api_key: this.apiKey, page, updated_since: updatedSince },
      `đọc danh mục trang ${page}`,
    );
    // Như geo: trang lỗi mà đọc thành rỗng thì vòng phân trang tưởng đã hết danh mục.
    if (!data || data.success === false || (!Array.isArray(data.data) && !Array.isArray(data.products))) {
      throw new ServiceUnavailableException(`Pancake không trả danh sách sản phẩm (trang ${page}).`);
    }
    return data;
  }

  /** Cây nhóm hàng của shop (`GET /shops/{SHOP_ID}/categories`) — để admin thấy mã/tên nhóm cần ánh xạ. */
  async fetchCategories(): Promise<PancakeCategoryNode[]> {
    this.assertConfigured();
    const data = await this.getCatalog<{ success?: boolean; data?: PancakeCategoryNode[] }>(
      `/shops/${this.shopId}/categories`,
      { api_key: this.apiKey },
      'đọc nhóm hàng',
    );
    if (!data || data.success === false || !Array.isArray(data.data)) {
      throw new ServiceUnavailableException('Pancake không trả danh sách nhóm hàng.');
    }
    return data.data;
  }

  /** Danh sách tỉnh/thành (geo Pancake). Dùng `new_id` ("84_VN*") cho đơn + query communes. */
  async fetchProvinces(): Promise<PancakeProvinceDTO[]> {
    this.assertConfigured();
    const data = await this.getCatalog<PancakeGeoResponse<PancakeProvinceDTO>>(
      '/geo/provinces',
      { api_key: this.apiKey },
      'đọc danh sách tỉnh/thành',
    );
    return geoList(data, 'tỉnh/thành');
  }

  /**
   * Phường/xã theo tỉnh. TRUYỀN province `new_id` ("84_VN*") để nhận id hệ MỚI 2 cấp
   * (district_id=null) — đúng định dạng ward_id khi đặt đơn.
   */
  async fetchCommunes(provinceNewId: string): Promise<PancakeCommuneDTO[]> {
    this.assertConfigured();
    const data = await this.getCatalog<PancakeGeoResponse<PancakeCommuneDTO>>(
      '/geo/communes',
      { api_key: this.apiKey, province_id: provinceNewId },
      'đọc danh sách phường/xã',
    );
    return geoList(data, 'phường/xã');
  }

  async createOrder(body: PancakeCreateOrderBody): Promise<PancakeCreateOrderResponse> {
    this.assertConfigured();
    try {
      const { data } = await this.http.post<PancakeCreateOrderResponse>(`/shops/${this.shopId}/orders`, body, {
        params: { api_key: this.apiKey },
      });
      return assertSuccess(data, 'tạo đơn');
    } catch (err) {
      throw toPancakeError(err, 'tạo đơn');
    }
  }

  /** Một đơn theo id Pancake. Không có (404 / order_not_found) → null. */
  async getOrder(orderId: string, opts: { timeoutMs?: number } = {}): Promise<PancakeOrderDTO | null> {
    this.assertConfigured();
    try {
      const { data } = await this.http.get<PancakeCreateOrderResponse>(`/shops/${this.shopId}/orders/${encodeURIComponent(orderId)}`, {
        params: { api_key: this.apiKey },
        timeout: opts.timeoutMs,
      });
      const body = assertSuccess(data, 'đọc đơn');
      return body?.data ?? body ?? null;
    } catch (err) {
      const e = toPancakeError(err, 'đọc đơn');
      if (e instanceof PancakeApiError && e.notFound) return null;
      throw e;
    }
  }

  /**
   * Đơn Pancake mang mã đơn Tubu. Open API: tham số `search` tìm theo "SĐT, tên khách, ghi chú..." — ghi chú đơn
   * luôn mở đầu "Order code: <mã>". Trả nguyên kết quả; người gọi tự lọc đơn khớp ĐÚNG mã (pancakeOrderHasCode).
   */
  async searchOrders(text: string, opts: { timeoutMs?: number } = {}): Promise<PancakeOrderDTO[]> {
    this.assertConfigured();
    try {
      const { data } = await this.http.get<PancakeOrderListResponse>(`/shops/${this.shopId}/orders`, {
        params: { api_key: this.apiKey, search: text, page_size: 50, page_number: 1 },
        timeout: opts.timeoutMs,
      });
      const body = assertSuccess(data, 'tra cứu đơn');
      if (!body || !Array.isArray(body.data)) {
        throw new PancakeApiError('Pancake không trả danh sách đơn khi tra cứu.', true);
      }
      return body.data;
    } catch (err) {
      throw toPancakeError(err, 'tra cứu đơn');
    }
  }

  /**
   * Đơn đã cập nhật từ mốc `sinceEpochSec` của các nguồn đơn `orderSources` (kéo dự phòng đơn sàn). Tham số `updateStatus`,
   * `startDateTime` (epoch giây) và `order_sources[]` theo Open API; chưa kiểm bằng phản hồi thật.
   */
  async listUpdatedOrders(opts: { sinceEpochSec: number; orderSources: string[]; page: number; pageSize: number; timeoutMs?: number }): Promise<PancakeOrderDTO[]> {
    this.assertConfigured();
    try {
      const { data } = await this.http.get<PancakeOrderListResponse>(`/shops/${this.shopId}/orders`, {
        params: {
          api_key: this.apiKey,
          updateStatus: 'updated_at',
          startDateTime: opts.sinceEpochSec,
          'order_sources[]': opts.orderSources,
          page_size: opts.pageSize,
          page_number: opts.page,
        },
        timeout: opts.timeoutMs,
        paramsSerializer: { indexes: null },
      });
      const body = assertSuccess(data, 'kéo đơn đã cập nhật');
      if (!body || !Array.isArray(body.data)) throw new PancakeApiError('Pancake không trả danh sách đơn khi kéo đơn đã cập nhật.', true);
      return body.data;
    } catch (err) {
      throw toPancakeError(err, 'kéo đơn đã cập nhật');
    }
  }

  /** Cập nhật một phần đơn (Open API: PUT /shops/{SHOP_ID}/orders/{ORDER_ID}). Huỷ = `{ status: 6 }`. */
  async updateOrder(
    orderId: string,
    body: PancakeUpdateOrderBody,
    opts: { timeoutMs?: number } = {},
  ): Promise<PancakeOrderDTO | null> {
    this.assertConfigured();
    try {
      const { data } = await this.http.put<PancakeCreateOrderResponse>(
        `/shops/${this.shopId}/orders/${encodeURIComponent(orderId)}`,
        body,
        { params: { api_key: this.apiKey }, timeout: opts.timeoutMs },
      );
      const res = assertSuccess(data, 'cập nhật đơn');
      return res?.data ?? res ?? null;
    } catch (err) {
      throw toPancakeError(err, 'cập nhật đơn');
    }
  }
}
