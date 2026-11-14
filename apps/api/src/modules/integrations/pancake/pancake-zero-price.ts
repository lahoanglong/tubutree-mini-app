import type { PrismaClient } from '@prisma/client';
import { payloadPrice } from './pancake-payload';

/** Hàng ops_health_states giữ danh sách SKU đang bị Pancake báo giá 0đ (màn "Kiểm tra catalog" của admin đọc). */
export const ZERO_PRICE_STATE_KEY = 'pancake.catalog.zero-price';

/** Số SKU tối đa lưu và trả cho admin; `count` vẫn là số thật. Catalog Tubu chỉ vài trăm SKU nên trần này chỉ để bảo vệ hàng JSON. */
export const ZERO_PRICE_LIST_CAP = 200;
/** Số SKU tối đa trong một dòng log (log dài làm khó đọc; danh sách đầy đủ nằm ở màn admin). */
export const ZERO_PRICE_LOG_CAP = 20;

/**
 * PRICE_KEPT: biến thể đang có giá dương trên Tubu mà Pancake báo 0đ — giá cũ được giữ, storefront không đổi (nghi sửa nhầm trên POS).
 * NEW_AT_ZERO: biến thể chưa từng có giá dương — tạo/giữ ở trạng thái NO_PRICE (ngừng bán), không hiện 0đ ngoài cửa hàng.
 */
export type ZeroPriceKind = 'PRICE_KEPT' | 'NEW_AT_ZERO';

export interface ZeroPriceAnomaly {
  pancakeId: string;
  sku: string;
  productName: string;
  kind: ZeroPriceKind;
  /** Giá dương Tubu đang giữ (PRICE_KEPT); null với NEW_AT_ZERO. */
  keptPrice: number | null;
}

export interface ZeroPriceSummary {
  scope: 'FULL' | 'INCREMENTAL';
  /** ISO giờ ghi. */
  updatedAt: string;
  count: number;
  keptCount: number;
  newCount: number;
  skus: ZeroPriceAnomaly[];
  /** `skus` đã bị cắt ở ZERO_PRICE_LIST_CAP. */
  truncated: boolean;
}

export interface ZeroPriceInput {
  /** `retail_price` nguyên văn từ Pancake. */
  retail: unknown;
  removed: boolean;
  /** Pancake đánh dấu rõ biến thể là quà tặng/hàng tặng (xem `isGiftMarked`). */
  gift: boolean;
  prev: { retailPrice: number; isActive: boolean; pancakeHold: string | null } | null;
}

/**
 * Cờ quà tặng ở biến thể Pancake. Tài liệu Pancake POS không nêu cờ này; đọc phòng thủ `is_gift === true` để nếu có thì 0đ chủ
 * ý của quà tặng không bị báo là lỗi. Giá Tubu vẫn không bao giờ ghi 0đ (xem PANCAKE-12 ở pancake-sync.service.spec).
 */
export const isGiftMarked = (v: { is_gift?: unknown }): boolean => v.is_gift === true;

/**
 * Pancake gửi giá dạng chuỗi có phần thập phân ba số ("269000.000"), nên giá 0 có thể là "0.000" — `payloadPrice` đọc chuỗi này theo mẫu
 * ngăn nghìn và trả null, trong khi "0.00" lại đọc ra 0. Nhận mọi chuỗi chỉ gồm số 0 để dạng chuỗi nào cũng được báo như nhau.
 */
const isZeroText = (v: unknown): boolean => typeof v === 'string' && /^0+(?:[.,]0+)?$/.test(v.trim());

/**
 * Biến thể này có phải "Pancake báo giá 0đ" cần admin biết không. Chỉ số 0 tường minh (0, "0", "0.00", "0.000") — ô thiếu, chữ rác hay số âm
 * là "không biết giá" và đã có cảnh báo riêng. Bỏ qua: biến thể Pancake đã xoá, quà tặng có cờ mà Tubu chưa bán theo giá dương
 * (đang bán giá dương mà POS báo quà 0đ là chỗ cửa hàng lệch với POS nên vẫn báo), và biến thể admin tắt tay (không hiện ngoài cửa hàng
 * nên 0đ không gây hại).
 */
export function classifyZeroPrice(i: ZeroPriceInput): ZeroPriceKind | null {
  if (payloadPrice(i.retail) !== 0 && !isZeroText(i.retail)) return null;
  if (i.removed) return null;
  const sellingAtPositive = !!i.prev && i.prev.retailPrice > 0;
  if (i.gift && !sellingAtPositive) return null;
  if (i.prev && !i.prev.isActive && i.prev.pancakeHold == null) return null;
  return sellingAtPositive ? 'PRICE_KEPT' : 'NEW_AT_ZERO';
}

/** Gom kết quả của một lượt quét theo mã biến thể Pancake: ghi sau cùng thắng. */
export class ZeroPriceCollector {
  private readonly foundBy = new Map<string, ZeroPriceAnomaly>();
  private readonly resolvedIds = new Set<string>();

  note(pancakeId: string, anomaly: ZeroPriceAnomaly | null): void {
    if (anomaly) {
      this.foundBy.set(pancakeId, anomaly);
      this.resolvedIds.delete(pancakeId);
    } else {
      this.foundBy.delete(pancakeId);
      this.resolvedIds.add(pancakeId);
    }
  }

  get found(): ZeroPriceAnomaly[] {
    return [...this.foundBy.values()];
  }

  /** Biến thể lượt này đọc được mà KHÔNG còn 0đ: lượt tăng dần dùng để gỡ chúng khỏi danh sách đang lưu. */
  get resolved(): ReadonlySet<string> {
    return this.resolvedIds;
  }
}

export function summarizeZeroPrice(found: readonly ZeroPriceAnomaly[], scope: ZeroPriceSummary['scope'], now = new Date()): ZeroPriceSummary {
  return {
    scope,
    updatedAt: now.toISOString(),
    count: found.length,
    keptCount: found.filter((a) => a.kind === 'PRICE_KEPT').length,
    newCount: found.filter((a) => a.kind === 'NEW_AT_ZERO').length,
    skus: found.slice(0, ZERO_PRICE_LIST_CAP),
    truncated: found.length > ZERO_PRICE_LIST_CAP,
  };
}

/** Một dòng log có cấu trúc (JSON sau tiền tố) cho một lượt có SKU 0đ; chữ đầu dòng cho người đọc, JSON cho máy lọc. */
export function zeroPriceLogLine(s: ZeroPriceSummary): string {
  const shown = s.skus.slice(0, ZERO_PRICE_LOG_CAP);
  const payload = {
    event: 'pancake.zeroPriceAnomalies',
    scope: s.scope,
    count: s.count,
    keptCount: s.keptCount,
    newCount: s.newCount,
    skus: shown.map((a) => ({ sku: a.sku, pancakeId: a.pancakeId, kind: a.kind, keptPrice: a.keptPrice })),
    ...(s.count > shown.length ? { more: s.count - shown.length } : {}),
  };
  return (
    `Pancake báo giá 0đ ở ${s.count} biến thể (${s.keptCount} đã giữ giá cũ, ${s.newCount} chưa có giá nên chưa mở bán) — ` +
    `sửa giá trên Pancake POS. ${JSON.stringify(payload)}`
  );
}

const isAnomaly = (x: unknown): x is ZeroPriceAnomaly =>
  typeof x === 'object' && x !== null && typeof (x as ZeroPriceAnomaly).pancakeId === 'string' && typeof (x as ZeroPriceAnomaly).sku === 'string';

/** Đọc hàng đã lưu một cách phòng thủ (cột Json): sai dạng thì coi như chưa có danh sách. */
export function parseZeroPrice(detail: unknown): ZeroPriceSummary | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const d = detail as Partial<ZeroPriceSummary>;
  if (!Array.isArray(d.skus)) return null;
  const skus = d.skus.filter(isAnomaly);
  const at = typeof d.updatedAt === 'string' ? new Date(d.updatedAt) : new Date(0);
  const summary = summarizeZeroPrice(skus, d.scope === 'FULL' ? 'FULL' : 'INCREMENTAL', Number.isNaN(at.getTime()) ? new Date(0) : at);
  // `count` đã lưu có thể lớn hơn số SKU lưu được (đã cắt ở trần): giữ số thật thay vì đếm lại danh sách bị cắt.
  return typeof d.count === 'number' && d.count > skus.length
    ? { ...summary, count: d.count, keptCount: typeof d.keptCount === 'number' ? d.keptCount : summary.keptCount, newCount: typeof d.newCount === 'number' ? d.newCount : summary.newCount, truncated: true }
    : summary;
}

type OpsStore = Pick<PrismaClient, 'opsHealthState'>;

const sameList = (a: readonly ZeroPriceAnomaly[], b: readonly ZeroPriceAnomaly[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Lưu danh sách SKU 0đ cho admin.
 * - Lượt quét TOÀN BỘ chạy trọn (`replace`): danh sách thay hẳn, kể cả rỗng (SKU đã sửa trên Pancake biến mất).
 * - Lượt tăng dần (15 phút, chỉ thấy sản phẩm vừa đổi) hoặc lượt có sản phẩm lỗi: gộp vào danh sách đang lưu — thêm SKU mới thấy,
 *   gỡ SKU lượt này đọc được mà hết 0đ; không có gì đổi thì không ghi. SKU đã sửa nhưng chưa được lượt tăng dần nào chạm tới
 *   sẽ được gỡ ở lượt quét toàn bộ kế tiếp (đêm).
 * - `present`: lượt quét toàn bộ trọn vẹn nhưng có sản phẩm lỗi/nháp, nên không thay hẳn được. Tập mọi mã biến thể Pancake lượt này THẤY (kể cả của sản phẩm
 *   lỗi): mục đã lưu mà mã không còn trong tập là biến thể đã biến khỏi Pancake, được gỡ; mục của sản phẩm lỗi (chưa đọc được) vẫn còn.
 */
export async function recordZeroPrice(
  prisma: OpsStore,
  run: { replace: boolean; found: readonly ZeroPriceAnomaly[]; resolved: ReadonlySet<string>; present?: ReadonlySet<string> },
  now = new Date(),
): Promise<ZeroPriceSummary | null> {
  let next: ZeroPriceSummary;
  if (run.replace) {
    next = summarizeZeroPrice(run.found, 'FULL', now);
  } else {
    if (run.found.length === 0 && run.resolved.size === 0 && !run.present) return null;
    const row = await prisma.opsHealthState.findUnique({ where: { key: ZERO_PRICE_STATE_KEY } });
    const prev = parseZeroPrice(row?.detail);
    // Danh sách đã bị cắt ở trần: gộp từ phần còn lưu sẽ làm mất số đếm thật của phần bị cắt, nên chờ lượt quét toàn bộ.
    if (prev?.truncated) return prev;
    const foundIds = new Set(run.found.map((a) => a.pancakeId));
    const kept = (prev?.skus ?? []).filter((a) => !run.resolved.has(a.pancakeId) && !foundIds.has(a.pancakeId) && (!run.present || run.present.has(a.pancakeId)));
    const merged = [...kept, ...run.found];
    if (!prev && merged.length === 0) return null;
    if (prev && sameList(prev.skus, merged)) return prev;
    next = summarizeZeroPrice(merged, prev?.scope ?? 'INCREMENTAL', now);
  }
  const data = { lastOkAt: now, detail: next as unknown as object };
  await prisma.opsHealthState.upsert({ where: { key: ZERO_PRICE_STATE_KEY }, create: { key: ZERO_PRICE_STATE_KEY, ...data }, update: data });
  return next;
}

export async function readZeroPrice(prisma: OpsStore): Promise<ZeroPriceSummary> {
  const row = await prisma.opsHealthState.findUnique({ where: { key: ZERO_PRICE_STATE_KEY } });
  return parseZeroPrice(row?.detail) ?? summarizeZeroPrice([], 'FULL', new Date(0));
}
