import type { Prisma } from '@prisma/client';
import { applyPancakeStock, type StockExecutor } from '../../catalog/variation-stock';
import type { CatalogSyncStockLine } from './catalog-sync-body';

/** Số đọc trước lúc ký quá chừng này thì bỏ: lượt đồng bộ Pancake 15 phút của Tubu đã có số mới hơn. */
export const MSS_STOCK_MAX_AGE_MS = 60 * 60_000;
/** `as_of` muộn hơn lúc ký quá chừng này: hai mốc không cùng một đồng hồ (MSS ghi sai), bỏ. */
export const MSS_STOCK_MAX_SKEW_MS = 5_000;
/** Bù đường truyền từ lúc MSS ký tới lúc Tubu nhận: mốc đọc lùi thêm chừng này để số MSS chỉ thắng số Tubu đã có khi chắc chắn mới hơn. */
export const MSS_STOCK_TRANSIT_MS = 2_000;

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
 * đọc sau thì thắng.
 *
 * Mốc đọc không lấy thẳng `as_of` (giờ MSS) để so với mốc webhook/đồng bộ (giờ Tubu): đồng hồ MSS nhanh vài phút sẽ cho số cũ đè số mới.
 * Thay vào đó lấy tuổi của số trên chính đồng hồ MSS (`signedAt − as_of`), rồi đặt mốc đọc = giờ Tubu nhận − tuổi − bù đường truyền.
 * Mốc này không muộn hơn lúc đọc thật (tính theo giờ Tubu) trừ khi đường truyền quá bù, nên số MSS chỉ thua khi sát nút chứ không
 * thắng sai. Gửi lại (MSS ký lại) cho cùng mốc đọc, nên không đè số Tubu nhận sau lần gửi đầu.
 *
 * `wentOut`/`backIn` so tồn đọc trước và sau lô, chỉ dùng cho việc không đổi dữ liệu (xoá bộ đệm, gọi sớm lượt báo hàng về): một đơn
 * chen giữa làm lệch thì lượt cron mỗi phút vẫn bắt đúng.
 */
export async function applyMssStock(
  db: MssStockDb,
  lines: readonly CatalogSyncStockLine[],
  clock: { signedAt: Date; now: Date },
): Promise<MssStockResult> {
  const out: MssStockResult = { received: lines.length, applied: 0, skipped: {}, wentOut: [], backIn: [] };
  const skip = (k: MssStockSkip) => {
    out.skipped[k] = (out.skipped[k] ?? 0) + 1;
  };
  const fresh: Array<{ line: CatalogSyncStockLine; readAt: Date }> = [];
  for (const line of lines) {
    const age = clock.signedAt.getTime() - line.asOf.getTime();
    if (age < -MSS_STOCK_MAX_SKEW_MS) skip('clock_skew');
    else if (age > MSS_STOCK_MAX_AGE_MS) skip('too_old');
    else fresh.push({ line, readAt: new Date(clock.now.getTime() - Math.max(0, age) - MSS_STOCK_TRANSIT_MS) });
  }
  if (fresh.length === 0) return out;

  const before = await db.variation.findMany({
    where: { pancakeId: { in: fresh.map((f) => f.line.pancakeVariationId) } },
    select: { id: true, pancakeId: true, stock: true },
  });
  const known = new Set(before.map((v) => v.pancakeId));
  for (const { line, readAt } of fresh) {
    if (!known.has(line.pancakeVariationId)) {
      skip('unknown_variation');
      continue;
    }
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
