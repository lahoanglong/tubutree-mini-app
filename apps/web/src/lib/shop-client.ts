'use client';

import { apiFetch } from './client-api';

export interface CartLine {
  id: string;
  variationId: string;
  productName: string;
  variationName: string;
  slug: string;
  thumbnail: string | null;
  unitPrice: number;
  quantity: number;
  stock: number;
  total: number;
}
export interface CartSummary {
  items: CartLine[];
  couponCode: string | null;
  subtotal: number;
  discount: number;
  freeship: boolean;
  freeshipThreshold: number;
  itemCount: number;
  /** Dòng có SP đã ngừng bán/chưa duyệt — server không tính tiền, không đặt được. */
  unavailableItems?: { id: string; productName: string; variationName: string; quantity: number }[];
}
export interface AddressDTO {
  id: string;
  recipient: string;
  phone: string;
  province: string;
  district: string;
  ward: string;
  street: string;
  provinceCode: string;
  districtCode: string;
  wardCode: string;
  isDefault: boolean;
}
export interface CheckoutQuote {
  subtotal: number;
  discount: number;
  pointsUsed: number;
  pointsDiscount: number;
  shippingFee: number;
  total: number;
  pointsEarned: number;
  pointsBalance: number;
  /** Điểm DÙNG ĐƯỢC ở checkout = số dư − điểm đơn còn có thể bị trả (backend kẹp theo số này). API cũ chưa trả. */
  redeemablePoints?: number;
  lockedPoints?: number;
  /** Lô quy đổi từ xu cũ (không hết hạn): phần của `pointsUsed` trừ vào lô này, số dư, và số được đề nghị dùng. */
  pointsUsedConverted?: number;
  pointsConvertedBalance?: number;
  redeemableConvertedPoints?: number;
}
export interface OrderDTO {
  code: string;
  status: string;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  paymentMethod: string;
  paymentStatus?: string;
  createdAt: string;
  items: { productName: string; variationName: string; unitPrice: number; quantity: number; total: number }[];
  /** Thu gom vật liệu tái chế (vận đơn đổi hàng Gomdon/BestExpress) — xem lib/recycling.ts. */
  hasRecyclingPickup?: boolean;
  recyclingNote?: string | null;
  gomdonStatus?: string | null;
  gomdonPartnerCode?: string | null;
  gomdonCancelStatus?: string | null;
}

/** GET /config/public — chỉ những giá trị vốn đã hiển thị công khai (xem system-config.controller.ts). */
export interface PublicConfig {
  freeshipThreshold?: number;
  /** true khi Gomdon đã cấu hình VÀ admin bật công tắc — chỉ khi đó mới hiện lựa chọn thu gom. */
  recyclingEnabled?: boolean;
}
export const getPublicConfig = () => apiFetch<PublicConfig>('/config/public', { auth: false });

/**
 * Tồn kho HIỆN TẠI của từng phân loại. Trang chi tiết sản phẩm là bản ISR 5 phút nên tồn kho in sẵn trong HTML có thể
 * cũ; trình duyệt hỏi lại cái này khi mở trang để nút "Thêm vào giỏ" và giới hạn số lượng theo hàng thật.
 */
export async function getProductStock(slug: string): Promise<Record<string, number>> {
  const p = await apiFetch<{ variations?: { id: string; stock: number }[] }>(
    `/products/${encodeURIComponent(slug)}`,
    { auth: false, cache: 'no-store' },
  );
  return Object.fromEntries((p.variations ?? []).map((v) => [v.id, v.stock]));
}

// Cart
export const getCart = () => apiFetch<CartSummary>('/cart');
export const addToCart = (variationId: string, quantity: number) =>
  apiFetch<CartSummary>('/cart/items', { method: 'POST', body: { variationId, quantity } });
export const updateCartItem = (id: string, quantity: number) =>
  apiFetch<CartSummary>(`/cart/items/${id}`, { method: 'PATCH', body: { quantity } });
export const removeCartItem = (id: string) =>
  apiFetch<CartSummary>(`/cart/items/${id}`, { method: 'DELETE' });

// Voucher — web trước đây chỉ HIỂN THỊ cart.discount, không có ô nhập/chọn mã, nên cùng một giỏ
// mà mua trên web thì đắt hơn mua trong Mini App.
export interface CouponDTO {
  code: string;
  type: 'PERCENT' | 'AMOUNT' | 'FREESHIP';
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  endAt: string;
}
export const getMyCoupons = () => apiFetch<CouponDTO[]>('/me/coupons');
export const applyCoupon = (code: string) =>
  apiFetch<CartSummary>('/cart/coupon', { method: 'POST', body: { code } });
export const removeCoupon = () => apiFetch<CartSummary>('/cart/coupon', { method: 'DELETE' });

// Addresses
export const getAddresses = () => apiFetch<AddressDTO[]>('/me/addresses');
export const createAddress = (data: Omit<AddressDTO, 'id' | 'isDefault'>) =>
  apiFetch<AddressDTO>('/me/addresses', { method: 'POST', body: data });

/** Ghi "chạm" giới thiệu để attribution sống qua cả lúc mất phiên (BE giữ 3 ngày). */
export const recordReferralTouch = (dto: { referralCode: string; storefrontSlug?: string; kind?: 'ctv' | 'brand' }) =>
  apiFetch<{ ok: boolean }>('/affiliate/touch', { method: 'POST', body: dto });

// Checkout
export const checkoutQuote = (addressId: string, pointsToUse?: number, storefrontSlug?: string) =>
  apiFetch<CheckoutQuote>('/checkout/quote', {
    method: 'POST',
    body: { addressId, pointsToUse, storefrontSlug },
  });
export const placeOrder = (
  body: {
    addressId: string;
    paymentMethod: string;
    pointsToUse?: number;
    /** Khách đã thấy đơn 0đ (FE ẩn chọn phương thức): BE từ chối nếu lúc đặt tổng > 0. */
    quotedZeroTotal?: boolean;
    note?: string;
    storefrontSlug?: string;
    referralCode?: string;
    /** Chỉ có mặt khi tính năng bật VÀ khách chọn — xem recyclingCheckoutFields. */
    hasRecyclingPickup?: true;
    recyclingNote?: string;
  },
  idempotencyKey: string,
) =>
  apiFetch<OrderDTO>('/checkout/place-order', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

// Orders
export interface OrderListFilter {
  status?: string;
  /** Nhóm trạng thái gộp của API (GET /orders?group=): processing = Đã xác nhận + Đang đóng gói, closed = Đã hủy + Đã hoàn. */
  group?: 'processing' | 'closed';
}
export interface OrdersPage {
  data: OrderDTO[];
  meta: { page: number; limit: number; total: number };
}
export const ORDERS_PAGE_SIZE = 20;
/** Một trang đơn (mới nhất trước) kèm tổng số — API mặc định chỉ trả 20 đơn đầu nên danh sách phải tự tải thêm. */
export const fetchOrdersPage = (page: number, filter: OrderListFilter = {}) => {
  const qs = new URLSearchParams({ page: String(page), limit: String(ORDERS_PAGE_SIZE) });
  if (filter.status) qs.set('status', filter.status);
  if (filter.group) qs.set('group', filter.group);
  return apiFetch<OrdersPage>(`/orders?${qs.toString()}`);
};

/** GET /orders/:code — API trả nguyên cột của Order kèm ảnh từng dòng; chỉ khai các trường web đang dùng. */
export interface OrderDetailDTO extends OrderDTO {
  couponCode?: string | null;
  /** Số Điểm Xanh đã dùng (đã nằm trong `discount`, không trừ thêm lần nữa). */
  pointsUsed?: number;
  note?: string | null;
  /** Ảnh chụp địa chỉ lúc đặt; đơn đại lý không có địa chỉ khách lẻ, chỉ có `note`. */
  shippingAddress?: {
    recipient?: string;
    phone?: string;
    province?: string;
    district?: string;
    ward?: string;
    street?: string;
    note?: string | null;
  } | null;
  shippingPartner?: string | null;
  shippingCode?: string | null;
  trackingLink?: string | null;
  items: (OrderDTO['items'][number] & { thumbnail?: string | null })[];
}
export const fetchOrder = (code: string) => apiFetch<OrderDetailDTO>(`/orders/${encodeURIComponent(code)}`);

// Thanh toán chuyển khoản (VietQR) — A2-02 = A6-01 (docs/audit-2026-09): web chọn được
// BANK_TRANSFER nhưng trước đây không có cách nào gọi endpoint này nên khách không bao giờ thấy
// QR/STK để trả tiền. Cùng contract BE với apps/miniapp/src/services/payment-api.ts
// (GET /payments/bank-qr/:code — xem bank-transfer.service.ts).
export interface BankQrDTO {
  orderCode: string;
  amount: number;
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED' | 'FAILED';
  bank: { bin: string; name: string; accountNo: string; accountName: string };
  memo: string;
  qrString: string;
  qrImageUrl: string;
}
export const getBankQr = (code: string) => apiFetch<BankQrDTO>(`/payments/bank-qr/${code}`);

export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}
