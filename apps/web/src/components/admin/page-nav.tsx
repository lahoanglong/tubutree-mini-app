'use client';

/** Dòng tổng số + nút Trước/Sau cho danh sách phân trang theo số trang (nút chỉ hiện khi có từ 2 trang). */
export function PageNav({
  page,
  limit,
  total,
  onPage,
  noun,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
  noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const btn = 'min-h-[44px] rounded border border-neutral-200 px-3 text-sm text-neutral-700 disabled:opacity-40 sm:min-h-[32px]';
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
      <span>
        {total} {noun}
        {pages > 1 && ` · Trang ${page}/${pages}`}
      </span>
      {pages > 1 && (
        <div className="flex gap-2">
          <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Trước
          </button>
          <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Sau
          </button>
        </div>
      )}
    </div>
  );
}
