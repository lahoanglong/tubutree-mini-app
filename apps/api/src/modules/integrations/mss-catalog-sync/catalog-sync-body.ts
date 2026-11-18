/**
 * Thân `POST /api/integrations/mss/catalog-sync` (MSS đẩy sang Tubu, kiến trúc A3 Pancake → MSS → Tubu). Hợp đồng ở
 * `docs/integrations/mss-catalog-sync.md`. Đọc bằng tay như chuông `catalog-changed`: khoá lạ bỏ qua (thêm trường là thay đổi tương thích),
 * sai kiểu ở vỏ thì cả yêu cầu 400, sai ở một dòng tồn thì chỉ dòng đó bị đếm `invalid`. Tài liệu sản phẩm trong `products` đọc sau, bằng
 * đúng bộ đọc của lượt kéo (`parseMssProductDoc`), nên một tài liệu hỏng không làm hỏng cả lô.
 */

export const CATALOG_SYNC_LIMITS = {
  /** Tài liệu sản phẩm mỗi lần đẩy (mỗi tài liệu tới ~25 KB, cả thân giữ dưới trần 1 MB của tầng parser). */
  products: 20,
  /** Dòng tồn mỗi lần đẩy (bằng trần 200 mã của chuông, mục 1.3). */
  stock: 200,
  /** Tồn lớn nhất nhận được: cột `variations.stock` là int4; Pancake báo tồn ảo 99.999.988 cho hàng không quản kho. */
  maxStock: 2_000_000_000,
} as const;

const SYNC_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface CatalogSyncStockLine {
  pancakeVariationId: string;
  /** Số tồn tuyệt đối Pancake báo (`remain_quantity`), không phải số cộng/trừ: gửi lại cùng dòng không đổi gì. */
  stock: number;
  /** Lúc MSS đọc số này từ Pancake (giờ máy chủ MSS). */
  asOf: Date;
}

export interface CatalogSyncEnvelope {
  syncId: string;
  sentAt: Date | null;
  products: unknown[];
  stock: CatalogSyncStockLine[];
  /** Dòng tồn sai dạng (thiếu mã, số âm, số lẻ, giờ hỏng), bị bỏ. */
  invalidStock: number;
  /** Số định nghĩa combo MSS gửi kèm: bản này Tubu chưa áp (combo là đường tiền), chỉ đếm để MSS biết. */
  bundles: number;
}

export type CatalogSyncParse = { ok: true; value: CatalogSyncEnvelope } | { ok: false; error: 'invalid_body' | 'too_many_products' | 'too_many_stock' | 'empty' };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** ISO 8601 có múi giờ (cùng dạng `updated_at` của tài liệu sản phẩm). */
export function parseIsoInstant(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function stockLine(raw: unknown): CatalogSyncStockLine | null {
  if (!isObj(raw)) return null;
  const id = raw.pancake_variation_id;
  const n = raw.stock;
  const asOf = parseIsoInstant(raw.as_of);
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > CATALOG_SYNC_LIMITS.maxStock) return null;
  if (!asOf) return null;
  return { pancakeVariationId: id, stock: n, asOf };
}

export function parseCatalogSyncBody(body: unknown): CatalogSyncParse {
  if (!isObj(body)) return { ok: false, error: 'invalid_body' };
  const syncId = body.sync_id;
  if (typeof syncId !== 'string' || !SYNC_ID_RE.test(syncId)) return { ok: false, error: 'invalid_body' };
  let sentAt: Date | null = null;
  if (body.sent_at !== undefined && body.sent_at !== null) {
    sentAt = parseIsoInstant(body.sent_at);
    if (!sentAt) return { ok: false, error: 'invalid_body' };
  }
  const arr = (v: unknown): unknown[] | null | 'bad' => (v === undefined || v === null ? null : Array.isArray(v) ? v : 'bad');
  const products = arr(body.products);
  const stockRaw = arr(body.stock);
  const bundles = arr(body.bundles);
  if (products === 'bad' || stockRaw === 'bad' || bundles === 'bad') return { ok: false, error: 'invalid_body' };
  if ((products?.length ?? 0) > CATALOG_SYNC_LIMITS.products) return { ok: false, error: 'too_many_products' };
  if ((stockRaw?.length ?? 0) > CATALOG_SYNC_LIMITS.stock) return { ok: false, error: 'too_many_stock' };
  if (!products?.length && !stockRaw?.length && !bundles?.length) return { ok: false, error: 'empty' };

  // Một biến thể xuất hiện nhiều lần trong lô: giữ dòng đọc muộn nhất (cùng giờ thì dòng sau), vì chỉ số mới nhất có nghĩa.
  const byId = new Map<string, CatalogSyncStockLine>();
  let invalidStock = 0;
  for (const raw of stockRaw ?? []) {
    const line = stockLine(raw);
    if (!line) {
      invalidStock += 1;
      continue;
    }
    const prev = byId.get(line.pancakeVariationId);
    if (!prev || line.asOf.getTime() >= prev.asOf.getTime()) byId.set(line.pancakeVariationId, line);
  }
  return {
    ok: true,
    value: { syncId, sentAt, products: products ?? [], stock: [...byId.values()], invalidStock, bundles: bundles?.length ?? 0 },
  };
}
