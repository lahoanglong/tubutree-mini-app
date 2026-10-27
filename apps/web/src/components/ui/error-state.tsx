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
  variant = 'page',
  showSupport,
}: {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  variant?: 'page' | 'inline';
  showSupport?: boolean;
}) {
  const inline = variant === 'inline';
  // Màn lỗi nằm ở khắp nơi, kể cả chỗ dựng không có QueryClientProvider (test đơn lẻ): khi đó chỉ ẩn dòng hotline.
  const hasQuery = useContext(QueryClientContext) !== undefined;
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-2.5 text-center md:rounded-card md:border md:border-stone-200 md:bg-stone-0 ${inline ? 'p-4' : 'px-8 pb-10 pt-12'}`}
    >
      <span aria-hidden="true" className={`flex items-center justify-center rounded-full bg-warning-bg text-warning-fg ${inline ? 'h-11 w-11' : 'h-14 w-14'}`}>
        <TriangleAlert className={inline ? 'h-[22px] w-[22px]' : 'h-7 w-7'} strokeWidth={1.75} />
      </span>
      <p className="text-base text-stone-900">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={ui.btnPrimary}>
          {retryLabel}
        </button>
      )}
      {(showSupport ?? !inline) && hasQuery && <SupportHotline />}
    </div>
  );
}
