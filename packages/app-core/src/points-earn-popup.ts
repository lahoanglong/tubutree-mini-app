import { multiplierLabel } from './number-format';
import type { TierEarn } from './points-earn-tier';

export const POINTS_EARN_POPUP = {
  title: 'Cách tính Điểm Xanh',
  rowAria: 'Xem cách tính Điểm Xanh',
  tierHeading: 'Hạng của bạn',
  tilde: 'Dấu "~" vì giảm giá, mã giảm giá và điểm dùng lúc thanh toán làm giá trị hàng tính điểm thấp đi, nên số thực nhận có thể thấp hơn một chút.',
  /** Cùng chữ với dòng Điểm Xanh nói chung ở PDP (vi.product.pointsEarnGeneric, pointsEarnText.generic). */
  delivered: 'Nhận Điểm Xanh khi đơn giao thành công',
  ranksLink: 'Xem các hạng Điểm Xanh',
  marketplaceLink: 'Gửi đơn sàn để tích điểm',
} as const;

export interface PointsEarnPopup {
  title: string;
  tier: string;
  tilde: string;
  delivered: string;
  /** Câu đơn sàn; null khi cờ tích đơn sàn tắt (không có so sánh để nói) hoặc nền tảng không có trang gửi đơn sàn. */
  marketplace: string | null;
}

export function pointsEarnPopup(input: { tier: TierEarn | null; guest: boolean; marketplace: string | null }): PointsEarnPopup {
  const { tier, guest } = input;
  let line: string;
  if (guest) line = `Chưa đăng nhập: hệ số ${multiplierLabel(1)}. Đăng nhập để được nhân theo hạng.`;
  else if (!tier) line = 'Điểm được nhân theo hạng thành viên của bạn.';
  else if (!tier.tierName) line = `Bạn chưa có hạng: hệ số ${multiplierLabel(tier.multiplier)}.`;
  else line = `Hạng ${tier.tierName}: ${multiplierLabel(tier.multiplier)}`;
  return { title: POINTS_EARN_POPUP.title, tier: line, tilde: POINTS_EARN_POPUP.tilde, delivered: POINTS_EARN_POPUP.delivered, marketplace: input.marketplace };
}
