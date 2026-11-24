import { describe, expect, it } from 'vitest';
import type { SubscriptionDTO } from '../api/subscriptions';
import type { RefillLandingDTO } from './refill-landing';
import {
  REFILL_NEXT_COPY,
  REFILL_NEXT_COPY_MAX,
  refillDayText,
  refillNextCopy,
  refillNextDelivery,
  refillPostponeDoneText,
  refillPostponePatch,
  type RefillNextCopyKey,
} from './refill-next-delivery';

/** 23h40 ngày 20/10/2026 giờ VN (16:40 UTC): sát nửa đêm VN để bắt lệch múi giờ. */
const NOW = new Date('2026-10-20T16:40:00.000Z');

const pair = (slug: string, bottleSlug = `chai-${slug}`) => ({
  bottle: { productId: `b-${slug}`, slug: bottleSlug, name: 'Chai', thumbnail: null, price: 100_000, compareAt: null, sizeLabel: '1L', inStock: true },
  refill: { productId: `r-${slug}`, slug, name: 'Túi Refill', thumbnail: null, variationId: `v-${slug}`, price: 150_000, compareAt: null, sizeLabel: '3L', inStock: false, tubu: true },
  savingPct: null,
});

const LANDING: RefillLandingDTO = { enabled: true, pairs: [pair('nuoc-giat-refill'), pair('sua-tam-refill')] };

const sub = (over: Partial<SubscriptionDTO> = {}): SubscriptionDTO => ({
  id: 's1',
  quantity: 2,
  intervalWeeks: 4,
  status: 'ACTIVE',
  nextRunAt: '2026-11-02T17:00:00.000Z',
  productName: 'Nước giặt Refill 3L',
  variationName: 'Túi 3L',
  thumbnail: null,
  slug: 'nuoc-giat-refill',
  unitPrice: 189_000,
  effectiveDiscountPct: 0.12,
  cycleSubtotal: 378_000,
  cycleDiscount: 45_360,
  cycleGoods: 332_640,
  ...over,
});

describe('chữ thẻ Kỳ Refill tới', () => {
  it('trần độ dài sau khi điền giá trị xấu nhất', () => {
    const vars = { date: 'Chủ nhật, 30/12/2026', amount: '1.234.000đ', pct: 99, n: 99, name: 'x', qty: 99 };
    for (const key of Object.keys(REFILL_NEXT_COPY) as RefillNextCopyKey[]) {
      const max = REFILL_NEXT_COPY_MAX[key];
      if (max !== null) expect(refillNextCopy(key, vars).length, key).toBeLessThanOrEqual(max);
    }
  });

  it('ngày kèm thứ', () => {
    expect(refillDayText('2026-11-03')).toBe('Thứ Ba, 03/11/2026');
    expect(refillDayText('2027-01-18')).toBe('Thứ Hai, 18/01/2027');
    expect(refillDayText('2026-11-01')).toBe('Chủ nhật, 01/11/2026');
  });
});

describe('refillNextDelivery', () => {
  it('gói Refill đang chạy: ngày VN kỳ tới, giá định kỳ so giá lẻ, nút +7 ngày từ ngày đang hẹn', () => {
    expect(refillNextDelivery([sub()], LANDING, NOW)).toEqual({
      subscriptionId: 's1',
      nextRunAt: '2026-11-02T17:00:00.000Z',
      dateText: 'Thứ Ba, 03/11/2026',
      itemText: 'Nước giặt Refill 3L · SL 2',
      goods: 332_640,
      retail: 378_000,
      savingText: 'Giá định kỳ −12%, rẻ hơn giá lẻ 45.360đ',
      postpone: {
        date: '2026-11-10',
        label: 'Dời lịch kỳ tới (+7 ngày)',
        aria: 'Dời lịch kỳ tới 7 ngày, sang Thứ Ba, 10/11/2026',
        allowed: true,
        limitText: null,
      },
      manageText: 'Quản lý gói định kỳ',
    });
  });

  it('nhiều gói Refill đang chạy: kỳ gần nhất, lối vào nói số gói; gói tạm dừng, đã huỷ, không phải Refill hay ngày hỏng bị bỏ', () => {
    const view = refillNextDelivery(
      [
        sub({ id: 'later', nextRunAt: '2026-11-20T17:00:00.000Z' }),
        sub({ id: 'soon', slug: 'sua-tam-refill', nextRunAt: '2026-10-25T17:00:00.000Z' }),
        sub({ id: 'paused', status: 'PAUSED', nextRunAt: '2026-10-21T17:00:00.000Z' }),
        sub({ id: 'cancelled', status: 'CANCELLED', nextRunAt: '2026-10-21T17:00:00.000Z' }),
        sub({ id: 'bottle', slug: 'chai-nuoc-giat-refill', nextRunAt: '2026-10-21T17:00:00.000Z' }),
        sub({ id: 'noslug', slug: null, nextRunAt: '2026-10-21T17:00:00.000Z' }),
        sub({ id: 'broken', nextRunAt: 'hỏng' }),
      ],
      LANDING,
      NOW,
    );
    expect(view?.subscriptionId).toBe('soon');
    expect(view?.dateText).toBe('Thứ Hai, 26/10/2026');
    expect(view?.manageText).toBe('Xem cả 2 gói Refill định kỳ');
  });

  it('không có gói Refill đang chạy, cờ tắt hay chưa tải: null', () => {
    expect(refillNextDelivery([], LANDING, NOW)).toBeNull();
    expect(refillNextDelivery(undefined, LANDING, NOW)).toBeNull();
    expect(refillNextDelivery([sub({ status: 'PAUSED' })], LANDING, NOW)).toBeNull();
    expect(refillNextDelivery([sub({ slug: 'khac' })], LANDING, NOW)).toBeNull();
    expect(refillNextDelivery([sub()], { enabled: false, pairs: LANDING.pairs }, NOW)).toBeNull();
    expect(refillNextDelivery([sub()], undefined, NOW)).toBeNull();
  });

  it('kỳ đã đến hạn chưa ra đơn (đang thử lại): báo đang chuẩn bị, +7 ngày tính từ hôm nay', () => {
    const view = refillNextDelivery([sub({ nextRunAt: '2026-10-19T17:00:00.000Z' })], LANDING, NOW);
    expect(view?.dateText).toBe('Tubu đang chuẩn bị kỳ này');
    expect(view?.postpone.date).toBe('2026-10-27');
  });

  it('không có giảm định kỳ: không giá gạch, chỉ "Tiền hàng mỗi kỳ"; API cũ chưa trả cycle* thì tự tính', () => {
    const plain = refillNextDelivery([sub({ effectiveDiscountPct: 0, cycleSubtotal: 378_000, cycleDiscount: 0, cycleGoods: 378_000 })], LANDING, NOW);
    expect(plain).toMatchObject({ goods: 378_000, retail: null, savingText: 'Tiền hàng mỗi kỳ' });
    const legacy = refillNextDelivery([sub({ cycleSubtotal: undefined, cycleDiscount: undefined, cycleGoods: undefined })], LANDING, NOW);
    expect(legacy).toMatchObject({ goods: 332_640, retail: 378_000 });
  });

  it('+7 ngày vượt 90 ngày tới: nút khoá, nói ngày xa nhất dời được, không có PATCH', () => {
    const view = refillNextDelivery([sub({ nextRunAt: '2027-01-15T17:00:00.000Z' })], LANDING, NOW)!;
    expect(view.postpone).toMatchObject({ date: '2027-01-23', allowed: false, limitText: 'Chỉ dời được tới Thứ Hai, 18/01/2027' });
    expect(refillPostponePatch(view)).toBeNull();
  });
});

describe('dời một chạm', () => {
  it('PATCH gửi ngày mới kèm nextRunAt thẻ đang hiện', () => {
    const view = refillNextDelivery([sub()], LANDING, NOW)!;
    expect(refillPostponePatch(view)).toEqual({ nextRunDate: '2026-11-10', expectedNextRunAt: '2026-11-02T17:00:00.000Z' });
  });

  it('lời báo theo ngày máy chủ trả, thiếu hay hỏng thì ngày đã gửi', () => {
    expect(refillPostponeDoneText('2026-11-09T17:00:00.000Z', '2026-11-12')).toBe('Đã dời kỳ tới sang Thứ Ba, 10/11/2026');
    expect(refillPostponeDoneText(undefined, '2026-11-10')).toBe('Đã dời kỳ tới sang Thứ Ba, 10/11/2026');
    expect(refillPostponeDoneText('hỏng', '2026-11-10')).toBe('Đã dời kỳ tới sang Thứ Ba, 10/11/2026');
  });
});
