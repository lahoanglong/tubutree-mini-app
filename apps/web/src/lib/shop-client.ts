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

// Addresses
export const getAddresses = () => apiFetch<AddressDTO[]>('/me/addresses');
export const createAddress = (data: Omit<AddressDTO, 'id' | 'isDefault'>) =>
  apiFetch<AddressDTO>('/me/addresses', { method: 'POST', body: data });

// Checkout
export const checkoutQuote = (addressId: string, pointsToUse?: number) =>
  apiFetch<CheckoutQuote>('/checkout/quote', { method: 'POST', body: { addressId, pointsToUse } });
export const placeOrder = (
  body: { addressId: string; paymentMethod: string; pointsToUse?: number; note?: string },
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
