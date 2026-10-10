'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ui } from '@/lib/guest-ui';

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { handleCallback } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const oauthError = params.get('error');
    if (oauthError) {
      setError(params.get('error_description') || `Zalo từ chối đăng nhập (${oauthError}).`);
      return;
    }
    const code = params.get('code');
    if (!code) {
      setError('Thiếu mã đăng nhập từ Zalo.');
      return;
    }
    handleCallback(code, params.get('state'))
      .then(() => router.replace('/'))
      .catch((e) => setError(e instanceof Error ? e.message : 'Đăng nhập thất bại.'));
  }, [params, handleCallback, router]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      {error ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-danger-bg text-danger-fg shadow-card">
            <AlertCircle className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold text-stone-900">Đăng nhập chưa thành công</h1>
          <p role="alert" className={`mt-2 font-medium ${ui.error}`}>
            {error}
          </p>
          <a href="/dang-nhap" className={`${ui.btnPrimary} mt-6`}>
            Thử lại
          </a>
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
