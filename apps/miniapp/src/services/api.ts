import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { LoginResponse } from '@tubutree/shared-types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api';

/**
 * Axios instance dùng chung. Access token giữ trong memory (an toàn hơn storage),
 * refresh token lưu qua ZMP storage (xem store/auth.ts).
 */
export const api = axios.create({ baseURL: BASE_URL, timeout: 15000 });

let accessToken: string | null = null;
let onUnauthorized: (() => Promise<string | null>) | null = null;

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
      const newToken = await onUnauthorized();
      if (newToken) {
        original.headers.set('Authorization', `Bearer ${newToken}`);
        return api.request(original);
      }
    }
    return Promise.reject(error);
  },
);

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
