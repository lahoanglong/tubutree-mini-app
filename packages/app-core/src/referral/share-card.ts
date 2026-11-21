import { vnd } from '../commerce/money';
import { greenCardCopy } from './copy';

/**
 * Thẻ chia sẻ ở khối "Mời bạn sống xanh" (Tài khoản web, Cá nhân Mini App). Lời mời đọc thưởng đơn đầu của `GET /me/green-card` (cờ
 * `growth.referral_viral_enabled`; điểm và đơn tối thiểu là `growth.referral_first_order_points` / `_min`), ô số đọc `GET /me/referral`.
 * Không ghi cứng số nào; hai app chỉ vẽ.
 */

export interface InviteShareOffer {
  title: string;
  line: string;
  /** Lời gửi kèm link khi mở hộp chia sẻ: tiêu đề và câu thưởng gộp một câu. */
  message: string;
}

/** Số có dấu chấm ngăn nghìn như khối mời: 5000 → "5.000". */
const pts = (n: number): string => vnd(n).slice(0, -1);

/**
 * Lời mời "Tặng bạn trải nghiệm thuần khiết — nhận +100 Điểm Xanh khi bạn đặt đơn đầu từ 199.000đ". null khi máy chủ báo tài khoản này không
 * nhận thưởng đơn đầu lúc này (CTV, chạm trần tháng, chưa xác thực) hay thưởng bằng 0: thưởng chỉ trả khi cả cặp đủ điều kiện, nên không hứa.
 */
export function inviteShareOffer(
  card: { firstOrderReward: { points: number; minOrderAmount: number }; earnsPoints: boolean } | null | undefined,
): InviteShareOffer | null {
  if (!card || !card.earnsPoints) return null;
  const { points, minOrderAmount } = card.firstOrderReward;
  if (!(points > 0)) return null;
  const vars = { points: pts(points), min: vnd(minOrderAmount) };
  const withMin = minOrderAmount > 0;
  return {
    title: greenCardCopy('shareTitle'),
    line: greenCardCopy(withMin ? 'shareOffer' : 'shareOfferNoMin', vars),
    message: greenCardCopy(withMin ? 'shareMessage' : 'shareMessageNoMin', vars),
  };
}

export interface InviteShareStat {
  key: 'friends' | 'points';
  value: string;
  label: string;
}

const count = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * Ô số của thẻ: bạn bè đã mời (`invitedCount`; API cũ thì số bạn mời thành công) và Điểm Xanh đã nhận từ giới thiệu. CTV không nhận Điểm Xanh
 * giới thiệu nên không có ô điểm. Số thiếu hay hỏng thì không có ô, không vẽ số 0 giả; chưa mời ai (mọi số bằng 0) cũng không có ô.
 */
export function inviteShareStats(
  r: { invitedCount?: unknown; successCount?: unknown; earnedPoints?: unknown } | null | undefined,
  earnsPoints: boolean,
): InviteShareStat[] {
  const out: InviteShareStat[] = [];
  if (count(r?.invitedCount)) out.push({ key: 'friends', value: pts(r.invitedCount), label: greenCardCopy('statInvited') });
  else if (count(r?.successCount)) out.push({ key: 'friends', value: pts(r.successCount), label: greenCardCopy('statSucceeded') });
  if (out.length > 0 && earnsPoints && count(r?.earnedPoints)) out.push({ key: 'points', value: pts(r.earnedPoints), label: greenCardCopy('statPoints') });
  return out.some((s) => s.value !== '0') ? out : [];
}
