/** Shape rút gọn của Pancake POS Open API (Build Spec §8). */

export interface PancakeVariationDTO {
  id: string;
  sku?: string;
  fields?: Record<string, string>;
  retail_price?: number;
  sale_price?: number;
  remain_quantity?: number;
  weight?: number;
  images?: string[];
}

export interface PancakeProductDTO {
  /** Pancake POS dùng `id` cho sản phẩm (KHÔNG phải product_id — đó là field của variation). */
  id: string;
  product_id?: string; // giữ optional cho tương thích
  name: string;
  description?: string;
  image?: string | null;
  images?: string[];
  variations?: PancakeVariationDTO[];
}

export interface PancakeProductsResponse {
  data?: PancakeProductDTO[];
  products?: PancakeProductDTO[];
  total?: number;
}

export interface PancakeCreateOrderItem {
  variation_id: string;
  quantity: number;
  discount_each_product?: number;
}

export interface PancakeCreateOrderBody {
  customer: {
    name: string;
    phone_number: string;
    address: string;
    ward_id?: string;
    district_id?: string;
    province_id?: string;
    fb_id?: string;
  };
  items: PancakeCreateOrderItem[];
  shipping_fee: number;
  total_discount: number;
  tags?: string[];
  note?: string;
  extension?: {
    external_order_id?: string;
    invoice_request?: { tax_code: string; company_name: string; address: string; email: string };
  };
}

export interface PancakeCreateOrderResponse {
  id?: string;
  order_id?: string;
  success?: boolean;
}

/** Địa giới Pancake (geo). Hệ MỚI 2 cấp: Tỉnh → Phường/Xã (district bỏ). */
export interface PancakeProvinceDTO {
  id: string;
  name: string;
  name_en?: string;
  country_code?: number;
  /** ID hệ mới "84_VN*" — dùng khi đặt đơn (customer.province_id) và để query communes. */
  new_id?: string;
  region_type?: string;
}
export interface PancakeCommuneDTO {
  /** Khi query bằng province_id hệ mới ("84_VN*"), `id` đã là hệ mới — dùng cho ward_id khi đặt đơn. */
  id: string;
  name: string;
  name_en?: string;
  province_id?: string;
  district_id?: string | null;
  postcode?: string | null;
  new_id?: string | null;
}
export interface PancakeGeoResponse<T> {
  data?: T[];
}
