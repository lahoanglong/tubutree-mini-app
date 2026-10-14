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
  /** Pancake POS: biến thể đã bị xoá (vẫn có thể còn trong danh sách trả về). */
  is_removed?: boolean;
  /** Pancake POS: ẩn trên website StoreCake — KHÔNG dùng để ngừng bán trên Tubu. */
  is_hidden?: boolean;
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
  is_removed?: boolean;
}

export interface PancakeProductsResponse {
  success?: boolean;
  data?: PancakeProductDTO[];
  products?: PancakeProductDTO[];
  total?: number;
  page_number?: number;
  page_size?: number;
  total_entries?: number;
  total_pages?: number;
}

export interface PancakeCreateOrderItem {
  /** Mã biến thể Pancake (Pancake nhận cả SKU). */
  variation_id: string;
  quantity: number;
  /** Giảm trên MỖI đơn vị (VND) so với `variation_info.retail_price`. */
  discount_each_product?: number;
  /**
   * Open API: không bắt buộc nhưng "nên gửi retail_price để giá dòng đúng" — thiếu thì Pancake lấy giá danh mục của
   * nó, lệch giá flash/đại lý/khuyến mãi của Tubu.
   */
  variation_info?: { retail_price: number; name?: string };
}

/** Địa chỉ giao theo schema "Đơn hàng" của Pancake POS Open API. */
export interface PancakeShippingAddress {
  full_name: string;
  phone_number: string;
  /** Địa chỉ chữ. Để trống province_id thì Pancake tự phân tích chữ ra tỉnh/huyện/xã. */
  address: string;
  full_address?: string;
  commune_id?: string;
  district_id?: string;
  province_id?: string;
}

/**
 * Body tạo/cập nhật đơn. Trường theo schema "Đơn hàng" (docs.pancake.biz/pos/api, openapi.json): bill_*,
 * shipping_address, custom_id, transfer_money, cod. `customer`/`extension` là dạng cũ app vẫn gửi kèm (webhook
 * và kho cũ đọc) — Open API không mô tả các trường con của chúng.
 */
export interface PancakeCreateOrderBody {
  bill_full_name?: string;
  bill_phone_number?: string;
  shipping_address?: PancakeShippingAddress;
  customer: {
    name: string;
    phone_number: string;
    address: string;
    ward_id?: string;
    district_id?: string;
    province_id?: string;
  };
  items: PancakeCreateOrderItem[];
  shipping_fee: number;
  total_discount: number;
  /** Số tiền khách đã trả trước (Open API: "Số tiền khách chuyển khoản") — Pancake trừ khỏi tiền thu hộ. */
  transfer_money?: number;
  /** Tiền thu hộ mong muốn (= tổng đơn − đã trả trước). */
  cod?: number;
  /** Khoá ngoài: mã đơn Tubu — dùng để tra lại đơn trên Pancake khi không biết lần tạo trước đã thành công chưa. */
  custom_id?: string;
  tags?: string[];
  note?: string;
  extension?: {
    external_order_id?: string;
    invoice_request?: { tax_code: string; company_name: string; address: string; email: string };
  };
}

/** Cập nhật một phần đơn (PUT /shops/{SHOP_ID}/orders/{ORDER_ID}). */
export type PancakeUpdateOrderBody = Partial<
  Pick<PancakeCreateOrderBody, 'transfer_money' | 'cod' | 'note' | 'tags'>
> & { status?: number };

/** Đơn Pancake đọc về (GET một đơn / danh sách / phản hồi tạo-cập nhật) — chỉ các trường app dùng. */
export interface PancakeOrderDTO {
  id?: string | number;
  status?: number | string;
  status_name?: string;
  custom_id?: string | null;
  note?: string | null;
  extension?: { external_order_id?: string } | null;
  inserted_at?: string;
}

/** Open API mô tả phản hồi là chính object đơn; bản thật hay bọc `{success, data}`. Đọc được cả hai. */
export interface PancakeCreateOrderResponse extends PancakeOrderDTO {
  order_id?: string | number;
  success?: boolean;
  message?: string;
  error?: string;
  data?: PancakeOrderDTO & { order_id?: string | number };
}

export interface PancakeOrderListResponse {
  success?: boolean;
  data?: PancakeOrderDTO[];
  message?: string;
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
  success?: boolean;
}
