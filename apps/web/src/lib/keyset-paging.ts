export interface PageParam {
  page: number;
  /** Con trỏ keyset do API trả ở trang trước; thiếu ở trang đầu và với API cũ chưa có con trỏ. */
  cursor?: string;
}

export const FIRST_PAGE: PageParam = { page: 1 };

interface PageMeta {
  page: number;
  limit: number;
  total: number;
  /** undefined: API cũ chưa hỗ trợ cursor (phân trang offset); null: hết dữ liệu. */
  nextCursor?: string | null;
}

/**
 * Trang kế của infinite query, cùng luật với Mini App: API có con trỏ thì đi theo con trỏ (dòng mới chèn đầu không làm
 * trang sau lặp hoặc sót); API cũ không trả `nextCursor` thì quay về offset.
 */
export function nextPageParam(last: { meta: PageMeta }): PageParam | undefined {
  const { page, limit, total, nextCursor } = last.meta;
  if (nextCursor === undefined) return page * limit < total ? { page: page + 1 } : undefined;
  return nextCursor ? { page: page + 1, cursor: nextCursor } : undefined;
}

/** Bỏ dòng trùng khoá, giữ lần đầu: danh sách nối nhiều trang có thể lặp dòng khi dữ liệu đổi giữa hai lần tải (API cũ theo offset). */
export function uniqueByKey<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = key(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
