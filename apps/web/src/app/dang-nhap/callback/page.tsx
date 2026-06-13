'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { handleCallback } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const code = params.get('code');
    if (!code) {
      setError('Thiếu mã đăng nhập từ Zalo.');
      return;
    }
    handleCallback(code)
      .then(() => router.replace('/'))
      .catch((e) => setError(e instanceof Error ? e.message : 'Đăng nhập thất bại.'));
  }, [params, handleCallback, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      {error ? (
        <>
          <div className="text-5xl">😕</div>
          <p className="mt-4 text-red-600">{error}</p>
          <a href="/dang-nhap" className="mt-6 rounded-full bg-green-600 px-6 py-2.5 font-semibold text-white">
            Thử lại
          </a>
        </>
      ) : (
        <>
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-green-200 border-t-green-600" />
          <p className="mt-4 text-neutral-600">Đang đăng nhập…</p>
        </>
      )}
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-neutral-400">Đang tải…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
