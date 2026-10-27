'use client';

import { createContext, useContext } from 'react';
import { homeText } from '@/lib/home-text';
import { ui } from '@/lib/guest-ui';
import { loadErrorText } from '@/lib/error-text';

/**
 * true khi Trang chủ đã hiện MỘT dải lỗi cấp trang (API sập hẳn): khối lỗi từng kệ ẩn đi, không xếp chồng 6 thẻ giống hệt nhau.
 * Cho cả những khối tự dựng HomeBlockError bên trong (giờ vàng, Mua lại) mà trang không điều khiển trực tiếp.
 */
export const HomeBlockErrorSuppressed = createContext(false);

/** Câu tiếng Việt cho khách theo loadErrorText (không lộ lời máy chủ thô); không có lỗi cụ thể thì câu chung của Trang chủ. */
export function homeErrorMessage(error: unknown): string {
  return error instanceof Error ? loadErrorText(error) : homeText.loadErrorMessage;
}

export interface HomeBlockErrorProps {
  title: string;
  error?: unknown;
  /** Thường là `query.refetch` */
  onRetry: () => unknown;
  /** Đang tải lại sau lỗi (`BlockQuery.isFetching` từ `useBlockQuery`, vốn giữ khối lỗi ở lại suốt lúc tải lại). */
  retrying?: boolean;
}

/**
 * Khối lỗi gọn của Trang chủ (C-084): giữ tiêu đề + một dòng thông báo + "Thử lại" ngay tại chỗ để khách không tưởng
 * cửa hàng ít hàng. Mỗi khối lỗi độc lập — thử lại chỉ tải lại đúng khối này.
 */
export function HomeBlockError({ title, error, onRetry, retrying = false }: HomeBlockErrorProps) {
  const suppressed = useContext(HomeBlockErrorSuppressed);
  if (suppressed) return null;
  return (
    <section aria-label={title} data-testid="home-block-error" className="py-2">
      <h2 className="mb-2 font-display text-lg font-semibold text-stone-900">{title}</h2>
      <div className="flex items-center justify-between gap-3 rounded-card border border-stone-200 bg-stone-0 p-3">
        <p className="min-w-0 text-sm text-stone-700">{homeErrorMessage(error)}</p>
        <button
          type="button"
          disabled={retrying}
          aria-busy={retrying || undefined}
          aria-label={homeText.retryLabel(title)}
          onClick={() => void onRetry()}
          className={`${ui.btnSecondary} flex-none`}
        >
          {homeText.retry}
        </button>
      </div>
    </section>
  );
}
