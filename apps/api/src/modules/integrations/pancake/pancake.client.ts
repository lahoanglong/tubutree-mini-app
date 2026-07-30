import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import type { Env } from '../../../config/env.validation';
import type {
  PancakeCreateOrderBody,
  PancakeCreateOrderResponse,
  PancakeProductsResponse,
  PancakeProvinceDTO,
  PancakeCommuneDTO,
  PancakeGeoResponse,
} from './pancake.types';

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
      timeout: 15000,
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

  async fetchProducts(page: number, updatedSince?: string): Promise<PancakeProductsResponse> {
    this.assertConfigured();
    const { data } = await this.http.get<PancakeProductsResponse>(
      `/shops/${this.shopId}/products`,
      { params: { api_key: this.apiKey, page, updated_since: updatedSince } },
    );
    return data;
  }

  /** Danh sách tỉnh/thành (geo Pancake). Dùng `new_id` ("84_VN*") cho đơn + query communes. */
  async fetchProvinces(): Promise<PancakeProvinceDTO[]> {
    this.assertConfigured();
    const { data } = await this.http.get<PancakeGeoResponse<PancakeProvinceDTO>>('/geo/provinces', {
      params: { api_key: this.apiKey },
    });
    return data.data ?? [];
  }

  /**
   * Phường/xã theo tỉnh. TRUYỀN province `new_id` ("84_VN*") để nhận id hệ MỚI 2 cấp
   * (district_id=null) — đúng định dạng ward_id khi đặt đơn.
   */
  async fetchCommunes(provinceNewId: string): Promise<PancakeCommuneDTO[]> {
    this.assertConfigured();
    const { data } = await this.http.get<PancakeGeoResponse<PancakeCommuneDTO>>('/geo/communes', {
      params: { api_key: this.apiKey, province_id: provinceNewId },
    });
    return data.data ?? [];
  }

  async createOrder(body: PancakeCreateOrderBody): Promise<PancakeCreateOrderResponse> {
    this.assertConfigured();
    const { data } = await this.http.post<PancakeCreateOrderResponse>(
      `/shops/${this.shopId}/orders`,
      body,
      { params: { api_key: this.apiKey } },
    );
    return data;
  }
}
