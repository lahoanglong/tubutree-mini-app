import type { RewardCatalogDTO, RewardItemDTO, WasteOpeningHours, WastePointContactDTO } from '@tubutree/shared-types';

export const REWARD_TABS = [
  { key: 'coupon', label: 'Mã giảm giá', kinds: ['VOUCHER'] },
  { key: 'tree', label: 'Cây và hạt', kinds: ['TREE', 'SEED_PACK'] },
  { key: 'gift', label: 'Quà nhỏ', kinds: ['GIFT'] },
] as const;

const WEEKDAYS = [
  ['MON', 'T2'],
  ['TUE', 'T3'],
  ['WED', 'T4'],
  ['THU', 'T5'],
  ['FRI', 'T6'],
  ['SAT', 'T7'],
  ['SUN', 'CN'],
] as const;

export function openingHoursText(h: WasteOpeningHours): string {
  return WEEKDAYS.flatMap(([day, label]) => {
    const slots = h[day];
    return slots && slots.length > 0 ? [`${label} ${slots.map((s) => `${s.open}–${s.close}`).join(', ')}`] : [];
  }).join(' · ');
}

type PointAddress = Pick<WastePointContactDTO, 'addressLine' | 'communeName' | 'provinceName'>;

export function pointAddress(p: PointAddress): string {
  return `${p.addressLine}, ${p.communeName}, ${p.provinceName}`;
}

const formatNumber = (n: number): string => ((Number.isFinite(n) ? n : 0) + 0).toLocaleString('vi-VN');

/** dd/mm/yyyy theo giờ Việt Nam (UTC+7) — cùng quy ước với thông báo lỗi của backend. */
function vnDate(iso: string): string {
  const v = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
}

export interface LockedPointsSource {
  pointsBalance: number;
  lockedPoints?: number;
  lockedReturnPoints?: number;
  lockedUntil?: string | null;
  redeemablePoints?: number;
}

/**
 * Giải thích vì sao 1 phần Điểm Xanh chưa đổi quà được (backend redeemReward chặn điểm của đơn còn
 * có thể bị trả hàng). null = không có điểm khoá / API cũ.
 */
export function lockedPointsNote(ov: LockedPointsSource): string | null {
  const locked = ov.lockedPoints ?? 0;
  if (locked <= 0) return null;
  const ret = ov.lockedReturnPoints ?? 0;
  const inWindow = locked - ret;
  const parts: string[] = [];
  if (inWindow > 0 && ov.lockedUntil) {
    parts.push(`${formatNumber(inWindow)} điểm từ đơn mới giao sẽ dùng được sau ngày ${vnDate(ov.lockedUntil)} (hết hạn đổi/trả hàng)`);
  }
  if (ret > 0) parts.push(`${formatNumber(ret)} điểm từ đơn đang chờ xử lý đổi/trả sẽ dùng được khi yêu cầu được xử lý xong`);
  if (parts.length === 0) parts.push(`${formatNumber(locked)} điểm từ đơn mới giao chưa dùng được`);
  const usable = ov.redeemablePoints ?? Math.max(0, ov.pointsBalance - locked);
  return `Đổi quà dùng được ${formatNumber(usable)} điểm: ${parts.join('; ')}.`;
}

export type RewardCardState =
  | { kind: 'redeem' }
  | { kind: 'soldOut' }
  | { kind: 'locked' }
  | { kind: 'need'; missing: number };

/**
 * Trạng thái thẻ quà theo số máy chủ trả. Quà TREE đi qua `buyTree` nên tiêu cả hai lô; "Cần thêm" của nó phải tính
 * cùng tổng với `canRedeem`. Hết hàng đứng trước nên thẻ hết không bao giờ hiện "Cần thêm".
 */
export function rewardCardState(
  r: Pick<RewardItemDTO, 'kind' | 'pointsCost' | 'canRedeem' | 'soldOut'>,
  c: Pick<RewardCatalogDTO, 'redeemablePoints' | 'pointsConvertedBalance'>,
): RewardCardState {
  if (r.soldOut) return { kind: 'soldOut' };
  if (r.canRedeem) return { kind: 'redeem' };
  const spendable = r.kind === 'TREE' ? c.redeemablePoints + c.pointsConvertedBalance : c.redeemablePoints;
  const missing = r.pointsCost - spendable;
  return missing > 0 ? { kind: 'need', missing } : { kind: 'locked' };
}
