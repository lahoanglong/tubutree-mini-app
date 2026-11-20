import { describe, expect, it, vi } from 'vitest';
import type { CartLine, CartSummary } from '../api/cart';
import { claimsIn } from '../commerce/copy-claims-guard';
import { SHOP_COPY } from '../shop-copy';
import type { RefillOfferDTO } from './refill-api';
import { refillSavingBadge } from './refill-saving';
import {
  applyRefillSwap,
  refillConfirmText,
  refillSwapOffers,
  undoRefillSwap,
  type RefillCartOps,
  type RefillMilestones,
  type RefillSwapInput,
} from './refill-swap';

const line = (o: Partial<CartLine> & { id: string; productId: string }): CartLine => ({
  variationId: `v-${o.id}`,
  productName: 'Nước giặt Bồ Hòn 1L',
  variationName: 'Mặc định',
  slug: 'nuoc-giat-bo-hon-1l',
  thumbnail: null,
  unitPrice: 120_000,
  quantity: 1,
  stock: 10,
  total: 120_000,
  fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' },
  ...o,
});

const offer = (o: Partial<RefillOfferDTO> = {}): RefillOfferDTO => ({
  productId: 'p-refill',
  slug: 'refill-nuoc-giat-bo-hon-5l',
  name: 'Refill nước giặt Bồ Hòn 5L',
  thumbnail: null,
  variationId: 'v-refill',
  price: 95_000,
  compareAt: null,
  sizeLabel: '5L',
  inStock: true,
  tubu: true,
  ...o,
});

const NONE: RefillMilestones = { freeship: null, giftTrial: null, greenBox: null };
const run = (o: Partial<RefillSwapInput> & Pick<RefillSwapInput, 'lines'>) =>
  refillSwapOffers({ pairs: { 'p-bottle': offer() }, comboGroups: [], milestones: NONE, saving: refillSavingBadge, ...o });
const GIFT = {
  base: 310_000,
  minOrder: 299_000,
  nextMinOrder: null,
  shortfall: 0,
  options: [{ variationId: 'g1', productName: 'Quà', variationName: '', slug: 'qua', thumbnail: null, minOrder: 299_000, unlocked: true }],
  selectedVariationId: 'g1',
  declined: false,
};

describe('refillSwapOffers', () => {
  it('ghi giá đầy đủ, không hỏi lại khi giá giảm và không mất mốc nào', () => {
    const v = run({ lines: [line({ id: 'l1', productId: 'p-bottle' })] }).get('l1')!;
    expect(v.label).toBe('Đã có chai? Đổi sang Refill 5L · 95.000đ');
    expect(v.delta).toBe(-25_000);
    expect(v.needsConfirm).toBe(false);
    expect(v.warning).toBeNull();
  });

  it('giá tăng: liên kết ghi "+mức tăng" và lần chạm đầu phải hỏi lại', () => {
    const v = run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], pairs: { 'p-bottle': offer({ price: 650_000, sizeLabel: '10L' }) } }).get('l1')!;
    expect(v.label).toBe('Đã có chai? Đổi sang Refill 10L · 650.000đ (+530.000đ)');
    expect(v.needsConfirm).toBe(true);
    const c = refillConfirmText(v);
    expect(c.body).toContain('Dòng này tăng 530.000đ.');
    expect(c.confirm).toBe('Đổi sang Refill');
    expect(c.cancel).toBe('Giữ lại');
    expect(c.title).toBe('Đổi sang Refill?');
    expect(c.body).toBe('Refill nước giặt Bồ Hòn 5L · 650.000đ, dùng lại chai bạn đang có. Dòng này tăng 530.000đ. Rẻ hơn 45%/100ml.');
  });

  it('tên không ghi lượng thì "Refill"', () => {
    const v = run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], pairs: { 'p-bottle': offer({ sizeLabel: null }) } }).get('l1')!;
    expect(v.label).toBe('Đã có chai? Đổi sang Refill · 95.000đ');
  });

  it('ẩn khi: không có cặp, refill hết hàng, refill đã trong giỏ, dòng thuộc combo, gian hàng tạm ngưng, dòng đang chờ, chưa có bảng cặp', () => {
    expect(run({ lines: [line({ id: 'l1', productId: 'p-other' })] }).size).toBe(0);
    expect(run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], pairs: { 'p-bottle': offer({ inStock: false }) } }).size).toBe(0);
    expect(run({ lines: [line({ id: 'l1', productId: 'p-bottle' }), line({ id: 'l2', productId: 'p-refill' })] }).has('l1')).toBe(false);
    const combo = { id: 'bundle:1', kind: 'BUNDLE_PCT' as const, title: 'Bộ', discount: 1, lineIds: [], keyLineIds: ['l1'] };
    expect(run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], comboGroups: [combo] }).size).toBe(0);
    expect(
      run({ lines: [line({ id: 'l1', productId: 'p-bottle', fulfiller: { kind: 'UNAVAILABLE', storefrontId: 's', name: 'Gian', reason: 'STORE_PAUSED' } })] }).size,
    ).toBe(0);
    expect(run({ lines: [line({ id: 'pending-1', productId: 'p-bottle' })] }).size).toBe(0);
    expect(run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], pairs: null }).size).toBe(0);
  });

  it('hai dòng chai cùng gói refill: chỉ dòng đầu có liên kết', () => {
    const views = run({ lines: [line({ id: 'l1', productId: 'p-a' }), line({ id: 'l2', productId: 'p-b' })], pairs: { 'p-a': offer(), 'p-b': offer() } });
    expect([...views.keys()]).toEqual(['l1']);
  });

  it('báo trước khi tụt dưới Miễn phí giao hàng: "giỏ còn thiếu …"', () => {
    const v = run({
      lines: [line({ id: 'l1', productId: 'p-bottle' }), line({ id: 'l2', productId: 'p-x', total: 100_000 })],
      milestones: { ...NONE, freeship: { base: 220_000, threshold: 199_000, reached: true, tubuOnly: false } },
    }).get('l1')!;
    expect(v.warning).toBe('Giỏ sẽ thiếu 4.000đ để Miễn phí giao hàng');
    expect(v.needsConfirm).toBe(true);
    expect(refillConfirmText(v).body).toContain('Giỏ sẽ thiếu 4.000đ để Miễn phí giao hàng.');
  });

  it('chưa đạt Miễn phí giao hàng thì không có gì để mất', () => {
    const v = run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], milestones: { ...NONE, freeship: { base: 120_000, threshold: 199_000, reached: false, tubuOnly: false } } }).get('l1')!;
    expect(v.warning).toBeNull();
  });

  it('giỏ có gian hàng tự giao: refill gian hàng giao không được cộng vào tiến độ Tubu', () => {
    const v = run({
      lines: [line({ id: 'l1', productId: 'p-bottle' }), line({ id: 'l2', productId: 'p-x', total: 100_000 })],
      pairs: { 'p-bottle': offer({ tubu: false, price: 150_000 }) },
      milestones: { ...NONE, freeship: { base: 220_000, threshold: 199_000, reached: true, tubuOnly: true } },
    }).get('l1')!;
    expect(v.warning).toBe('Giỏ sẽ thiếu 99.000đ để Miễn phí giao hàng');
  });

  it('dòng bỏ chọn (khách chưa định mua) và dòng Giờ vàng: không mời đổi', () => {
    const lines = [line({ id: 'l1', productId: 'p-bottle' }), line({ id: 'l2', productId: 'p-x', total: 200_000 })];
    expect(run({ lines, isSelected: (id) => id !== 'l1' }).has('l1')).toBe(false);
    expect(run({ lines: [line({ id: 'l1', productId: 'p-bottle', isFlash: true })] }).has('l1')).toBe(false);
  });

  it('mất nhiều mốc cùng lúc: nói đủ cả Miễn phí giao hàng lẫn quà 0đ, không chỉ mốc đầu', () => {
    const v = run({
      lines: [line({ id: 'l1', productId: 'p-bottle', unitPrice: 100_000, quantity: 3, total: 300_000 }), line({ id: 'l2', productId: 'p-x', total: 20_000 })],
      pairs: { 'p-bottle': offer({ price: 150_000 }) },
      milestones: { ...NONE, freeship: { base: 320_000, threshold: 199_000, reached: true, tubuOnly: false }, giftTrial: { ...GIFT, base: 320_000 } },
    }).get('l1')!;
    expect(v.warning).toBe('Giỏ sẽ thiếu 29.000đ để Miễn phí giao hàng. Giỏ sẽ thiếu 129.000đ để nhận quà 0đ');
    expect(v.needsConfirm).toBe(true);
    expect(refillConfirmText(v).body).toMatch(/Miễn phí giao hàng\. Giỏ sẽ thiếu 129\.000đ để nhận quà 0đ\.$/);
  });

  it('báo trước khi mất quà 0đ đang được chọn', () => {
    const v = run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], milestones: { ...NONE, giftTrial: GIFT } }).get('l1')!;
    expect(v.warning).toBe('Giỏ sẽ thiếu 14.000đ để nhận quà 0đ');
  });

  it('khách đã chọn "Không nhận quà" thì không cảnh báo quà', () => {
    const v = run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], milestones: { ...NONE, giftTrial: { ...GIFT, selectedVariationId: null, declined: true } } }).get('l1')!;
    expect(v.warning).toBeNull();
  });

  it('Hộp Xanh: refill gian hàng tự giao làm tụt bậc thì báo; refill Tubu giao giữ nguyên bậc thì im', () => {
    const lines = [line({ id: 'l1', productId: 'p-bottle' }), line({ id: 'l2', productId: 'p-b' }), line({ id: 'l3', productId: 'p-c' })];
    const greenBox = { items: 3, tier: { minItems: 3, pct: 5 }, next: { minItems: 5, pct: 8 }, tiers: [{ minItems: 3, pct: 5 }, { minItems: 5, pct: 8 }], discount: 1 };
    expect(run({ lines, pairs: { 'p-bottle': offer({ tubu: false }) }, milestones: { ...NONE, greenBox } }).get('l1')!.warning).toBe('Giỏ sẽ mất giảm Hộp Xanh');
    const four = { ...greenBox, items: 5, tier: { minItems: 5, pct: 8 }, next: null };
    const lines5 = [...lines, line({ id: 'l4', productId: 'p-d' }), line({ id: 'l5', productId: 'p-e' })];
    expect(run({ lines: lines5, pairs: { 'p-bottle': offer({ tubu: false }) }, milestones: { ...NONE, greenBox: four } }).get('l1')!.warning).toBe('Hộp Xanh sẽ giảm 5%');
    expect(run({ lines, milestones: { ...NONE, greenBox } }).get('l1')!.warning).toBeNull();
  });

  it('chỉ đọc mốc app đưa vào, không đổi ngưỡng nào (199.000đ, 299.000đ, bậc Hộp Xanh giữ nguyên)', () => {
    const milestones: RefillMilestones = {
      freeship: { base: 220_000, threshold: 199_000, reached: true, tubuOnly: false },
      giftTrial: GIFT,
      greenBox: { items: 3, tier: { minItems: 3, pct: 5 }, next: null, tiers: [{ minItems: 3, pct: 5 }], discount: 1 },
    };
    const before = JSON.stringify(milestones);
    run({ lines: [line({ id: 'l1', productId: 'p-bottle' })], milestones });
    expect(JSON.stringify(milestones)).toBe(before);
  });

  it('chữ mới không có tuyên bố môi trường, y tế hay chứng nhận', () => {
    const keys = Object.keys(SHOP_COPY).filter((k) => k.startsWith('refill.') || k.startsWith('wasteRepeat.'));
    expect(keys.length).toBeGreaterThanOrEqual(16);
    for (const k of keys) expect([k, claimsIn(SHOP_COPY[k]!)]).toEqual([k, []]);
  });
});

const cart = (items: Partial<CartLine>[]): CartSummary =>
  ({
    items: items.map((i, n) => line({ id: `c${n}`, productId: `p${n}`, ...i })),
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    freeshipThreshold: 199_000,
    itemCount: items.length,
  }) as CartSummary;

describe('applyRefillSwap / undoRefillSwap', () => {
  it('thêm refill TRƯỚC rồi mới bỏ dòng chai; hoàn tác thêm lại đúng số chai rồi bỏ dòng refill', async () => {
    const calls: string[] = [];
    const ops: RefillCartOps = {
      add: vi.fn(async (v: string, q: number) => {
        calls.push(`add ${v}x${q}`);
        return v === 'v-bottle' ? cart([{ id: 'r1', variationId: 'v-refill' }, { id: 'b2', variationId: 'v-bottle', quantity: q }]) : cart([]);
      }),
      remove: vi.fn(async (id: string) => {
        calls.push(`remove ${id}`);
        return cart([]);
      }),
    };
    const { receipt } = await applyRefillSwap(ops, { lineId: 'b1', bottleVariationId: 'v-bottle', bottleQty: 2, refill: offer() });
    expect(calls).toEqual(['add v-refillx1', 'remove b1']);
    await undoRefillSwap(ops, receipt);
    expect(calls.slice(2)).toEqual(['add v-bottlex2', 'remove r1']);
  });

  it('thêm refill lỗi thì không bỏ dòng chai', async () => {
    const ops: RefillCartOps = { add: vi.fn(async () => Promise.reject(new Error('STOCK'))), remove: vi.fn(async () => cart([])) };
    await expect(applyRefillSwap(ops, { lineId: 'b1', bottleVariationId: 'v-bottle', bottleQty: 1, refill: offer() })).rejects.toThrow('STOCK');
    expect(ops.remove).not.toHaveBeenCalled();
  });

  it('hoàn tác khi dòng refill đã bị bỏ ở nơi khác: chỉ thêm lại chai', async () => {
    const ops: RefillCartOps = { add: vi.fn(async () => cart([{ id: 'b2', variationId: 'v-bottle' }])), remove: vi.fn(async () => cart([])) };
    await undoRefillSwap(ops, { bottleVariationId: 'v-bottle', bottleQty: 1, refillVariationId: 'v-refill' });
    expect(ops.remove).not.toHaveBeenCalled();
  });
});
