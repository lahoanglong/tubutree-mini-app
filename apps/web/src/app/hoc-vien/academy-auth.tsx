'use client';

import type { ReactNode } from 'react';
import { AuthLoading, LoginRequired, SessionUnavailable } from '@/components/login-required';
import { useAuthPhase } from '@/lib/auth-phase';

/** API Học viện cần đăng nhập: khách thấy lời mời quay lại đúng trang, mất kết nối thì không mời đăng nhập lại. */
export function AcademyAuthGate({ returnTo, children }: { returnTo: string; children: ReactNode }) {
  const phase = useAuthPhase();
  if (phase === 'loading') return <AuthLoading />;
  if (phase === 'unavailable') return <SessionUnavailable />;
  if (phase === 'guest') return <LoginRequired message="Đăng nhập để vào CTV Academy" returnTo={returnTo} />;
  return <>{children}</>;
}
