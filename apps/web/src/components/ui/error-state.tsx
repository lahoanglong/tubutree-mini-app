'use client';

import { ui } from '@/lib/guest-ui';

/** Lỗi tải dữ liệu kèm "Thử lại". Chữ mặc định giống `ErrorBoundary` của Mini App. */
export function ErrorState({
  message = 'Đã có lỗi xảy ra — Vui lòng thử lại',
  onRetry,
  retryLabel = 'Thử lại',
}: {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-stone-200 bg-stone-0 p-6 text-center">
      <p className="text-base text-stone-900">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={ui.btnPrimary}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
