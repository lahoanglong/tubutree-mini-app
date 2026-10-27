'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LogIn, WifiOff } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { loginHref } from '@/lib/return-to';
import { ui } from '@/lib/guest-ui';
import { LineItemSkeleton, Skeleton } from '@/components/ui/skeleton';

/** Khối "cần đăng nhập" dùng chung cho giỏ hàng, thanh toán, tài khoản, chi tiết đơn. */
export function LoginRequired({ message, returnTo }: { message: string; returnTo: string }) {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-forest-50 text-forest-600 shadow-card">
        <LogIn className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
      </div>
      <p className="mx-auto mt-4 max-w-sm text-stone-700">{message}</p>
      <Link href={loginHref(returnTo)} className={`${ui.btnPrimary} mt-4`}>
        Đăng nhập với Zalo
      </Link>
      <p className="mx-auto mt-3 max-w-sm text-xs text-stone-600">Đăng nhập xong bạn sẽ quay lại đúng trang này.</p>
    </div>
  );
}

/** Đang khôi phục phiên đăng nhập — ngắn, chỉ ở lần mở trang đầu. */
export function AuthLoading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3 py-4">
      <span className="sr-only">Đang tải…</span>
      <Skeleton height={44} rounded="rounded-card" />
      <LineItemSkeleton />
      <LineItemSkeleton />
    </div>
  );
}

/**
 * Khách đang đăng nhập nhưng lúc mở trang mất mạng/API tạm lỗi (xem `AuthPhase` 'unavailable'): nói đúng chuyện đó
 * thay vì mời đăng nhập lại. Trang tự thử lại khi có mạng hoặc khi quay lại tab; nút để khách chủ động thử.
 */
export function SessionUnavailable() {
  const { retrySession } = useAuth();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await retrySession();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="status" className="py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-warning-bg text-warning-fg shadow-card">
        <WifiOff className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
      </div>
      <p className="mx-auto mt-4 max-w-sm font-semibold text-stone-900">Không kết nối được với Tubu Tree</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-stone-700">
        Bạn vẫn đang đăng nhập — chỉ là mạng hoặc máy chủ đang chập chờn. Tubu sẽ tự thử lại khi có mạng, hoặc bạn bấm nút bên dưới.
      </p>
      <button type="button" onClick={() => void retry()} disabled={busy} className={`${ui.btnPrimary} mt-4`}>
        {busy ? 'Đang thử lại…' : 'Thử lại'}
      </button>
    </div>
  );
}
