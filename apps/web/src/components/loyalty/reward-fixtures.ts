import type { GiftRedemptionDTO, RewardCatalogDTO, RewardItemDTO } from '@tubutree/shared-types';

/** Dữ liệu mẫu cho spec Kho quà; cùng số liệu với `waste-test-fixtures` của Mini App. */
export function makeRewardItem(over: Partial<RewardItemDTO> = {}): RewardItemDTO {
  return {
    id: 'reward-freeship',
    kind: 'VOUCHER',
    name: 'Miễn phí vận chuyển',
    description: 'Đơn từ 99.000đ',
    label: null,
    pointsCost: 20_000,
    imageUrl: null,
    stockRemaining: null,
    soldOut: false,
    canRedeem: true,
    claimInstructions: null,
    voucher: { type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, validDays: 30 },
    sortOrder: 1,
    ...over,
  };
}

export function makeRewardCatalog(over: Partial<RewardCatalogDTO> = {}): RewardCatalogDTO {
  return {
    pointsBalance: 30_000,
    pointsConvertedBalance: 5000,
    lockedPoints: 0,
    redeemablePoints: 30_000,
    giftClaimDays: 60,
    claimPoint: {
      name: 'Kho Tubu TP.HCM',
      addressLine: '99 Nguyễn Văn Linh',
      communeName: 'Phường Tân Phong',
      provinceName: 'TP.HCM',
      openingHours: { MON: [{ open: '08:00', close: '17:00' }] },
    },
    rewards: [
      makeRewardItem(),
      makeRewardItem({
        id: 'reward-discount-50k',
        name: 'Giảm 50.000đ',
        description: 'Đơn từ 300.000đ',
        pointsCost: 50_000,
        canRedeem: false,
        voucher: { type: 'AMOUNT', value: 50000, minOrder: 300000, maxDiscount: null, validDays: 30 },
        sortOrder: 2,
      }),
      makeRewardItem({
        id: 'gift-tree',
        kind: 'TREE',
        name: 'Góp quỹ trồng cây',
        description: 'Góp một cây vào quỹ trồng cây của Tubu',
        pointsCost: 50_000,
        canRedeem: false,
        voucher: null,
        sortOrder: 3,
      }),
      makeRewardItem({
        id: 'gift-seed',
        kind: 'SEED_PACK',
        name: 'Gói hạt giống Tubu',
        description: 'Hạt rau mầm',
        pointsCost: 25_000,
        stockRemaining: 3,
        claimInstructions: 'Nhận tại kho Tubu TP.HCM',
        voucher: null,
        sortOrder: 4,
      }),
      makeRewardItem({
        id: 'gift-bag',
        kind: 'GIFT',
        name: 'Túi vải Tubu',
        description: 'Túi vải canvas',
        pointsCost: 40_000,
        stockRemaining: 0,
        soldOut: true,
        canRedeem: false,
        claimInstructions: 'Nhận tại kho Tubu TP.HCM',
        voucher: null,
        sortOrder: 5,
      }),
    ],
    ...over,
  };
}

export function makeGiftRedemption(over: Partial<GiftRedemptionDTO> = {}): GiftRedemptionDTO {
  return {
    id: 'red-1',
    giftId: 'gift-seed',
    giftKind: 'SEED_PACK',
    giftName: 'Gói hạt giống Tubu',
    pointsCost: 25_000,
    status: 'READY',
    code: 'QG-8K2M9P4T',
    claimExpiresAt: '2026-12-16T17:30:00.000Z',
    claimPoint: makeRewardCatalog().claimPoint,
    fulfilledAt: null,
    cancelledAt: null,
    cancelReason: null,
    refundedPoints: null,
    couponCode: null,
    createdAt: '2026-10-17T03:00:00.000Z',
    ...over,
  };
}
