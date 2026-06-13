'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  apiFetch,
  setAccessToken,
  setRefreshToken,
  getRefreshToken,
} from './client-api';

export interface WebUser {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: string;
  pointsBalance: number;
  walletBalance: number;
  referralCode: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: WebUser;
}

interface AuthState {
  user: WebUser | null;
  status: 'idle' | 'loading' | 'authenticated';
  startZaloLogin: () => Promise<void>;
  handleCallback: (code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ZALO_APP_ID = process.env.NEXT_PUBLIC_ZALO_APP_ID ?? '';
const PKCE_KEY = 'tubu_pkce_verifier';

function randomString(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ('0' + b.toString(16)).slice(-2)).join('');
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<WebUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('idle');

  // Khôi phục phiên từ refresh token đã lưu.
  useEffect(() => {
    const rt = getRefreshToken();
    if (!rt) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    apiFetch<LoginResponse>('/auth/refresh', { method: 'POST', body: { refreshToken: rt }, auth: false })
      .then((res) => {
        setAccessToken(res.accessToken);
        setRefreshToken(res.refreshToken);
        setUser(res.user);
        setStatus('authenticated');
      })
      .catch(() => {
        setRefreshToken(null);
        setStatus('idle');
      });
  }, []);

  const startZaloLogin = useCallback(async () => {
    if (!ZALO_APP_ID) {
      throw new Error('Đăng nhập Zalo chưa được cấu hình (thiếu NEXT_PUBLIC_ZALO_APP_ID).');
    }
    const verifier = randomString(48);
    sessionStorage.setItem(PKCE_KEY, verifier);
    const challenge = await sha256Base64Url(verifier);
    const redirectUri = `${window.location.origin}/dang-nhap/callback`;
    const url =
      `https://oauth.zaloapp.com/v4/permission?app_id=${encodeURIComponent(ZALO_APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${encodeURIComponent(challenge)}&state=tubu`;
    window.location.href = url;
  }, []);

  const handleCallback = useCallback(async (code: string) => {
    setStatus('loading');
    const codeVerifier = sessionStorage.getItem(PKCE_KEY) ?? undefined;
    const res = await apiFetch<LoginResponse>('/auth/zalo-oauth', {
      method: 'POST',
      body: { code, codeVerifier },
      auth: false,
    });
    setAccessToken(res.accessToken);
    setRefreshToken(res.refreshToken);
    setUser(res.user);
    setStatus('authenticated');
    sessionStorage.removeItem(PKCE_KEY);
  }, []);

  const logout = useCallback(async () => {
    const rt = getRefreshToken();
    if (rt) await apiFetch('/auth/logout', { method: 'POST', body: { refreshToken: rt }, auth: false }).catch(() => {});
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
    setStatus('idle');
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, startZaloLogin, handleCallback, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
