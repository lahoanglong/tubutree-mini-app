'use client';

import { ui } from '@/lib/guest-ui';
import { DEFAULT_SUPPORT } from '@/lib/api';

/** Lỗi tải dữ liệu kèm "Thử lại". Chữ mặc định giống `ErrorBoundary` của Mini App. */
export function ErrorState({
  message = 'Đã có lỗi xảy ra — Vui lòng thử lại',
  onRetry,
  retryLabel = 'Thử lại',
  showSupport = true,
}: {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Mini App luôn kèm hotline dưới lỗi; web giữ cùng cách để khách lỗi mạng vẫn có đường gọi. */
  showSupport?: boolean;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-stone-200 bg-stone-0 p-6 text-center">
      <p className="text-base text-stone-900">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={ui.btnPrimary}>
          {retryLabel}
        </button>
      )}
      {showSupport && (
        <p className="text-sm text-stone-600">
          Cần hỗ trợ? Gọi{' '}
          <a href={`tel:${DEFAULT_SUPPORT.hotline.replace(/\s/g, '')}`} className="font-semibold text-forest-700 hover:underline">
            {DEFAULT_SUPPORT.hotline}
          </a>
        </p>
      )}
    </div>
  );
}
