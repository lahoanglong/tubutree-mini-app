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
 * Trang kế của infinite query. API có con trỏ thì đi theo con trỏ (dòng mới chèn đầu không làm trang sau lặp hoặc sót);
 * API cũ không trả `nextCursor` thì quay về offset như trước.
 */
export function nextPageParam(last: { meta: PageMeta }): PageParam | undefined {
  const { page, limit, total, nextCursor } = last.meta;
  if (nextCursor === undefined) return page * limit < total ? { page: page + 1 } : undefined;
  return nextCursor ? { page: page + 1, cursor: nextCursor } : undefined;
}
