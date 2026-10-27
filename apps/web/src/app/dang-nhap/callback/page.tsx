'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { isTransientLoginFailure, loginFailureMessage, oauthErrorMessage } from '@/lib/login-errors';
import { loginHref, takeReturnTo } from '@/lib/return-to';
import { ui } from '@/lib/guest-ui';

interface Failure {
  message: string;
  retryHref: string;
  transient: boolean;
}

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { handleCallback } = useAuth();
  const [failure, setFailure] = useState<Failure | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // Thất bại thì giữ nơi cần quay lại để "Đăng nhập lại" đưa khách về đúng chỗ sau lần thử kế tiếp.
    const fail = (message: string, detail?: unknown, transient = false) => {
      if (detail !== undefined) console.error('[dang-nhap] đăng nhập thất bại', detail);
      // Dấu khung chờ do script ở <head> đặt chỉ được AccountShell gỡ; đăng nhập hỏng rồi sang /tai-khoan thì dấu còn sót làm khung nháy một khung hình.
      document.documentElement.removeAttribute('data-restoring');
      setFailure({ message, retryHref: loginHref(takeReturnTo()), transient });
    };
    const oauthError = params.get('error');
    if (oauthError) {
      fail(oauthErrorMessage(oauthError), { error: oauthError, description: params.get('error_description') });
      return;
    }
    const code = params.get('code');
    if (!code) {
      fail('Zalo không gửi kèm mã đăng nhập. Vui lòng đăng nhập lại.');
      return;
    }
    handleCallback(code, params.get('state'))
      .then(() => router.replace(takeReturnTo() ?? '/'))
      .catch((e) => fail(loginFailureMessage(e), e, isTransientLoginFailure(e)));
  }, [params, handleCallback, router]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      {failure ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-danger-bg text-danger-fg shadow-card">
            <AlertCircle className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold text-stone-900">Đăng nhập chưa thành công</h1>
          <p role="alert" className={`mt-2 font-medium ${ui.error}`}>
            {failure.message}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a href={failure.retryHref} className={ui.btnPrimary}>
              {failure.transient ? 'Thử lại' : 'Đăng nhập lại'}
            </a>
            {/* Tải lại hẳn trang: trao đổi mã lỗi để trạng thái đăng nhập ở 'idle'; tải lại mới khôi phục phiên cookie còn hạn. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className={ui.btnSecondary}>
              Về trang chủ
            </a>
          </div>
        </>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="h-10 w-10 animate-spin rounded-full border-4 border-forest-200 border-t-forest-600"
          />
          <h1 className="mt-4 text-base font-normal text-stone-700">
            Đang đăng nhập…
          </h1>
        </>
      )}
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-stone-600">Đang tải…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
