import type { LoyaltyPreviewDTO, RewardCatalogDTO } from '@tubutree/shared-types';

/** Chữ của màn xem trước dành cho khách chưa đăng nhập (Kho quà, Điểm Xanh); Mini App và web dùng chung. */
export const guestPreviewCopy = {
  loginCta: 'Đăng nhập để đổi',
  hint: 'Đăng nhập để đổi Điểm Xanh lấy quà và xem hạng của bạn.',
  rewardsTitle: 'Quà đổi bằng Điểm Xanh',
  tiersTitle: 'Hạng thành viên',
  loadError: 'Chưa tải được danh sách quà',
} as const;

type PreviewTier = LoyaltyPreviewDTO['tiers'][number];

/**
 * Điều kiện lên hạng, một dòng, đúng luật xét hạng của máy chủ: hạng có `minSpending` CHỈ xét tiền mua trong 12 tháng
 * (mốc điểm không còn dùng); chỉ hạng không có mốc chi tiêu mới xét điểm tích luỹ.
 */
export function tierRequirementText(t: PreviewTier, formatPoints: (n: number) => string, formatMoney: (n: number) => string): string {
  if (t.minPoints <= 0 && !t.minSpending) return 'Hạng khởi đầu';
  if (t.minSpending) return `Chi tiêu từ ${formatMoney(t.minSpending)} trong 12 tháng`;
  return `Từ ${formatPoints(t.minPoints)} tích luỹ`;
}

/** Khách chưa đăng nhập không có điểm: dựng danh mục rỗng điểm để dùng lại thẻ quà, thẻ chỉ hiện giá. */
export function previewAsCatalog(p: LoyaltyPreviewDTO): RewardCatalogDTO {
  return {
    pointsBalance: 0,
    pointsConvertedBalance: 0,
    lockedPoints: 0,
    redeemablePoints: 0,
    giftClaimDays: p.giftClaimDays,
    claimPoint: p.claimPoint,
    rewards: p.rewards,
    tierFreeShip: null,
  };
}
