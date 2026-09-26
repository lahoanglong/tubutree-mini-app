import type {
  InvoiceStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
} from './enums';

export interface OrderItemDTO {
  id: string;
  variationId: string;
  productName: string;
  /** Slug SP lúc mua — để mở trang sản phẩm từ đơn (đánh giá / mua lại). Null với đơn cũ. */
  productSlug: string | null;
  variationName: string;
  unitPrice: number;
  quantity: number;
  total: number;
  /** Số đơn vị của dòng này CHƯA có hàng thật để giữ chỗ — chỉ > 0 cho đơn ĐẠI LÝ đặt vượt tồn
   * (dealer.service.ts placeOrder cho đặt trước thay vì từ chối). Luôn 0 với đơn khác. */
  backorderedQty: number;
}

export interface ShippingAddressSnapshot {
  recipient: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
}

export interface InvoiceRequest {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}

/** Một mốc hành trình vận chuyển (chuẩn hoá từ webhook Pancake). */
export interface ShippingEvent {
  at: string;
  status?: string | null;
  carrier?: string | null;
  code?: string | null;
  note?: string | null;
}

export interface OrderDTO {
  id: string;
  code: string;
  type: OrderType;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  pointsEarned: number;
  pointsUsed: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  shippingAddress: ShippingAddressSnapshot;
  shippingPartner?: string | null;
  shippingCode?: string | null;
  shippingStatus?: string | null;
  trackingLink?: string | null;
  shippingHistory?: ShippingEvent[] | null;
  invoiceStatus?: InvoiceStatus | null;
  invoiceUrl?: string | null;
  note?: string | null;
  /** Khách chọn "gửi lại vật liệu tái chế" (vận đơn đổi hàng Gomdon/BestExpress). */
  hasRecyclingPickup?: boolean;
  recyclingNote?: string | null;
  gomdonOrderId?: string | null;
  /** Mã vận đơn BestExpress (hiển thị cho khách/kho). */
  gomdonPartnerCode?: string | null;
  /**
   * Mã trạng thái Gomdon "1".."12" (1 tạo đơn, 2 huỷ, 3 đã lấy hàng, 4-5 đang giao, 6 chuyển hoàn,
   * 7 giao thành công, 8 đã hoàn, 9 hỏng/mất, 10 lấy không thành công, 11 giao thất bại, 12 hoàn thất bại)
   * HOẶC trạng thái nội bộ trước khi có vận đơn: AWAITING_PAYMENT | CREATING | NEEDS_MANUAL_CHECK |
   * FAILED | NOT_CONFIGURED. null = chưa xử lý.
   */
  gomdonStatus?: string | null;
  /** Kết quả huỷ vận đơn Gomdon khi đơn bị huỷ: CANCELLED | FAILED | TOO_LATE | NOT_NEEDED. */
  gomdonCancelStatus?: string | null;
  /** Thời điểm đơn chuyển DELIVERED — mốc tính hạn đổi/trả (ISO). */
  deliveredAt?: string | null;
  items: OrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}
