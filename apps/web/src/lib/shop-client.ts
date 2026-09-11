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
}
export interface OrderDTO {
  code: string;
  status: string;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  paymentMethod: string;
  createdAt: string;
  items: { productName: string; variationName: string; unitPrice: number; quantity: number; total: number }[];
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
    note?: string;
    storefrontSlug?: string;
    referralCode?: string;
  },
  idempotencyKey: string,
) =>
  apiFetch<OrderDTO>('/checkout/place-order', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

// Orders
export const fetchOrders = () =>
  apiFetch<{ data: OrderDTO[]; meta: unknown }>('/orders').then((r) => r.data);

export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}
