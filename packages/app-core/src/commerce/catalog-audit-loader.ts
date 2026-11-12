import type { AuditProduct } from './catalog-quality-audit';

/**
 * Đọc catalog để kiểm tra chất lượng: danh sách công khai (ảnh, tên, tồn) rồi mô tả gốc từng sản phẩm. Danh sách không có mô tả nên phải đọc chi tiết;
 * mỗi app chỉ cắm hai hàm đọc của mình (`CatalogAuditSource`) còn logic phân trang, giới hạn song song và hủy nằm ở đây, dùng chung Mini và web.
 * Một sản phẩm đọc chi tiết lỗi không làm hỏng cả lượt: mô tả của nó để `undefined` (không báo "trống mô tả") và slug vào `unreadable` để UI nói rõ.
 */
export interface CatalogListRow {
  slug: string;
  name: string;
  thumbnail: string | null;
  inStock: boolean;
}

export interface CatalogAuditSource {
  listPage(page: number, limit: number): Promise<{ rows: readonly CatalogListRow[]; total: number }>;
  /** Mô tả gốc của DB (chưa bù chữ dự phòng). */
  readDescription(slug: string): Promise<string | null>;
}

export interface CatalogAuditProgress {
  stage: 'list' | 'detail';
  done: number;
  total: number;
}

export interface CatalogAuditLoadOptions {
  /** Mặc định 100 (trần của `GET /products`). */
  pageSize?: number;
  /** Số lần đọc chi tiết chạy cùng lúc; mặc định 6. */
  concurrency?: number;
  /** Chặn vòng lặp khi `total` của máy chủ sai; mặc định 30 trang. */
  maxPages?: number;
  signal?: AbortSignal;
  onProgress?: (p: CatalogAuditProgress) => void;
}

export interface CatalogAuditLoad {
  products: AuditProduct[];
  /** Slug không đọc được mô tả (lỗi mạng; bị hủy giữa chừng thì cả lượt ném lỗi hủy, không tính ở đây). */
  unreadable: string[];
}

function abortError(): Error {
  const e = new Error('Đã hủy kiểm tra');
  e.name = 'AbortError';
  return e;
}

export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export async function loadCatalogForAudit(source: CatalogAuditSource, opts: CatalogAuditLoadOptions = {}): Promise<CatalogAuditLoad> {
  const pageSize = Math.max(1, Math.min(100, opts.pageSize ?? 100));
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const maxPages = Math.max(1, opts.maxPages ?? 30);
  const check = () => {
    if (opts.signal?.aborted) throw abortError();
  };

  const rows: CatalogListRow[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 1; page <= maxPages; page += 1) {
    check();
    const res = await source.listPage(page, pageSize);
    check();
    total = res.total;
    for (const r of res.rows) {
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      rows.push(r);
    }
    opts.onProgress?.({ stage: 'list', done: rows.length, total: Math.max(total, rows.length) });
    if (res.rows.length === 0 || rows.length >= total) break;
  }

  const products: AuditProduct[] = rows.map((r) => ({ slug: r.slug, name: r.name, thumbnail: r.thumbnail, inStock: r.inStock }));
  const unreadable: string[] = [];
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      check();
      const i = next;
      next += 1;
      const p = products[i];
      if (!p) return;
      try {
        p.description = await source.readDescription(p.slug);
      } catch {
        unreadable.push(p.slug);
      }
      check();
      done += 1;
      opts.onProgress?.({ stage: 'detail', done, total: products.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, products.length) }, worker));
  return { products, unreadable };
}
