import { fillTemplate } from '../copy-template';

/**
 * Chữ của thẻ thành tích xanh (cờ `growth.referral_viral_enabled`), dùng chung Mini App và web. Tách khỏi `shop-copy.ts` như chữ Sổ tay
 * Xanh (`game-album/copy.ts`): chữ chỉ nạp cùng chunk lười của thẻ, không vào gói khởi động của mọi trang.
 */
export const GREEN_CARD_COPY = {
  title: 'Thành tích xanh',
  cards: '{n} thẻ xanh đã mở',
  waste: '{n} vỏ đã đổi',
  reward: 'Bạn bè mua đơn đầu từ {min}, cả hai nhận +{points} Điểm Xanh',
  rewardNoMin: 'Bạn bè mua đơn đầu, cả hai nhận +{points} Điểm Xanh',
  invitePlain: 'Gửi link mời để bạn bè sống xanh cùng bạn',
  copy: 'Sao chép link',
  // Thẻ chia sẻ ở khối Mời bạn (`share-card.ts`): lời mời, câu gửi kèm link và nhãn ô số.
  shareTitle: 'Tặng bạn trải nghiệm thuần khiết',
  shareOffer: 'Nhận +{points} Điểm Xanh khi bạn đặt đơn đầu từ {min}',
  shareOfferNoMin: 'Nhận +{points} Điểm Xanh khi bạn đặt đơn đầu',
  shareMessage: 'Tặng bạn trải nghiệm thuần khiết — nhận +{points} Điểm Xanh khi bạn đặt đơn đầu từ {min}',
  shareMessageNoMin: 'Tặng bạn trải nghiệm thuần khiết — nhận +{points} Điểm Xanh khi bạn đặt đơn đầu',
  statInvited: 'Bạn bè đã mời',
  statSucceeded: 'Bạn mời thành công',
  statPoints: 'Điểm Xanh đã nhận',
} as const;

export type GreenCardCopyKey = keyof typeof GREEN_CARD_COPY;

/** Trần độ dài sau khi điền số (tiêu đề, nút, dòng một hàng ở khổ 360). */
export const GREEN_CARD_COPY_MAX: Record<GreenCardCopyKey, number> = {
  title: 20,
  cards: 24,
  waste: 18,
  reward: 60,
  rewardNoMin: 52,
  invitePlain: 44,
  copy: 14,
  shareTitle: 34,
  shareOffer: 60,
  shareOfferNoMin: 48,
  shareMessage: 100,
  shareMessageNoMin: 84,
  statInvited: 16,
  statSucceeded: 20,
  statPoints: 20,
};

export function greenCardCopy(key: GreenCardCopyKey, vars: Record<string, string | number> = {}): string {
  return fillTemplate(GREEN_CARD_COPY[key], vars, key);
}
