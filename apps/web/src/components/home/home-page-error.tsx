'use client';

import { useRef } from 'react';
import { homeText } from '@/lib/home-text';
import { ui } from '@/lib/guest-ui';
import { homeErrorMessage } from './home-block-error';

export interface HomePageErrorProps {
  error?: unknown;
  /** Tải lại cả trang (thường là `refreshHomeQueries`). */
  onRetry: () => unknown;
  retrying?: boolean;
}

/**
 * Dải lỗi cấp trang của Trang chủ (D7 mục 5): API sập hẳn thì một thẻ có tiêu đề và một nút "Thử lại" thay cho hàng loạt
 * thẻ lỗi từng kệ. Nằm ngay dưới ô tìm để khách thấy ngay, không phải kéo xuống mới biết trang đang lỗi.
 */
export function HomePageError({ error, onRetry, retrying = false }: HomePageErrorProps) {
  const busy = useRef(false);
  // `retrying` chỉ đúng sau lần dựng lại kế tiếp nên hai cú chạm sát nhau vẫn tải lại hai lần (mỗi lần huỷ và gửi lại cả loạt request); ref đồng bộ chặn ngay.
  // Lỗi tải đã hiện ở từng khối nên chỉ cần nhả khoá khi xong, lỗi hay ném đồng bộ.
  const retry = () => {
    if (retrying || busy.current) return;
    busy.current = true;
    const release = () => {
      busy.current = false;
    };
    try {
      Promise.resolve(onRetry()).then(release, (err: unknown) => {
        release();
        throw err;
      });
    } catch (e) {
      release();
      throw e;
    }
  };
  return (
    <section aria-label={homeText.loadErrorTitle} data-testid="home-page-error" className="py-2">
      <div role="alert" className="flex flex-col items-center gap-3 rounded-card border border-stone-200 bg-stone-0 p-6 text-center">
        <h2 className="font-display text-lg font-semibold text-stone-900">{homeText.loadErrorTitle}</h2>
        <p className="text-sm text-stone-700">{homeErrorMessage(error)}</p>
        <button type="button" aria-disabled={retrying || undefined} aria-busy={retrying || undefined} onClick={retry} className={ui.btnPrimary}>
          {homeText.retry}
        </button>
      </div>
    </section>
  );
}
