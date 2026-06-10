import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { LoginResponse } from '@tubutree/shared-types';
import { vi } from '../i18n/vi';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';
const TIMEOUT_MS = 15_000;

/**
 * Axios instance dùng chung. Access token giữ trong memory (an toàn hơn storage),
 * refresh token lưu qua ZMP storage (xem store/auth.ts).
 */
export const api = axios.create({ baseURL: BASE_URL, timeout: TIMEOUT_MS });

let accessToken: string | null = null;
let onUnauthorized: (() => Promise<string | null>) | null = null;
/** Refresh đang chạy — các 401 song song chờ chung 1 promise, tránh refresh bão. */
let refreshInFlight: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Đăng ký callback refresh khi gặp 401 (set bởi auth store). */
export function setUnauthorizedHandler(handler: (() => Promise<string | null>) | null): void {
  onUnauthorized = handler;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retried && onUnauthorized) {
      original._retried = true;
      refreshInFlight ??= onUnauthorized().finally(() => {
        refreshInFlight = null;
      });
      const newToken = await refreshInFlight;
      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`);
        return api.request(original);
      }
    }
    return Promise.reject(error);
  },
);

/**
 * Chuẩn hóa mọi lỗi API thành message Việt thân thiện (Voice & Tone §7.5).
 * Ưu tiên message backend (NestJS trả tiếng Việt sẵn, vd "Giỏ hàng trống."),
 * fallback theo loại lỗi. Component KHÔNG tự diễn dịch AxiosError.
 */
export function getErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    const backendMsg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    // Message backend 4xx là nghiệp vụ (viết sẵn tiếng Việt) — hiển thị thẳng.
    if (backendMsg && error.response && error.response.status < 500) return backendMsg;
    if (error.code === 'ECONNABORTED') return vi.errors.timeout;
    if (!error.response) return vi.errors.network;
    return vi.errors.server;
  }
  return vi.errors.generic;
}

// ── Auth endpoints ────────────────────────────────────
export async function loginZaloMiniApp(code: string, zaloAccessToken: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/zalo-mini-app', {
    code,
    accessToken: zaloAccessToken,
  });
  return data;
}

export async function refreshTokens(refreshToken: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/refresh', { refreshToken });
  return data;
}
