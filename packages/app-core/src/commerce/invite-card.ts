import { fillCopy } from '../shop-copy';
import { vnd, vndShort } from './money';
import type { WelcomeOffer } from './share-offer';

/**
 * Khối "Mời bạn sống xanh" ở Tài khoản (Mini App và web): chữ lời hứa và lời chia sẻ. Hai app chỉ vẽ, sao chép và mở hộp chia sẻ.
 * Mọi con số lấy từ máy chủ (mã chào mừng ở cấu hình công khai; thưởng, đơn tối thiểu và hạn ở `GET /me/referral`); thiếu số thì câu nói chung.
 */

/** Cùng khuôn mã giới thiệu mà `withReferral` của hai app chấp nhận; mã khác khuôn không đưa vào URL. */
const REF_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface InviteRewardRules {
  /** Điểm Xanh người mời nhận khi bạn mới có đơn thứ hai (`referrerRewardPoints`); thiếu = API cũ. */
  referrerPoints?: number | null;
  /** Đơn thứ hai tối thiểu (đồng). */
  minOrderAmount?: number | null;
  /** Hạn (ngày) kể từ đơn đầu. */
  windowDays?: number | null;
}

const posInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Số có dấu chấm ngăn nghìn: 5000 → "5.000". */
const points = (n: number): string => vnd(n).slice(0, -1);

/** Câu quà cho bạn mới: "Bạn mới nhận mã 30.000đ cho đơn đầu từ 199k." */
export function inviteFriendGiftLine(offer: WelcomeOffer | null | undefined): string {
  if (!offer) return fillCopy('invite.friendGiftPlain');
  const amount = vnd(offer.amount);
  return offer.minOrder > 0 ? fillCopy('invite.friendGift', { amount, min: vndShort(offer.minOrder) }) : fillCopy('invite.friendGiftNoMin', { amount });
}

/**
 * Câu thưởng cho người mời. CTV (`earnsPoints` false) không nhận Điểm Xanh giới thiệu (chỉ hưởng hoa hồng) nên không có câu này: trả chuỗi rỗng,
 * không hứa thưởng mà máy chủ sẽ không trả.
 */
export function inviteRewardLine(rules: InviteRewardRules | null | undefined, earnsPoints: boolean): string {
  if (!earnsPoints) return '';
  const pts = rules?.referrerPoints;
  if (!posInt(pts)) return fillCopy('invite.rewardPlain');
  const min = rules?.minOrderAmount;
  const days = rules?.windowDays;
  return posInt(min) && posInt(days)
    ? fillCopy('invite.rewardRules', { points: points(pts), min: vndShort(min), days })
    : fillCopy('invite.reward', { points: points(pts) });
}

/** Đoạn mô tả của khối: quà bạn mới, rồi (nếu người mời được thưởng) quà của người mời. */
export function inviteBody(offer: WelcomeOffer | null | undefined, rules: InviteRewardRules | null | undefined, earnsPoints: boolean): string {
  return [inviteFriendGiftLine(offer), inviteRewardLine(rules, earnsPoints)].filter(Boolean).join(' ');
}

/** Link mời: `<gốc>/?ref=<mã>`. Mã sai khuôn thì link trơn (không đưa chuỗi lạ vào URL). Gốc là `https://zalo.me/s/<id>` ở Mini App, origin ở web. */
export function inviteLink(baseUrl: string, referralCode: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return REF_CODE_PATTERN.test(referralCode) ? `${base}/?ref=${referralCode}` : `${base}/`;
}

/** Lời chia sẻ (hộp chia sẻ hệ điều hành, tin nhắn Zalo) và lời chép khi hộp chia sẻ không dùng được. */
export function inviteShareText(url: string): string {
  return fillCopy('invite.shareText', { url });
}
