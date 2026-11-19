import type { HttpClient } from '../http';
import { vnd, vndShort } from '../commerce/money';
import { greenCardCopy } from './copy';

/**
 * Thẻ thành tích Sổ tay Xanh kèm link mời (cờ `growth.referral_viral_enabled`). Hợp đồng `GET /me/green-card`, bản sao của `GreenCard` ở
 * `apps/api/src/modules/referral/green-card.service.ts`. Hai app chỉ vẽ: chữ, số và link mời tính ở đây.
 */
export interface GreenCard {
  referralCode: string;
  /** Thẻ đã mở / tổng thẻ; null khi Sổ tay Xanh tắt. */
  album: { seen: number; total: number } | null;
  /** Số món đã đổi qua Đổi rác đã hoàn tất. */
  wasteItems: number;
  firstOrderReward: { points: number; minOrderAmount: number };
  earnsPoints: boolean;
}

export const GREEN_CARD_KEY = ['green-card'] as const;

const count = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const REF_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** Body lạ thì ném (thẻ ẩn), không đoán số. */
export function parseGreenCard(body: unknown): GreenCard {
  const b = body as Partial<GreenCard> | null | undefined;
  const r = b?.firstOrderReward;
  const a = b?.album;
  if (
    !b ||
    typeof b.referralCode !== 'string' ||
    !REF_CODE.test(b.referralCode) ||
    !count(b.wasteItems) ||
    !r ||
    !count(r.points) ||
    !count(r.minOrderAmount) ||
    typeof b.earnsPoints !== 'boolean' ||
    !(a === null || (a && count(a.seen) && count(a.total)))
  ) {
    throw new Error('Phản hồi /me/green-card không đúng dạng');
  }
  return {
    referralCode: b.referralCode,
    album: a ? { seen: a.seen, total: a.total } : null,
    wasteItems: b.wasteItems,
    firstOrderReward: { points: r.points, minOrderAmount: r.minOrderAmount },
    earnsPoints: b.earnsPoints,
  };
}

export const getGreenCard = async (http: HttpClient): Promise<GreenCard> => parseGreenCard(await http.get<unknown>('/me/green-card'));

/** Cờ tắt thì máy chủ trả 404 và app không gọi (đọc cờ ở cấu hình công khai trước); lỗi không thử lại, thẻ ẩn. */
export const greenCardQuery = (http: HttpClient) => ({
  queryKey: GREEN_CARD_KEY,
  queryFn: () => getGreenCard(http),
  staleTime: 60_000,
  retry: false,
});

/** Dòng số: "12 thẻ xanh đã mở · 7 vỏ đã đổi". Sổ tay tắt thì chỉ còn số vỏ. */
export function greenCardStats(card: GreenCard): string {
  const parts = [card.album ? greenCardCopy('cards', { n: card.album.seen }) : null, greenCardCopy('waste', { n: card.wasteItems })];
  return parts.filter(Boolean).join(' · ');
}

/** Câu thưởng đơn đầu cho cả hai bên. CTV không nhận Điểm Xanh giới thiệu, thưởng 0 là Admin tắt: không hứa thưởng, dùng câu mời chung. */
export function greenCardRewardLine(card: GreenCard): string {
  const { points, minOrderAmount } = card.firstOrderReward;
  if (!card.earnsPoints || points <= 0) return greenCardCopy('invitePlain');
  // Số có dấu chấm ngăn nghìn như khối mời: 5000 → "5.000".
  const pts = vnd(points).slice(0, -1);
  return minOrderAmount > 0
    ? greenCardCopy('reward', { points: pts, min: vndShort(minOrderAmount) })
    : greenCardCopy('rewardNoMin', { points: pts });
}
