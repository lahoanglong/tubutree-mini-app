import type { PointsLot, Prisma } from '@prisma/client';
import { POINTS_LOT_BALANCE_COLUMN } from './points-lot-columns';

export interface PointsDeltaInput {
  userId: string;
  /** Điểm có dấu: dương = cộng vào lô, âm = trừ khỏi lô. Số nguyên khác 0. */
  delta: number;
  lot: PointsLot;
  reason: string;
  refType?: string | null;
  refId?: string | null;
  /** Lô STANDARD và MARKETPLACE có hạn. Lô CONVERTED luôn ghi NULL (truyền ngày → lỗi). */
  expiresAt?: Date | null;
  /**
   * Chỉ cho lệnh cộng: chèn dòng sổ bằng INSERT ... ON CONFLICT DO NOTHING. Dòng đã có (đụng partial
   * unique index của refType đó, vd *_converted_refund_unique) → không đổi số dư, trả applied:false.
   * Không dùng create rồi bắt P2002: lỗi unique trong tx Postgres huỷ cả tx của caller (25P02).
   */
  skipDuplicates?: boolean;
}

export interface PointsDeltaResult {
  /** false = trừ không đủ số dư của lô, hoặc dòng sổ đã có (skipDuplicates) → không ghi gì. */
  applied: boolean;
  entryId: string | null;
}

/**
 * Ghi một biến động Điểm Xanh vào ĐÚNG lô (PD-3): đổi cột số dư của lô (POINTS_LOT_BALANCE_COLUMN: `pointsBalance` cho STANDARD,
 * `pointsConvertedBalance` cho CONVERTED, `pointsMarketplaceBalance` cho MARKETPLACE) và ghi 1 dòng points_transactions mang `lot`
 * trong tx của caller, giữ bất biến số dư == SUM(delta) theo từng lô (points-reconcile.ts).
 *
 * Lệnh trừ dùng guard `gte` trên cột của lô: không đủ thì không ghi gì và trả applied:false để caller
 * quyết định (400 / rollback). Không bao giờ lấy điểm lô này bù cho lô kia; thứ tự tiêu nhiều lô là
 * việc của caller.
 *
 * Lỗi tham số là lỗi lập trình (ném Error → 500), không phải lỗi khách.
 */
export async function applyPointsDelta(tx: Prisma.TransactionClient, input: PointsDeltaInput): Promise<PointsDeltaResult> {
  const { userId, delta, lot, reason } = input;
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new Error(`applyPointsDelta: delta không hợp lệ (${delta})`);
  }
  if (lot === 'CONVERTED' && input.expiresAt) {
    throw new Error('applyPointsDelta: lô CONVERTED không hết hạn, expiresAt phải để trống');
  }
  // Điểm sàn không có hạn thì cron hết hạn không bao giờ trừ: lệnh cộng lô này luôn phải mang hạn.
  if (lot === 'MARKETPLACE' && delta > 0 && !input.expiresAt) {
    throw new Error('applyPointsDelta: lệnh cộng lô MARKETPLACE phải có expiresAt');
  }
  if (input.skipDuplicates && delta < 0) {
    throw new Error('applyPointsDelta: skipDuplicates chỉ dùng cho lệnh cộng');
  }

  const column = POINTS_LOT_BALANCE_COLUMN[lot];
  const data = {
    userId,
    delta,
    lot,
    reason,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    expiresAt: lot === 'CONVERTED' ? null : (input.expiresAt ?? null),
  };

  if (delta > 0) {
    let entryId: string;
    if (input.skipDuplicates) {
      const rows = await tx.pointsTransaction.createManyAndReturn({ data: [data], skipDuplicates: true, select: { id: true } });
      if (rows.length === 0) return { applied: false, entryId: null };
      entryId = rows[0]!.id;
    } else {
      entryId = (await tx.pointsTransaction.create({ data, select: { id: true } })).id;
    }
    await tx.user.update({ where: { id: userId }, data: { [column]: { increment: delta } } });
    return { applied: true, entryId };
  }

  const amount = -delta;
  const res = await tx.user.updateMany({ where: { id: userId, [column]: { gte: amount } }, data: { [column]: { decrement: amount } } });
  if (res.count === 0) return { applied: false, entryId: null };
  const entry = await tx.pointsTransaction.create({ data, select: { id: true } });
  return { applied: true, entryId: entry.id };
}
