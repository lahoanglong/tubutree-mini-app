'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { googleErrorMessage, isTransientLoginFailure, webLoginErrorMessage } from '@/lib/login-errors';
import { takeReturnTo } from '@/lib/return-to';
import { routeTemplate, trackPurchase } from '@/lib/analytics';
import { LoginCompletionScreen, loginFailure, type LoginFailure } from '../login-completion';

/** Google chuyển về đây với `?code&state` (hoặc `?error`); state được API đối chiếu với cookie HttpOnly đặt lúc bắt đầu. */
function GoogleInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { completeGoogleLogin } = useAuth();
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const fail = (message: string, detail?: unknown, transient = false) => setFailure(loginFailure(message, detail, transient));
    const error = params.get('error');
    if (error) {
      fail(googleErrorMessage(error), { error, description: params.get('error_description') });
      return;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      fail('Google không gửi kèm mã đăng nhập. Đăng nhập lại để tiếp tục.');
      return;
    }
    completeGoogleLogin(code, state)
      .then(() => {
        const to = takeReturnTo() ?? '/';
        trackPurchase('login_completed', { from: routeTemplate(to) });
        router.replace(to);
      })
      .catch((e) => fail(webLoginErrorMessage(e), e, isTransientLoginFailure(e)));
  }, [params, completeGoogleLogin, router]);

  return <LoginCompletionScreen failure={failure} />;
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-stone-600">Đang tải…</div>}>
      <GoogleInner />
    </Suspense>
  );
}
