import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../http';
import {
  ORDER_ECO_COPY,
  ORDER_ECO_COPY_MAX,
  ecoImpactHeadline,
  ecoImpactInviteLine,
  ecoImpactShareLead,
  ecoImpactShareText,
  hasEcoImpact,
  orderEcoImpactGate,
  orderEcoImpactQuery,
  parseOrderEcoImpact,
  type OrderEcoImpact,
} from './order-impact';

const impact = (over: Partial<OrderEcoImpact> = {}): OrderEcoImpact => ({
  orderCode: 'TUBU1',
  bottlesSaved: 5,
  plasticGrams: 0,
  refillPacks: 2,
  points: 120,
  pointsCredited: true,
  referralCode: 'REF123',
  inviteReward: { points: 100, minOrderAmount: 199_000 },
  ...over,
});

describe('parseOrderEcoImpact', () => {
  it('đọc đúng dạng của API', () => {
    expect(parseOrderEcoImpact(impact())).toEqual(impact());
    expect(parseOrderEcoImpact({ ...impact(), inviteReward: null }).inviteReward).toBeNull();
  });
  it('body lạ thì ném (thẻ ẩn), không đoán số', () => {
    expect(() => parseOrderEcoImpact(null)).toThrow();
    expect(() => parseOrderEcoImpact({ ...impact(), bottlesSaved: -1 })).toThrow();
    expect(() => parseOrderEcoImpact({ ...impact(), referralCode: 'a b' })).toThrow();
    expect(() => parseOrderEcoImpact({ ...impact(), inviteReward: { points: '100' } })).toThrow();
  });
});

describe('orderEcoImpactGate', () => {
  it('chỉ hỏi máy chủ khi cờ giới thiệu bật và đơn đã chốt (máy chủ quyết định đã thanh toán hay chưa)', () => {
    for (const status of ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED']) expect(orderEcoImpactGate({ status }, true)).toBe(true);
    for (const status of ['PENDING_PAYMENT', 'CANCELLED', 'RETURNED']) expect(orderEcoImpactGate({ status }, true)).toBe(false);
    expect(orderEcoImpactGate({ status: 'DELIVERED' }, false)).toBe(false);
  });
});

describe('order-impact-gate', () => {
  it('không nhập module nào: trang Chi tiết đơn nhập tĩnh mà không kéo chữ hay module tiền vào chunk của trang', () => {
    const src = readFileSync(join(__dirname, 'order-impact-gate.ts'), 'utf8');
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\bimport\(/);
  });
});

describe('orderEcoImpactQuery', () => {
  it('gọi đúng route, mã đơn được mã hoá', async () => {
    const get = vi.fn().mockResolvedValue(impact());
    const q = orderEcoImpactQuery({ get } as unknown as HttpClient, 'TU BU/1');
    expect(q.queryKey).toEqual(['eco-impact', 'order', 'TU BU/1']);
    await expect(q.queryFn()).resolves.toEqual(impact());
    expect(get).toHaveBeenCalledWith('/me/eco-impact/orders/TU%20BU%2F1');
  });
});

describe('chữ của thẻ', () => {
  it('chai nhựa là tiêu đề; không có chai thì gram nhựa; không có gì thì không vẽ', () => {
    expect(hasEcoImpact(impact())).toBe(true);
    expect(ecoImpactHeadline(impact())).toBe('Đơn này bạn đã giảm 5 chai nhựa dùng 1 lần');
    expect(ecoImpactHeadline(impact({ bottlesSaved: 0, plasticGrams: 1250 }))).toBe('Đơn này bạn đã giảm 1,3 kg nhựa dùng 1 lần');
    expect(hasEcoImpact(impact({ bottlesSaved: 0, plasticGrams: 0 }))).toBe(false);
  });

  it('dòng mời: hứa thưởng đơn đầu khi khách nhận được, không thì câu mời chung', () => {
    expect(ecoImpactInviteLine(impact())).toBe('Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh');
    expect(ecoImpactInviteLine(impact({ inviteReward: { points: 100, minOrderAmount: 0 } }))).toBe('Bạn bè mua đơn đầu, cả hai nhận +100 Điểm Xanh');
    expect(ecoImpactInviteLine(impact({ inviteReward: null }))).toBe('Gửi link mời để bạn bè sống xanh cùng bạn');
  });

  it('chữ chia sẻ kể đúng số của đơn và kèm link mời', () => {
    const url = 'https://tubutree.com/moi/REF123';
    expect(ecoImpactShareText(impact(), url)).toBe(
      `Mình vừa giảm 5 chai nhựa dùng 1 lần nhờ mua Refill ở Tubu Tree 🌱 Bạn bè mua đơn đầu từ 199k, cả hai nhận +100 Điểm Xanh: ${url}`,
    );
    expect(ecoImpactShareText(impact({ bottlesSaved: 0, plasticGrams: 300, inviteReward: null }), url)).toBe(
      `Mình vừa giảm 300 g nhựa dùng 1 lần khi mua sắm ở Tubu Tree 🌱 Gửi link mời để bạn bè sống xanh cùng bạn: ${url}`,
    );
  });

  it('chữ hiển thị nằm trong ngân sách độ dài ở khổ 360 với số lớn', () => {
    const big = impact({ bottlesSaved: 9999, points: 99_999, pointsCredited: false });
    expect(ecoImpactHeadline(big).length).toBeLessThanOrEqual(ORDER_ECO_COPY_MAX.bottles);
    expect(ecoImpactHeadline(impact({ bottlesSaved: 0, plasticGrams: 99_999 })).length).toBeLessThanOrEqual(ORDER_ECO_COPY_MAX.grams);
    expect(ecoImpactShareLead(big).length).toBeLessThanOrEqual(ORDER_ECO_COPY_MAX.shareBottles);
    expect(ecoImpactShareLead(impact({ bottlesSaved: 0, plasticGrams: 99_999 })).length).toBeLessThanOrEqual(ORDER_ECO_COPY_MAX.shareGrams);
    expect(Object.keys(ORDER_ECO_COPY_MAX).sort()).toEqual(Object.keys(ORDER_ECO_COPY).sort());
  });
});
