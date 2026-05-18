/**
 * API Service — Giao tiếp với Tubu Tree Backend
 *
 * Tất cả API calls đi qua đây.
 * JWT token được tự động gắn vào header nếu đã đăng nhập.
 */
import axios from 'axios';
import type {
  AuthResponse, ProductsResponse, Product, Category,
  CartItem, OrderRef, OrderDetail, Address,
  WishlistItem, NotificationsResponse, Banner, Review,
} from 'types';

// Base URL — đổi khi deploy production
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Tự động gắn JWT token
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('tubutree_token', token);
  } else {
    localStorage.removeItem('tubutree_token');
  }
}

export function getAuthToken(): string | null {
  if (!authToken) {
    authToken = localStorage.getItem('tubutree_token');
  }
  return authToken;
}

// Interceptor: gắn token vào mỗi request
api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ========== AUTH ==========
export const authApi = {
  login: (accessToken: string) =>
    api.post<AuthResponse>('/auth/login', { accessToken }).then(r => r.data),
};

// ========== PRODUCTS ==========
export const productApi = {
  getAll: (page = 1, limit = 20) =>
    api.get<ProductsResponse>('/products', { params: { page, limit } }).then(r => r.data),

  getDetail: (sku: string) =>
    api.get<Product>(`/products/${sku}`).then(r => r.data),

  getCategories: () =>
    api.get<{ data: Category[] }>('/products/categories').then(r => r.data),
};

// ========== CART ==========
export const cartApi = {
  getAll: () =>
    api.get<CartItem[]>('/cart').then(r => r.data),

  add: (pos_product_id: string, qty: number, variant_id?: string) =>
    api.post<CartItem>('/cart', { pos_product_id, qty, variant_id }).then(r => r.data),

  update: (id: number, qty: number) =>
    api.put<CartItem>(`/cart/${id}`, { qty }).then(r => r.data),

  remove: (id: number) =>
    api.delete(`/cart/${id}`).then(r => r.data),
};

// ========== ORDERS ==========
export const orderApi = {
  create: (data: { items: any[]; addressId: number; paymentMethod: string; notes?: string }) =>
    api.post('/orders', data).then(r => r.data),

  getAll: () =>
    api.get<OrderRef[]>('/orders').then(r => r.data),

  getDetail: (posOrderId: string) =>
    api.get<OrderDetail>(`/orders/${posOrderId}`).then(r => r.data),

  cancel: (posOrderId: string, reason?: string) =>
    api.put(`/orders/${posOrderId}/cancel`, { reason }).then(r => r.data),

  reorder: (posOrderId: string) =>
    api.post(`/orders/${posOrderId}/reorder`).then(r => r.data),
};

// ========== ADDRESSES ==========
export const addressApi = {
  getAll: () =>
    api.get<Address[]>('/addresses').then(r => r.data),

  create: (data: Omit<Address, 'id' | 'user_id'>) =>
    api.post<Address>('/addresses', data).then(r => r.data),

  update: (id: number, data: Partial<Address>) =>
    api.put<Address>(`/addresses/${id}`, data).then(r => r.data),

  remove: (id: number) =>
    api.delete(`/addresses/${id}`).then(r => r.data),
};

// ========== WISHLIST ==========
export const wishlistApi = {
  getAll: () =>
    api.get<WishlistItem[]>('/wishlists').then(r => r.data),

  add: (pos_product_id: string) =>
    api.post<WishlistItem>('/wishlists', { pos_product_id }).then(r => r.data),

  remove: (id: number) =>
    api.delete(`/wishlists/${id}`).then(r => r.data),
};

// ========== NOTIFICATIONS ==========
export const notificationApi = {
  getAll: (page = 1, limit = 20) =>
    api.get<NotificationsResponse>('/notifications', { params: { page, limit } }).then(r => r.data),

  markRead: (id: number) =>
    api.put(`/notifications/${id}/read`).then(r => r.data),

  markAllRead: () =>
    api.put('/notifications/read-all').then(r => r.data),
};

// ========== BANNERS ==========
export const bannerApi = {
  getActive: () =>
    api.get<Banner[]>('/banners').then(r => r.data),
};

// ========== REVIEWS ==========
export const reviewApi = {
  getByProduct: (productId: string) =>
    api.get<Review[]>(`/reviews/product/${productId}`).then(r => r.data),

  create: (data: { pos_product_id: string; rating: number; comment?: string; order_ref_id?: number }) =>
    api.post<Review>('/reviews', data).then(r => r.data),
};

export default api;
