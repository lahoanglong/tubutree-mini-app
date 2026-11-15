export interface GomdonWarehouseConfig {
  name: string;
  phone: string;
  address: string;
  ward: string;
  district: string;
  province: string;
}

export interface GomdonConfig {
  /** Rỗng = chưa cấu hình (dev/test mặc định) — xem resolveGomdonBaseUrl(). */
  baseUrl: string;
  phone: string;
  password: string;
  defaultWarehouse: GomdonWarehouseConfig;
  defaultWeightFallback: number; // gram, default 500
}

/**
 * POST /api/v2/auth/login (form-data phone + password). Theo tài liệu: thành công HTTP 200; sai tài khoản
 * HTTP 401 + { result:false, message, data:null }. Token dạng Laravel Sanctum "id|chuỗi", gửi lại bằng
 * header "Authorization: Bearer <token>". Không có expires_in — chỉ có expires_at (mẫu = null).
 */
export interface GomdonLoginResponse {
  result: boolean;
  message?: string;
  data?: {
    access_token: string;
    /** "Bearer". */
    token_type?: string;
    /** null = token không tự hết hạn; nếu có thì là thời điểm ISO (Laravel, UTC). */
    expires_at?: string | null;
    /** Thông tin tài khoản Gomdon (id, name, phone, balance…) — không dùng, không log. */
    user?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
}

/**
 * Body POST /api/v2/order/create (multipart/form-data — mọi giá trị gửi dạng chuỗi). Tên trường và đơn vị
 * đã đối chiếu tài liệu Gomdon 27/10/2026. Người gửi và người nhận đều bắt buộc đủ tỉnh/phường/địa chỉ/SĐT/tên
 * (địa chỉ 2 cấp, không gửi quận/huyện).
 */
export interface GomdonCreateOrderBody {
  type: number; // 1 - Giao hàng, 2 - Thu hồi, 3 - Đơn đổi hàng (ta dùng 3)
  pickup_type: number; // 1 - DropOff (tự mang ra bưu cục), 2 - Nhân viên tới lấy tại địa chỉ gửi (ta dùng 2)
  service_id: number; // 12491 - Giao hàng tiết kiệm, 12490 - Giao hàng nhanh
  order_customer_id: string; // Mã đơn của ta (order.code) — Gomdon dùng để kiểm tra trùng (duy nhất)
  product_name: string; // Bắt buộc
  product_price: number; // Giá trị gói hàng, VND
  product_number: number; // Số kiện hàng (1)
  // Thu hộ, VND: 0 nếu đã thanh toán, order.total nếu COD. Ví dụ lỗi của tài liệu cho thấy COD chỉ nhận
  // 0–5.000.000 — checkout đã chặn COD > 5 triệu.
  collect_amount: number;
  weight: number; // Gram (số nguyên)
  width?: number; // Mm
  height?: number; // Mm
  length?: number; // Mm
  note: string;
  source_name: string;
  source_phone: string;
  source_address: string;
  source_ward: string;
  /** Địa chỉ 2 cấp (sau sáp nhập 2025): tài liệu Gomdon nên bỏ trống quận/huyện → không gửi key này. */
  source_district?: string;
  source_province: string;
  dest_name: string;
  dest_phone: string;
  dest_address: string;
  dest_ward: string;
  dest_district?: string;
  dest_province: string;
}

/**
 * POST /api/v2/order/create. Tài liệu: thành công HTTP 200 + result:true + data = đơn vừa tạo (Gomdon echo
 * lại các trường đã gửi dưới dạng chuỗi, kèm phí + mã). Lỗi validate/nghiệp vụ: HTTP 200 + result:false +
 * message (vd "The source province field is required."). Token sai/thiếu: HTTP 401.
 */
export interface GomdonCreateOrderResponse {
  result: boolean;
  message?: string;
  /** true khi order_customer_id đã có đơn còn hiệu lực: data.id là mã đơn cũ (coi là tạo thành công). */
  duplicate?: boolean;
  data?: {
    /** Mã số đơn Gomdon (số) — dùng cho /order/cancel/{id}, trùng order_id trong webhook. */
    id?: number | string;
    /** Mã NỘI BỘ Gomdon dạng "<id>-<user>-<tên>" — KHÔNG phải mã vận đơn. */
    code?: string;
    /** Mã vận đơn của hãng (BestExpress) — trùng order_code trong webhook. */
    partner_code?: string | number;
    /** Một số phản hồi trả mã vận đơn của hãng ở trường này (cùng nghĩa order_code của webhook). */
    order_code?: string | number;
    /** 1 = Tạo đơn thành công. */
    status?: number;
    /** Unix GIÂY. */
    created_time?: number;
    /** Phí Gomdon tính cho shop (VND). */
    customer_total_fee?: number;
    customer_delivery_fee?: number;
    customer_cod_fee?: number;
    customer_insurance_fee?: number;
    [key: string]: unknown;
  };
}

/**
 * Payload webhook đổi trạng thái (tài liệu Gomdon, mục Webhook — JSON). Đủ các trường tài liệu liệt kê;
 * KHÔNG có link tra cứu hành trình. Gomdon coi HTTP 200 là nhận thành công, khác 200 thì gửi lại sau 30 giây,
 * tối đa 3 lần.
 */
export interface GomdonWebhookPayload {
  /** Mã sự kiện, giữ nguyên qua các lần gửi lại — dùng để bỏ qua sự kiện đã xử lý. */
  event_id?: string;
  /** Mã trạng thái 1–12 (GOMDON_STATUS_TEXT). */
  status?: number;
  /** VND. */
  product_price?: number;
  /** Tiền thu hộ, VND. */
  collect_amount?: number;
  /** Gram. */
  weight?: number;
  /** Mm. */
  height?: number;
  /** Mm. */
  width?: number;
  /** Mm. */
  length?: number;
  /** Mã số đơn Gomdon (= data.id lúc tạo). */
  order_id?: number | string;
  /** Mã vận đơn (= data.partner_code lúc tạo). JSON mẫu để dạng số. */
  order_code?: number | string;
  /** Mã đơn của ta (order_customer_id đã gửi lúc tạo). JSON mẫu để dạng số. */
  order_customer_id?: string | number;
  /** Phí Gomdon tính cho shop, VND. */
  customer_total_fee?: number;
  customer_delivery_fee?: number;
  customer_cod_fee?: number;
  customer_insurance_fee?: number;
  /** Thời điểm đổi trạng thái — unix GIÂY. */
  created_time?: number;
  [key: string]: unknown;
}


/** Kết quả POST /api/v2/order/check-address. `skipped`: không kiểm được (lỗi mạng, quá tần suất, chưa cấu hình) — không chặn khách. */
export interface GomdonAddressCheck {
  ok: boolean;
  message?: string;
  skipped?: boolean;
}

export interface GomdonShopFeeParams {
  /** Gram. */
  weight: number;
  /** VND. */
  collectAmount?: number;
  /** VND. */
  productPrice?: number;
  /** Mm. */
  width?: number;
  height?: number;
  length?: number;
}

export interface GomdonShopFeeQuote {
  /** VND. */
  fee: number;
  /** true = phí ước lượng cố định (Gomdon chưa cấu hình / lỗi mạng / phản hồi không dùng được), không phải phí Gomdon báo. */
  estimated: boolean;
}

export interface GomdonRegisterWebhookResult {
  ok: boolean;
  message?: string;
}
