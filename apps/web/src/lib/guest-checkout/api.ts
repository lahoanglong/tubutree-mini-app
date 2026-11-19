import { syncServerClock } from '@tubutree/app-core/server-clock';
import type { GiftTrialSummaryDTO } from '@tubutree/shared-types';
import { apiFetch } from '../client-api';
import type { BankQrDTO, QuoteShipment } from '../shop-client';
import { guestDeviceId } from './keys';

/** Một dòng giỏ gửi lên máy chủ: giỏ của khách nằm trong trình duyệt nên mỗi lần báo giá và đặt đơn gửi lại đủ các dòng. */
export interface GuestLineInput {
  variationId: string;
  quantity: number;
}

export interface GuestAddressInput {
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

export interface GuestQuote {
  /** Có món đã hết suất Giờ vàng của SĐT nhận hàng (hay IP) này: phần vượt tính giá thường. */
  flashNotice: boolean;
  shipments?: QuoteShipment[];
  /** Lý do từng cách trả tiền đang khoá (COD trên trần, gian hàng không nhận COD…). */
  blockedPaymentMethods: Partial<Record<'COD' | 'BANK_TRANSFER', string>>;
  codMax: number;
  subtotal: number;
  discount: number;
  comboDiscount: number;
  greenBoxDiscount?: number;
  shippingFee: number;
  giftTrial?: GiftTrialSummaryDTO;
  total: number;
  items: {
    id: string;
    variationId: string;
    productName: string;
    variationName: string | null;
    slug: string | null;
    thumbnail: string | null;
    unitPrice: number;
    /** Giá niêm yết một đơn vị (trước Giờ vàng). */
    listUnitPrice?: number;
    isFlash?: boolean;
    quantity: number;
    total: number;
  }[];
}

export interface GuestPlaceBody {
  lines: GuestLineInput[];
  address: GuestAddressInput;
  paymentMethod: 'COD' | 'BANK_TRANSFER';
  expectedTotal?: number;
  note?: string;
  giftVariationId?: string | null;
  orderZaloConsent?: boolean;
  trackingKey: string;
  website?: string;
  fillMs: number;
}

export interface GuestPlaced {
  code: string;
  status: string;
  paymentMethod: 'COD' | 'BANK_TRANSFER';
  total: number;
  codes: string[];
  /** false: lần gửi lặp trả lại đơn đã đặt ở tab khác (khoá khác), dùng khoá đã lưu cho mã đơn đó. */
  keyAccepted: boolean;
}

export interface GuestTrackedOrder {
  code: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  deliveredAt: string | null;
  statusTimes: Record<string, string>;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  items: { productName: string; variationName: string | null; quantity: number; unitPrice: number; total: number; isGift: boolean }[];
  phoneMasked: string;
  area: { ward: string; province: string };
  siblings: { code: string; status: string; total: number }[];
  expiresAt: string | null;
}

const deviceHeader = () => ({ 'x-guest-device': guestDeviceId() });

export const guestQuote = (body: { lines: GuestLineInput[]; address: GuestAddressInput }) =>
  apiFetch<GuestQuote>('/checkout/guest/quote', { method: 'POST', body, auth: false, headers: deviceHeader() });

export const guestPlaceOrder = (body: GuestPlaceBody, idempotencyKey: string) =>
  apiFetch<GuestPlaced>('/checkout/guest/orders', {
    method: 'POST',
    body,
    auth: false,
    headers: { ...deviceHeader(), 'Idempotency-Key': idempotencyKey },
  });

export const guestTrackOrder = (code: string, key: string) =>
  apiFetch<GuestTrackedOrder>(`/checkout/guest/orders/${encodeURIComponent(code)}`, {
    auth: false,
    cache: 'no-store',
    headers: { 'x-order-key': key },
  });

export const guestBankQr = async (code: string, key: string) => {
  const qr = await apiFetch<BankQrDTO>(`/checkout/guest/orders/${encodeURIComponent(code)}/bank-qr`, {
    auth: false,
    cache: 'no-store',
    headers: { 'x-order-key': key },
  });
  syncServerClock(qr?.serverNow);
  return qr;
};

/** Đưa đơn vãng lai của trình duyệt này về tài khoản đang đăng nhập (cần phiên). */
export const claimGuestOrdersRequest = (deviceId: string) =>
  apiFetch<{ claimed: number }>('/checkout/guest/claim', { method: 'POST', headers: { 'x-guest-device': deviceId } });
