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

type TierFreeShip = NonNullable<RewardCatalogDTO['tierFreeShip']>;

/**
 * Quà "miễn phí giao hàng" mà hạng của khách đã có sẵn quyền lợi bằng hoặc tốt hơn: ngưỡng freeship của hạng không cao hơn
 * ngưỡng của mã (mã không đặt đơn tối thiểu = freeship mọi đơn). Đổi quà này chỉ mất điểm mà không được thêm gì.
 */
export function freeShipCovered(r: Pick<RewardItemDTO, 'kind' | 'voucher'>, tier: TierFreeShip | null | undefined): boolean {
  if (!tier || r.kind !== 'VOUCHER' || r.voucher?.type !== 'FREESHIP') return false;
  return tier.freeFrom <= (r.voucher.minOrder ?? 0);
}

/**
 * Ghi chú trên quà freeship thừa với hạng. KHÔNG khoá nút Đổi: ngưỡng của mã tính cả hàng đối tác, còn ngưỡng của hạng chỉ
 * tính kiện hàng Tubu, nên mã vẫn có thể có ích; vì vậy ghi rõ ngưỡng hạng áp cho đơn Tubu.
 */
export const freeShipCoveredNote = (tierName: string, freeFrom: number, formatMoney: (n: number) => string): string =>
  `Hạng ${tierName} đã được miễn phí giao hàng cho ${freeFrom > 0 ? `đơn Tubu từ ${formatMoney(freeFrom)}` : 'mọi đơn Tubu'}`;

/** Ghi chú của một quà (null khi quà không thừa với hạng). */
export function rewardFreeShipNote(
  r: Pick<RewardItemDTO, 'kind' | 'voucher'>,
  c: Partial<Pick<RewardCatalogDTO, 'tierFreeShip'>>,
  formatMoney: (n: number) => string,
): string | null {
  const t = c.tierFreeShip;
  return t && freeShipCovered(r, t) ? freeShipCoveredNote(t.tierName, t.freeFrom, formatMoney) : null;
}

/** Dòng nhắc ở hộp xác nhận đổi quà freeship thừa với hạng: chỉ cảnh báo, không khoá nút Đổi. */
export const freeShipConfirmText = (note: string): string => `${note}. Bạn vẫn muốn đổi mã này?`;

/**
 * Thứ tự hiển thị trong một mục: quà đổi được (đủ điểm, còn hàng) lên trước, quà chưa đủ điểm hoặc đã hết xuống sau; trong từng
 * nhóm quà đã có sẵn quyền lợi hạng xuống cuối, rồi theo sortOrder. Không ẩn hay khoá quà nào.
 */
export function orderRewards<T extends Pick<RewardItemDTO, 'kind' | 'voucher' | 'sortOrder' | 'canRedeem' | 'soldOut'>>(rewards: readonly T[], c: Pick<RewardCatalogDTO, 'tierFreeShip'>): T[] {
  const group = (r: T) => (r.canRedeem && !r.soldOut ? 0 : 1);
  const covered = (r: T) => (freeShipCovered(r, c.tierFreeShip) ? 1 : 0);
  return [...rewards].sort((a, b) => group(a) - group(b) || covered(a) - covered(b) || a.sortOrder - b.sortOrder);
}

export type RewardCardState =
  | { kind: 'redeem' }
  | { kind: 'soldOut' }
  | { kind: 'needPhoneVerify' }
  | { kind: 'locked' }
  | { kind: 'need'; missing: number };

/**
 * Trạng thái thẻ quà theo số máy chủ trả. Quà TREE đi qua `buyTree` nên tiêu cả hai lô; "Cần thêm" của nó phải tính
 * cùng tổng với `canRedeem`. Hết hàng đứng trước nên thẻ hết không bao giờ hiện "Cần thêm".
 * W179-C: quà vật lý (`SEED_PACK`, `GIFT`) khi `phoneVerified === false` trả `{ kind: 'needPhoneVerify' }` để khoá nút Đổi
 * mà không lặp lại nút xác minh trên từng thẻ (đã có đúng 1 thẻ thông báo ở đầu danh sách).
 */
export function rewardCardState(
  r: Pick<RewardItemDTO, 'kind' | 'pointsCost' | 'canRedeem' | 'soldOut'>,
  c: Pick<RewardCatalogDTO, 'redeemablePoints' | 'pointsConvertedBalance'> & { phoneVerified?: boolean },
): RewardCardState {
  if (r.soldOut) return { kind: 'soldOut' };
  if (r.canRedeem) return { kind: 'redeem' };
  if (c.phoneVerified === false && isWarehousePickup(r)) return { kind: 'needPhoneVerify' };
  const spendable = r.kind === 'TREE' ? c.redeemablePoints + c.pointsConvertedBalance : c.redeemablePoints;
  const missing = r.pointsCost - spendable;
  return missing > 0 ? { kind: 'need', missing } : { kind: 'locked' };
}

/** W179-C: chữ của thẻ thông báo xác minh SĐT duy nhất ở đầu danh sách quà hiện vật. */
export const rewardPhoneVerifyCopy = {
  notice: 'Xác minh số điện thoại qua Zalo để đổi quà hiện vật',
  miniCta: 'Xác minh số điện thoại',
  webCta: 'Mở Zalo Mini App để xác minh',
} as const;

/**
 * Quà hiện vật: hạt giống và quà nhỏ không giao riêng. Mặc định tự thêm 0đ vào đơn mua kế tiếp của khách; khách vẫn có thể đọc mã QG-
 * tại kho TP.HCM (API không có cờ riêng cho việc này, đây là đúng quy tắc mà sheet "Đổi quà thành công" vẫn dùng: mọi quà không phải
 * mã giảm giá hay cây góp quỹ). Tên hàm và các hằng WAREHOUSE_* giữ nguyên vì hai app đang import.
 */
export function isWarehousePickup(r: Pick<RewardItemDTO, 'kind'>): boolean {
  return r.kind === 'SEED_PACK' || r.kind === 'GIFT';
}

export const WAREHOUSE_ONLY_LABEL = 'Tự động gửi kèm đơn hàng kế tiếp (0đ) hoặc nhận tại kho';

type PickupPoint = Pick<NonNullable<RewardCatalogDTO['claimPoint']>, 'name' | 'addressLine' | 'communeName' | 'provinceName'>;

/**
 * Câu hỏi lại ở bước xác nhận đổi: nói rõ quà tự thêm vào đơn kế tiếp, hoặc nhận tại kho. Có điểm nhận thì hộp xác nhận đã in tên, địa chỉ, giờ mở của kho
 * ngay dưới câu này (cả Mini lẫn web), nên câu chỉ trỏ xuống đó thay vì in lại; không có thì câu tự nêu kho mặc định.
 */
export function warehouseConfirmText(point: PickupPoint | null | undefined): string {
  const where = point ? 'tại kho (địa chỉ ở dưới)' : 'tại kho: kho Tubu TP.HCM';
  return `Quà này sẽ tự động thêm (0đ) vào đơn mua hàng kế tiếp của bạn, hoặc bạn nhận ${where}. Bạn vẫn muốn đổi?`;
}

export const WAREHOUSE_PICKUP_DONE = 'Quà đã lưu vào Ví quà — sẽ tự động thêm (0đ) vào đơn mua hàng kế tiếp của bạn (hoặc đọc mã QG-… khi ghé kho Tubu)';

/** Dòng nhắc dưới mã QG- của quà đang chờ nhận trong Quà của tôi. */
export const GIFT_ATTACH_HINT = 'Tự động thêm (0đ) vào đơn mua hàng kế tiếp của bạn, hoặc đọc mã này khi ghé kho Tubu';

/** Đầu Kho quà gọn: luật nằm sau nút "Thể lệ"; số dư 0 thì có thẻ chỉ cách kiếm điểm thay vì cả loạt "Cần thêm…". */
export const rewardsGuideCopy = {
  rulesButton: 'Thể lệ',
  rulesTitle: 'Thể lệ đổi quà',
  earnTitle: 'Cách kiếm Điểm Xanh',
  earnItems: [
    'Mua hàng: điểm cộng sau khi đơn giao thành công',
    'Điểm danh mỗi ngày ở tab Ưu đãi (tài khoản đăng nhập Zalo)',
    'Chăm cây và làm nhiệm vụ ở Vườn Xanh (tài khoản đăng nhập Zalo)',
  ],
  earnCta: 'Xem cách kiếm điểm',
} as const;

/** Tham số `?new=<mã>` khi "Xem ví mã" mở Quà của tôi: mã vừa đổi được làm nổi lên đầu và có nhãn "Mới". */
export const NEW_COUPON_PARAM = 'new';
export const NEW_COUPON_BADGE = 'Mới';

/** Chờ nhận trước, mã vừa đổi lên đầu nhóm còn lại, rồi mới nhất trước. */
export function sortRedemptions<T extends { status: string; createdAt: string; couponCode?: string | null }>(list: readonly T[], newCode?: string | null): T[] {
  const rank = (r: T) => (r.status === 'READY' ? 0 : newCode && r.couponCode === newCode ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}
