'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trees } from 'lucide-react';
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
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-primary-50 text-primary-700 shadow-sm ring-8 ring-primary-50/50">
        <Trees className="h-10 w-10 text-primary-600" />
      </div>
      <h1 className="mt-5 text-2xl font-bold text-primary-800">Tubu Tree</h1>
      <p className="mt-2 text-neutral-600">
        Đăng nhập để mua sắm, tích Điểm Xanh và đồng bộ giỏ hàng với Zalo Mini App.
      </p>

      <button
        onClick={onLogin}
        disabled={busy}
        className="mt-8 w-full rounded-full bg-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
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
