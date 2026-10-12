'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trees } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ui } from '@/lib/guest-ui';

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
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-sheet bg-forest-50 text-forest-700 shadow-card ring-8 ring-forest-50/50">
        <Trees className="h-10 w-10" aria-hidden="true" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-forest-800">Tubu Tree</h1>
      <p className="mt-2 text-stone-700">
        Đăng nhập để mua sắm, tích Điểm Xanh và đồng bộ giỏ hàng với Zalo Mini App.
      </p>

      <button type="button" onClick={onLogin} disabled={busy} className={`${ui.btnPrimary} mt-8 w-full`}>
        {busy ? 'Đang chuyển tới Zalo…' : 'Đăng nhập với Zalo'}
      </button>

      {error && (
        <p role="alert" className={`mt-4 ${ui.error}`}>
          {error}
        </p>
      )}

      <a href="/" className={`${ui.backLink} mt-4 text-stone-600 hover:text-stone-900`}>
        Quay lại trang chủ
      </a>
    </main>
  );
}
