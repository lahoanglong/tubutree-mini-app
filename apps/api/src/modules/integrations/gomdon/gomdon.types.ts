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

export interface GomdonLoginResponse {
  result: boolean;
  message?: string;
  data?: {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    [key: string]: unknown;
  };
}

export interface GomdonCreateOrderBody {
  type: number; // 3 - Đơn đổi hàng (BestExpress)
  pickup_type: number; // 2 - Bưu tá tới lấy, 1 - Dropoff
  service_id: number; // 12491 - Giao hàng tiết kiệm, 12490 - Giao hàng nhanh
  order_customer_id: string; // Mã đơn khách hàng (order.code)
  product_name: string;
  product_price: number;
  product_number: number; // 1
  collect_amount: number; // 0 nếu đã thanh toán, hoặc order.total nếu COD
  weight: number; // gram
  width?: number; // mm
  height?: number; // mm
  length?: number; // mm
  note: string;
  source_name: string;
  source_phone: string;
  source_address: string;
  source_ward: string;
  source_district: string;
  source_province: string;
  dest_name: string;
  dest_phone: string;
  dest_address: string;
  dest_ward: string;
  dest_district: string;
  dest_province: string;
}

export interface GomdonCreateOrderResponse {
  result: boolean;
  message?: string;
  data?: {
    id?: number | string;
    code?: string;
    partner_code?: string;
    status?: number;
    [key: string]: unknown;
  };
}

export interface GomdonWebhookPayload {
  status?: number;
  product_price?: number;
  collect_amount?: number;
  weight?: number;
  height?: number;
  width?: number;
  length?: number;
  order_id?: number | string;
  order_code?: number | string;
  order_customer_id?: string;
  customer_total_fee?: number;
  customer_delivery_fee?: number;
  customer_cod_fee?: number;
  customer_insurance_fee?: number;
  created_time?: number;
  [key: string]: unknown;
}

