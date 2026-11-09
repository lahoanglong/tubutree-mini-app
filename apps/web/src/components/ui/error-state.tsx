'use client';

import { useContext } from 'react';
import { ERROR_GENERIC, GO_HOME_LABEL, NOT_FOUND_TITLE } from '@tubutree/app-core/client-copy';
import { QueryClientContext } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { ui } from '@/lib/guest-ui';
import { SupportHotline } from '@/components/support-hotline';
import { usePressLock } from '@/lib/use-press-lock';

/**
 * Lỗi tải dữ liệu kèm "Thử lại", như ErrorState của Mini App: 'page' (mặc định) là lỗi cả trang, có dòng gọi hotline;
 * 'inline' là lỗi một khối nhúng trong trang, gọn hơn và không hotline (bật lại bằng `showSupport`). Ở điện thoại không vẽ
 * khung viền (Mini App không có), từ md giữ thẻ viền.
 */
export function ErrorState({
  message = ERROR_GENERIC,
  onRetry,
  retryLabel = 'Thử lại',
  title,
  onHome,
  variant = 'page',
  showSupport,
}: {
  message?: string;
  /** Trả Promise (vd. `() => query.refetch()`) thì nút khoá bấm lại tới khi Promise xong; trả void thì không khoá được. */
  onRetry?: () => void | PromiseLike<unknown>;
  retryLabel?: string;
  /** Dòng tiêu đề đậm trên chữ báo lỗi (Mini App: "Chưa tải được trang này"). */
  title?: string;
  /** Có thì thay "Thử lại" bằng "Về trang chủ" (lỗi 404: bấm lại cũng không khác đi) và tiêu đề mặc định thành "Không tìm thấy", như Mini App. */
  onHome?: () => void;
  variant?: 'page' | 'inline';
  showSupport?: boolean;
}) {
  const inline = variant === 'inline';
  // Màn lỗi nằm ở khắp nơi, kể cả chỗ dựng không có QueryClientProvider (test đơn lẻ): khi đó chỉ ẩn dòng hotline.
  const hasQuery = useContext(QueryClientContext) !== undefined;
  // Nút bận không `disabled` để giữ focus; khoá chạm đúp là ref trong `usePressLock`.
  const { press: retry, busy } = usePressLock(onRetry);
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-2.5 text-center md:rounded-card md:border md:border-stone-200 md:bg-stone-0 ${inline ? 'p-4' : 'px-8 pb-10 pt-[max(40px,20vh)] md:pt-12'}`}
    >
      <span aria-hidden="true" className={`flex items-center justify-center rounded-full bg-warning-bg text-warning-fg ${inline ? 'h-11 w-11' : 'h-14 w-14'}`}>
        <TriangleAlert className={inline ? 'h-[22px] w-[22px]' : 'h-7 w-7'} strokeWidth={1.75} />
      </span>
      <p className="font-display text-lg font-semibold text-stone-900">{title ?? (onHome ? NOT_FOUND_TITLE : 'Chưa tải được trang này')}</p>
      <p data-testid="error-message" className="max-w-xs text-sm text-stone-700">{message}</p>
      {(onHome || onRetry) && (
        <button
          type="button"
          onClick={onHome ?? retry}
          aria-busy={(!onHome && busy) || undefined}
          aria-disabled={(!onHome && busy) || undefined}
          className={`${ui.btnPrimary} max-md:min-h-12 max-md:min-w-[7.5rem] max-md:rounded-full max-md:bg-forest-50 max-md:hover:bg-forest-100 max-md:px-6 max-md:text-base max-md:text-forest-700 max-md:shadow-none`}
        >
          {onHome ? GO_HOME_LABEL : retryLabel}
        </button>
      )}
      {(showSupport ?? !inline) && hasQuery && <SupportHotline />}
    </div>
  );
}
