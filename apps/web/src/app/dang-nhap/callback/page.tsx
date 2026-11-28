'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
  isTransientLoginFailure,
  isZaloNotApproved,
  loginFailureMessage,
  oauthErrorMessage,
  zaloParamsNotApproved,
} from '@/lib/login-errors';
import { takeReturnTo, zaloUnavailableLoginHref } from '@/lib/return-to';
import { routeTemplate, trackPurchase } from '@/lib/analytics';
import { LoginCompletionScreen, loginFailure, type LoginFailure } from '../login-completion';

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { handleCallback } = useAuth();
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const fail = (message: string, detail?: unknown, transient = false) => setFailure(loginFailure(message, detail, transient));
    // Ứng dụng Zalo chưa được duyệt (-14029): khách ngoài danh sách thử không đăng nhập Zalo được, đưa về trang đăng nhập có ô Email.
    const toEmailLogin = (detail: unknown) => {
      console.warn('[dang-nhap] Zalo chưa duyệt ứng dụng, chuyển sang đăng nhập Email', detail);
      document.documentElement.removeAttribute('data-restoring');
      router.replace(zaloUnavailableLoginHref(takeReturnTo()));
    };
    if (zaloParamsNotApproved(params)) {
      toEmailLogin({ error: params.get('error') ?? params.get('error_code'), description: params.get('error_description') });
      return;
    }
    const oauthError = params.get('error');
    if (oauthError) {
      fail(oauthErrorMessage(oauthError), { error: oauthError, description: params.get('error_description') });
      return;
    }
    const code = params.get('code');
    if (!code) {
      fail('Zalo không gửi kèm mã đăng nhập. Đăng nhập lại để tiếp tục.');
      return;
    }
    handleCallback(code, params.get('state'))
      .then(() => {
        const to = takeReturnTo() ?? '/';
        trackPurchase('login_completed', { from: routeTemplate(to) });
        router.replace(to);
      })
      .catch((e) => (isZaloNotApproved(e) ? toEmailLogin(e) : fail(loginFailureMessage(e), e, isTransientLoginFailure(e))));
  }, [params, handleCallback, router]);

  return <LoginCompletionScreen failure={failure} />;
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-stone-600">Đang tải…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
