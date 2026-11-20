import type { HttpClient } from '../http';
import { fillTemplate } from '../copy-template';
import { formatVnNumber } from '../number-format';
import { vnd, vndShort } from '../commerce/money';
import { greenCardCopy } from '../referral/copy';
import { ecoGrams } from './facts';
import { hasEcoImpact, orderEcoImpactBase, orderEcoImpactGate } from './order-impact-gate';

export { hasEcoImpact, orderEcoImpactGate };

/**
 * Thẻ "đơn này giảm bao nhiêu nhựa" ở Chi tiết đơn (tubu-w11-03, cờ `growth.referral_viral_enabled`). Hợp đồng
 * `GET /me/eco-impact/orders/:code`, bản sao của `OrderEcoImpact` ở `apps/api/src/modules/referral/order-eco-impact.service.ts`.
 * Máy chủ đếm chai và điểm thật của đơn; hai app chỉ vẽ.
 */
export interface OrderEcoImpact {
  orderCode: string;
  /** Chai nhựa dùng một lần không phải mua nhờ gói Refill của đơn (đã trừ phần trả). */
  bottlesSaved: number;
  /** Gram nhựa tránh được theo số liệu sản phẩm đã duyệt; 0 khi không có. */
  plasticGrams: number;
  refillPacks: number;
  points: number;
  /** Đơn đã giao: điểm đã vào ví. Chưa giao thì điểm cộng khi nhận hàng. */
  pointsCredited: boolean;
  referralCode: string;
  /** Thưởng đơn đầu khi khách còn nhận được; null thì câu mời chung. */
  inviteReward: { points: number; minOrderAmount: number } | null;
}

export const ORDER_ECO_COPY = {
  bottles: 'Đơn này bạn đã giảm {n} chai nhựa dùng 1 lần',
  grams: 'Đơn này bạn đã giảm {g} nhựa dùng 1 lần',
  shareBottles: 'Mình vừa giảm {n} chai nhựa dùng 1 lần nhờ mua Refill ở Tubu Tree 🌱',
  shareGrams: 'Mình vừa giảm {g} nhựa dùng 1 lần khi mua sắm ở Tubu Tree 🌱',
} as const;

export type OrderEcoCopyKey = keyof typeof ORDER_ECO_COPY;

/** Trần độ dài sau khi điền số (dòng hiển thị ở khổ 360; câu dẫn chia sẻ là mô tả thẻ Zalo). */
export const ORDER_ECO_COPY_MAX: Record<OrderEcoCopyKey, number> = {
  bottles: 46,
  grams: 46,
  shareBottles: 72,
  shareGrams: 72,
};

const orderEcoCopy = (key: OrderEcoCopyKey, vars: Record<string, string | number>) => fillTemplate(ORDER_ECO_COPY[key], vars, key);

const count = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const REF_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** Body lạ thì ném (thẻ ẩn), không đoán số. */
export function parseOrderEcoImpact(body: unknown): OrderEcoImpact {
  const b = body as Partial<OrderEcoImpact> | null | undefined;
  const r = b?.inviteReward;
  if (
    !b ||
    typeof b.orderCode !== 'string' ||
    !count(b.bottlesSaved) ||
    !count(b.plasticGrams) ||
    !count(b.refillPacks) ||
    !count(b.points) ||
    typeof b.pointsCredited !== 'boolean' ||
    typeof b.referralCode !== 'string' ||
    !REF_CODE.test(b.referralCode) ||
    !(r === null || (r && count(r.points) && count(r.minOrderAmount)))
  ) {
    throw new Error('Phản hồi /me/eco-impact không đúng dạng');
  }
  return {
    orderCode: b.orderCode,
    bottlesSaved: b.bottlesSaved,
    plasticGrams: b.plasticGrams,
    refillPacks: b.refillPacks,
    points: b.points,
    pointsCredited: b.pointsCredited,
    referralCode: b.referralCode,
    inviteReward: r ? { points: r.points, minOrderAmount: r.minOrderAmount } : null,
  };
}

export const getOrderEcoImpact = async (http: HttpClient, code: string): Promise<OrderEcoImpact> =>
  parseOrderEcoImpact(await http.get<unknown>(`/me/eco-impact/orders/${encodeURIComponent(code)}`));

export const orderEcoImpactQuery = (http: HttpClient, code: string) => ({
  ...orderEcoImpactBase(code),
  queryFn: () => getOrderEcoImpact(http, code),
});

function savedPart(i: OrderEcoImpact): { key: 'bottles' | 'grams'; vars: Record<string, string | number> } {
  return i.bottlesSaved > 0
    ? { key: 'bottles', vars: { n: formatVnNumber(i.bottlesSaved) } }
    : { key: 'grams', vars: { g: ecoGrams(i.plasticGrams) ?? '0 g' } };
}

/** "Đơn này bạn đã giảm 5 chai nhựa dùng 1 lần"; không có chai thì gram nhựa. */
export function ecoImpactHeadline(i: OrderEcoImpact): string {
  const p = savedPart(i);
  return orderEcoCopy(p.key, p.vars);
}

/** Cùng câu thưởng của thẻ thành tích xanh: hứa thưởng đơn đầu khi máy chủ nói khách còn nhận được. */
export function ecoImpactInviteLine(i: OrderEcoImpact): string {
  const r = i.inviteReward;
  if (!r || r.points <= 0) return greenCardCopy('invitePlain');
  const pts = vnd(r.points).slice(0, -1);
  return r.minOrderAmount > 0
    ? greenCardCopy('reward', { points: pts, min: vndShort(r.minOrderAmount) })
    : greenCardCopy('rewardNoMin', { points: pts });
}

/** Câu dẫn khi chia sẻ (mô tả thẻ chia sẻ Zalo); `ecoImpactShareText` nối thêm câu mời và link. */
export function ecoImpactShareLead(i: OrderEcoImpact): string {
  const p = savedPart(i);
  return orderEcoCopy(p.key === 'bottles' ? 'shareBottles' : 'shareGrams', p.vars);
}

export function ecoImpactShareText(i: OrderEcoImpact, url: string): string {
  return `${ecoImpactShareLead(i)} ${ecoImpactInviteLine(i)}: ${url}`;
}
