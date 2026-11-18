import type { Prisma } from '@prisma/client';
import { applyPancakeStock, type StockExecutor } from '../../catalog/variation-stock';
import type { CatalogSyncStockLine } from './catalog-sync-body';

/** Số đọc cũ hơn chừng này so với lúc nhận thì bỏ: lượt đồng bộ Pancake 15 phút của Tubu đã có số mới hơn. */
export const MSS_STOCK_MAX_AGE_MS = 60 * 60_000;
/** Giờ đọc vượt giờ Tubu quá chừng này là đồng hồ MSS sai: bỏ, vì ghi mốc đọc ở tương lai sẽ chặn đồng bộ Pancake của Tubu tới mốc đó. */
export const MSS_STOCK_MAX_SKEW_MS = 5 * 60_000;

export type MssStockSkip = 'unknown_variation' | 'stale' | 'too_old' | 'clock_skew';

export interface MssStockResult {
  received: number;
  applied: number;
  skipped: Partial<Record<MssStockSkip, number>>;
  /** Id biến thể Tubu vừa từ còn hàng thành hết hàng (so tồn đọc trước và sau lô). */
  wentOut: string[];
  /** Id biến thể Tubu vừa từ hết hàng thành còn hàng. */
  backIn: string[];
}

export type MssStockDb = StockExecutor & { variation: Pick<Prisma.TransactionClient['variation'], 'findMany'> };

/**
 * Áp tồn Pancake do MSS đẩy sang. Mỗi dòng là một lần MSS ĐỌC Pancake lúc `as_of`, nên đi đúng đường của lượt đồng bộ Pancake của
 * chính Tubu (`applyPancakeStock` kiểu `sync`, mốc đọc = `as_of`): trừ giữ chỗ của đơn Tubu chưa phản ánh, và điều kiện so mốc nằm
 * trong cùng câu UPDATE nên số MSS đọc trước một lượt đồng bộ/webhook Pancake đã áp không ghi đè số mới hơn (tồn không lùi), số MSS
 * đọc sau thì thắng. Gửi lại cùng dòng không đổi gì (cùng số tuyệt đối, cùng mốc). `as_of` muộn hơn giờ nhận vài giây (đồng hồ MSS
 * chạy nhanh) được kẹp về giờ nhận.
 *
 * `wentOut`/`backIn` so tồn đọc trước và sau lô, chỉ dùng cho việc không đổi dữ liệu (xoá bộ đệm, gọi sớm lượt báo hàng về): một đơn
 * chen giữa làm lệch thì lượt cron mỗi phút vẫn bắt đúng.
 */
export async function applyMssStock(db: MssStockDb, lines: readonly CatalogSyncStockLine[], now: Date): Promise<MssStockResult> {
  const out: MssStockResult = { received: lines.length, applied: 0, skipped: {}, wentOut: [], backIn: [] };
  const skip = (k: MssStockSkip) => {
    out.skipped[k] = (out.skipped[k] ?? 0) + 1;
  };
  const fresh: CatalogSyncStockLine[] = [];
  for (const line of lines) {
    const t = line.asOf.getTime();
    if (t > now.getTime() + MSS_STOCK_MAX_SKEW_MS) skip('clock_skew');
    else if (t < now.getTime() - MSS_STOCK_MAX_AGE_MS) skip('too_old');
    else fresh.push(line);
  }
  if (fresh.length === 0) return out;

  const before = await db.variation.findMany({
    where: { pancakeId: { in: fresh.map((l) => l.pancakeVariationId) } },
    select: { id: true, pancakeId: true, stock: true },
  });
  const known = new Set(before.map((v) => v.pancakeId));
  for (const line of fresh) {
    if (!known.has(line.pancakeVariationId)) {
      skip('unknown_variation');
      continue;
    }
    const readAt = new Date(Math.min(line.asOf.getTime(), now.getTime()));
    if (await applyPancakeStock(db, line.pancakeVariationId, line.stock, { kind: 'sync', readAt })) out.applied += 1;
    else skip('stale');
  }
  if (out.applied === 0) return out;

  const after = await db.variation.findMany({ where: { id: { in: before.map((v) => v.id) } }, select: { id: true, stock: true } });
  const stockBefore = new Map(before.map((v) => [v.id, v.stock]));
  for (const v of after) {
    const prev = stockBefore.get(v.id);
    if (prev === undefined) continue;
    if (prev > 0 && v.stock <= 0) out.wentOut.push(v.id);
    else if (prev <= 0 && v.stock > 0) out.backIn.push(v.id);
  }
  return out;
}
