'use client';

import { ui } from '@/lib/guest-ui';
import { usePressLock } from '@/lib/use-press-lock';

/** Nút "Tải thêm" của lịch sử có phân trang; tải trang kế lỗi thì giữ các dòng đã có và nói cách thử lại. */
export function LoadMore({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; isFetchNextPageError: boolean; fetchNextPage: () => unknown } }) {
  // `isFetchingNextPage` chỉ đúng sau lần vẽ kế: hai cú chạm cùng khung hình đều thấy nút rảnh, và lượt nạp thứ hai huỷ lượt đầu rồi gửi lại.
  // Nút bận không `disabled`: Chromium thả focus về body khi nút đang giữ focus bị vô hiệu.
  const loadMore = usePressLock(() => (q.isFetchingNextPage ? undefined : (q.fetchNextPage() as PromiseLike<unknown>)));
  if (!q.hasNextPage) return null;
  const busy = loadMore.busy || q.isFetchingNextPage;
  return (
    <div className="pt-2">
      {q.isFetchNextPageError && <p className="mb-1.5 text-center text-xs text-danger-fg">Chưa tải thêm được. Bạn bấm Tải thêm để thử lại nhé.</p>}
      <button type="button" onClick={loadMore.press} aria-busy={busy || undefined} aria-disabled={busy || undefined} className={`${ui.btnSecondary} w-full`}>
        {q.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
      </button>
    </div>
  );
}
