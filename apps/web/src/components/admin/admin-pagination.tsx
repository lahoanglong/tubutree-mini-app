'use client';

import { useEffect, useState, type FormEvent, type RefObject } from 'react';
import { BTN_SMALL, FIELD_CLASS } from './ui';

/**
 * Thanh phân trang chung của bảng quản trị: Trước/Sau, ô số trang (nhập rồi Enter hoặc "Đến" để nhảy thẳng) và, khi đổi trang, cuộn về đầu bảng:
 * đang ở cuối trang dài mà bấm "Trang sau" thì trang mới hiện ra mà mắt vẫn ở cuối, tưởng chưa có gì đổi.
 *
 * `scrollTargetRef` trỏ vào khung bọc bảng/danh sách (nên có `scroll-mt-*` để không chui dưới thanh dính). Một trang trở xuống thì không vẽ gì.
 * Khung ngoài xuống dòng được (flex-wrap) và nút cao 44px khi chạm: ở 360px thanh không tràn ngang.
 */
export function AdminPagination({
  page,
  totalPages,
  total,
  noun,
  onPageChange,
  scrollTargetRef,
}: {
  page: number;
  totalPages: number;
  total: number;
  /** Đơn vị đếm sau "Tổng số: N", vd "đơn hàng", "người dùng". */
  noun: string;
  onPageChange: (page: number) => void;
  scrollTargetRef?: RefObject<HTMLElement | null>;
}) {
  const [draft, setDraft] = useState(String(page));
  useEffect(() => setDraft(String(page)), [page]);
  if (totalPages <= 1) return null;

  const go = (next: number) => {
    const target = Math.min(totalPages, Math.max(1, next));
    if (target === page) return;
    onPageChange(target);
    // jsdom và trình duyệt cũ không có scrollIntoView; người đặt giảm chuyển động thì cuộn thẳng, không mượt.
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scrollTargetRef?.current?.scrollIntoView?.({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const jump = (e: FormEvent) => {
    e.preventDefault();
    // Ô trống: Number('') là 0, kẹp lại thành trang 1 sẽ nhảy về đầu dù admin chưa nhập gì.
    const n = draft.trim() === '' ? NaN : Number(draft);
    if (!Number.isInteger(n)) {
      setDraft(String(page));
      return;
    }
    go(n);
    setDraft(String(Math.min(totalPages, Math.max(1, n))));
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 text-sm text-stone-600">
      <div>
        Tổng số: <span className="font-semibold text-stone-900">{total}</span> {noun}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => go(page - 1)} disabled={page <= 1} className={BTN_SMALL}>
          ← Trang trước
        </button>
        <form onSubmit={jump} noValidate className="flex items-center gap-1 text-xs">
          <label className="flex items-center gap-1">
            Trang
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={totalPages}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={`Số trang, từ 1 đến ${totalPages}`}
              className={`${FIELD_CLASS} min-h-[44px] w-16 px-2 py-1 text-center text-xs sm:min-h-8`}
            />
            / {totalPages}
          </label>
          <button type="submit" className={BTN_SMALL}>
            Đến
          </button>
        </form>
        <button type="button" onClick={() => go(page + 1)} disabled={page >= totalPages} className={BTN_SMALL}>
          Trang sau →
        </button>
      </div>
    </div>
  );
}
