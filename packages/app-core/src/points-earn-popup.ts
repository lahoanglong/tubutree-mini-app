import { multiplierLabel } from './number-format';
import type { TierEarn } from './points-earn-tier';

export const POINTS_EARN_POPUP = {
  title: 'Cách tính Điểm Xanh',
  rowAria: 'Xem cách tính Điểm Xanh',
  tierHeading: 'Hạng của bạn',
  tilde: 'Dấu "~" vì giảm giá, mã giảm giá và điểm dùng lúc thanh toán làm giá trị hàng tính điểm thấp đi, nên số thực nhận có thể thấp hơn số này.',
  /** Cùng chữ với dòng Điểm Xanh nói chung ở PDP (vi.product.pointsEarnGeneric, pointsEarnText.generic). */
  delivered: 'Nhận Điểm Xanh khi đơn giao thành công',
  ranksLink: 'Xem các hạng Điểm Xanh',
  marketplaceLink: 'Gửi đơn sàn để tích điểm',
} as const;

export interface PointsEarnPopup {
  title: string;
  tier: string;
  /** null khi dòng đang ở dạng chung chung (không có "~" để giải thích). */
  tilde: string | null;
  /** null khi dòng đang ở dạng chung chung: dòng đã nói đúng câu này. */
  delivered: string | null;
  /** Câu đơn sàn; null khi cờ tích đơn sàn tắt (không có so sánh để nói). Việc có liên kết tới trang gửi đơn sàn do từng nền tảng quyết định. */
  marketplace: string | null;
}

export function pointsEarnPopup(input: { tier: TierEarn | null; guest: boolean; generic?: boolean; marketplace: string | null }): PointsEarnPopup {
  const { tier, guest, generic = false } = input;
  let line: string;
  if (guest) line = `Chưa đăng nhập: hệ số ${multiplierLabel(1)}. Đăng nhập để được nhân theo hạng.`;
  else if (!tier) line = 'Điểm được nhân theo hạng thành viên.';
  else if (!tier.tierName) line = tier.multiplier === 1 ? `Bạn chưa có hạng: hệ số ${multiplierLabel(1)}.` : `Hệ số của bạn: ${multiplierLabel(tier.multiplier)}`;
  else line = `Hạng ${tier.tierName}: ${multiplierLabel(tier.multiplier)}`;
  return { title: POINTS_EARN_POPUP.title, tier: line, tilde: generic ? null : POINTS_EARN_POPUP.tilde, delivered: generic ? null : POINTS_EARN_POPUP.delivered, marketplace: input.marketplace };
}
