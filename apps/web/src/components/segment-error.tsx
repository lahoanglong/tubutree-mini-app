'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportError } from '@/lib/error-report';
import { ui } from '@/lib/guest-ui';
import { SupportHotline } from '@/components/support-hotline';

/**
 * Lỗi của MỘT nhóm trang (thanh toán, tài khoản, chi tiết sản phẩm): nằm trong khung chung nên đầu trang, thanh đáy và menu vẫn còn,
 * khách thử lại hoặc gọi hotline ngay tại chỗ. app/error.tsx ở gốc chỉ là lưới cuối.
 */
export function SegmentError({ error, reset, message }: { error: Error & { digest?: string }; reset: () => void; message: string }) {
  useEffect(() => reportError(error), [error]);
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-card bg-warning-bg text-warning-fg shadow-card">
        <AlertTriangle className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="mt-5 font-display text-2xl font-semibold text-stone-900">Chưa tải được trang này</h1>
      <p className="mx-auto mt-2 max-w-sm text-stone-700">{message}</p>
      <button type="button" onClick={() => reset()} className={`${ui.btnPrimary} mt-6`}>
        Thử lại
      </button>
      <div className="mt-3">
        <SupportHotline />
      </div>
    </main>
  );
}
