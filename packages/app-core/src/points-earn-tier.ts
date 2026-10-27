import { multiplierLabel } from './number-format';

type TierTables = { tierMultipliers?: Record<string, number>; tierNames?: Record<string, string> };

export type TierEarn = { multiplier: number; tierName: string | null };

/**
 * Hệ số tích điểm của khách đăng nhập, từ bảng hạng trong config công khai.
 * `tierId === null` là tài khoản chưa có hạng: server tính hệ số 1 (getTierMultiplier). `undefined` (phiên cũ chưa có tierId) hoặc
 * hạng không có trong bảng (API cũ chưa trả bảng) thì null: chưa biết, UI nói chung thay vì đoán.
 */
export function tierEarnOf(loyalty: TierTables | undefined, tierId: string | null | undefined): TierEarn | null {
  if (tierId === null) return { multiplier: 1, tierName: null };
  if (!tierId) return null;
  const m = loyalty?.tierMultipliers?.[tierId];
  if (typeof m !== 'number' || !Number.isFinite(m) || m <= 0) return null;
  return { multiplier: m, tierName: loyalty?.tierNames?.[tierId] ?? null };
}

/** "hạng Lộc Biếc ×1,2"; null khi hệ số là 1 (người xem thấy số gốc, không cần giải thích) hoặc thiếu tên hạng. */
export function tierEarnNote(t: TierEarn | null): string | null {
  return t && t.multiplier !== 1 && t.tierName ? `hạng ${t.tierName} ${multiplierLabel(t.multiplier)}` : null;
}
