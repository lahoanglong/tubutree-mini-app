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
  variationName: string;
  unitPrice: number;
  quantity: number;
  total: number;
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
  items: OrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}
