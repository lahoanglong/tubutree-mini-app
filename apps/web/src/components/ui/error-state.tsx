'use client';

import { useContext } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { ui } from '@/lib/guest-ui';
import { SupportHotline } from '@/components/support-hotline';

/**
 * Lỗi tải dữ liệu kèm "Thử lại", như ErrorState của Mini App: 'page' (mặc định) là lỗi cả trang, có dòng gọi hotline;
 * 'inline' là lỗi một khối nhúng trong trang, gọn hơn và không hotline (bật lại bằng `showSupport`). Ở điện thoại không vẽ
 * khung viền (Mini App không có), từ md giữ thẻ viền.
 */
export function ErrorState({
  message = 'Đã có lỗi xảy ra — Vui lòng thử lại',
  onRetry,
  retryLabel = 'Thử lại',
  title = 'Chưa tải được trang này',
  variant = 'page',
  showSupport,
}: {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Dòng tiêu đề đậm trên chữ báo lỗi (Mini App: "Chưa tải được trang này"). */
  title?: string;
  variant?: 'page' | 'inline';
  showSupport?: boolean;
}) {
  const inline = variant === 'inline';
  // Màn lỗi nằm ở khắp nơi, kể cả chỗ dựng không có QueryClientProvider (test đơn lẻ): khi đó chỉ ẩn dòng hotline.
  const hasQuery = useContext(QueryClientContext) !== undefined;
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-2.5 text-center md:rounded-card md:border md:border-stone-200 md:bg-stone-0 ${inline ? 'p-4' : 'px-8 pb-10 pt-[max(40px,20vh)] md:pt-12'}`}
    >
      <span aria-hidden="true" className={`flex items-center justify-center rounded-full bg-warning-bg text-warning-fg ${inline ? 'h-11 w-11' : 'h-14 w-14'}`}>
        <TriangleAlert className={inline ? 'h-[22px] w-[22px]' : 'h-7 w-7'} strokeWidth={1.75} />
      </span>
      <p className="font-display text-lg font-semibold text-stone-900">{title}</p>
      <p data-testid="error-message" className="max-w-xs text-sm text-stone-700">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${ui.btnPrimary} max-md:min-h-12 max-md:min-w-[7.5rem] max-md:rounded-full max-md:bg-forest-50 max-md:hover:bg-forest-100 max-md:px-6 max-md:text-base max-md:text-forest-700 max-md:shadow-none`}>
          {retryLabel}
        </button>
      )}
      {(showSupport ?? !inline) && hasQuery && <SupportHotline />}
    </div>
  );
}
