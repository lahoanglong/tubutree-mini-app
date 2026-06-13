'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const router = useRouter();
  const { status, startZaloLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/');
  }, [status, router]);

  const onLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      await startZaloLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể đăng nhập.');
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="text-6xl">🌳</div>
      <h1 className="mt-4 text-2xl font-bold text-green-700">Tubu Tree</h1>
      <p className="mt-2 text-neutral-600">
        Đăng nhập để mua sắm, tích Điểm Xanh và đồng bộ giỏ hàng với Zalo Mini App.
      </p>

      <button
        onClick={onLogin}
        disabled={busy}
        className="mt-8 w-full rounded-full bg-green-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-green-700 disabled:opacity-60"
      >
        {busy ? 'Đang chuyển tới Zalo…' : 'Đăng nhập với Zalo'}
      </button>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <a href="/" className="mt-6 text-sm text-neutral-400 hover:text-neutral-600">
        Quay lại trang chủ
      </a>
    </main>
  );
}
