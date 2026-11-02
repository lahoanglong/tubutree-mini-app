import { describe, it, expect } from 'vitest';
import { recompute } from './cart-rules';
import type { CartLine, CartSummary } from '../services/shop-api';

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'l1',
    variationId: 'v1',
    productName: 'SP',
    variationName: '500ml',
    slug: 'sp',
    thumbnail: null,
    unitPrice: 100_000,
    quantity: 1,
    stock: 10,
    total: 100_000,
    ...overrides,
  };
}

function summary(overrides: Partial<CartSummary> = {}): CartSummary {
  return {
    items: [],
    couponCode: null,
    subtotal: 0,
    discount: 0,
    freeship: false,
    freeshipThreshold: 200_000,
    itemCount: 0,
    ...overrides,
  };
}

describe('recompute', () => {
  it('tính lại total từng dòng theo unitPrice × quantity mới (không tin total cũ từ server)', () => {
    const cart = summary();
    const items = [line({ id: 'a', unitPrice: 50_000, quantity: 2, total: 999 })];
    const result = recompute(cart, items, 'a');
    expect(result.items[0]?.total).toBe(100_000);
  });

  it('chỉ tính lại dòng đang sửa: dòng khác giữ total của máy chủ (giá giờ vàng vượt suất không bị nhân lại)', () => {
    const a = line({ id: 'a', unitPrice: 40_000, quantity: 2, total: 80_000 });
    const b = line({ id: 'b', unitPrice: 50_000, quantity: 3, total: 160_000 });
    const result = recompute(summary({ items: [a, b], subtotal: 240_000 }), [{ ...a, quantity: 3 }, b], 'a');
    expect(result.items.map((l) => l.total)).toEqual([120_000, 160_000]);
    expect(result.subtotal).toBe(280_000);
  });

  it('xoá dòng (không có dòng đang sửa): mọi dòng còn lại giữ total của máy chủ', () => {
    const b = line({ id: 'b', unitPrice: 50_000, quantity: 3, total: 160_000 });
    const result = recompute(summary({ subtotal: 400_000 }), [b]);
    expect(result.items[0]?.total).toBe(160_000);
    expect(result.subtotal).toBe(160_000);
  });

  it('subtotal = tổng total các dòng, itemCount = tổng quantity', () => {
    const cart = summary();
    const items = [
      line({ id: 'a', unitPrice: 50_000, quantity: 2 }),
      line({ id: 'b', unitPrice: 30_000, quantity: 3, total: 90_000 }),
    ];
    const result = recompute(cart, items, 'a');
    expect(result.subtotal).toBe(50_000 * 2 + 30_000 * 3);
    expect(result.itemCount).toBe(5);
  });

  it('danh sách rỗng (xoá hết) → subtotal/itemCount về 0, không lỗi', () => {
    const result = recompute(summary({ subtotal: 100_000, itemCount: 1 }), []);
    expect(result.subtotal).toBe(0);
    expect(result.itemCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('giữ couponCode/freeship của cart gốc; combo và giảm của mã về 0 chờ máy chủ tính lại (không hiện combo của món vừa xoá)', () => {
    const cart = summary({ discount: 20_000, comboDiscount: 10_000, couponCode: 'FREESHIP', freeship: true });
    const result = recompute(cart, [line()]);
    expect(result.discount).toBe(0);
    expect(result.comboDiscount).toBe(0);
    expect(result.tierDiscount).toBe(0);
    expect(result.couponCode).toBe('FREESHIP');
    expect(result.freeship).toBe(true);
  });

  describe('nhóm combo (K5): giữ nhóm khi sửa số lượng hay xoá món lẻ, bỏ nhóm khi mất món khoá, số tiền các nhóm luôn bằng comboDiscount', () => {
    const group = { id: 'bundle:b1', kind: 'BUNDLE_PCT' as const, title: 'Bộ Fuwa', discount: 65_250, lineIds: ['i1', 'i2'], keyLineIds: ['i1', 'i2'] };
    const pending = { ...group, discount: 0 };
    const lines = [line({ id: 'i1' }), line({ id: 'i2' }), line({ id: 'i3' })];
    const cart = summary({ items: lines, comboDiscount: 65_250, comboGroups: [group] });
    const sum = (c: { comboGroups?: { discount: number }[] }) => (c.comboGroups ?? []).reduce((s, g) => s + g.discount, 0);

    it('đổi số lượng của dòng trong bộ: nhóm ở nguyên chỗ (khối không nhảy mỗi lần bấm +/−), tiền combo và số của nhóm cùng chờ máy chủ', () => {
      const result = recompute(cart, lines.map((l) => (l.id === 'i2' ? { ...l, quantity: 3 } : l)), 'i2');
      expect(result.comboGroups).toEqual([pending]);
      expect(result.comboDiscount).toBe(0);
      expect(sum(result)).toBe(result.comboDiscount);
    });

    it('xoá một món lẻ: nhóm giữ chỗ, số tiền về 0 cùng comboDiscount (đầu nhóm không ghi số cũ khi chân đã tắt dòng giảm)', () => {
      const result = recompute(cart, lines.filter((l) => l.id !== 'i3'));
      expect(result.comboGroups).toEqual([pending]);
      expect(sum(result)).toBe(result.comboDiscount);
    });

    it('xoá món khoá của bộ: bộ không còn khớp nên nhóm biến mất', () => {
      const result = recompute(cart, lines.filter((l) => l.id !== 'i1'));
      expect(result.comboGroups).toEqual([]);
      expect(sum(result)).toBe(result.comboDiscount);
    });

    it('xoá món mang giảm nhưng không khoá (mục có hai phân loại): nhóm còn, bỏ id đã xoá khỏi lineIds', () => {
      const g = { ...group, lineIds: ['i1', 'i2', 'i3'], keyLineIds: ['i1'] };
      const out = recompute({ ...cart, comboGroups: [g] }, lines.filter((l) => l.id !== 'i3'));
      expect(out.comboGroups).toEqual([{ ...g, discount: 0, lineIds: ['i1', 'i2'] }]);
      expect(sum(out)).toBe(out.comboDiscount);
    });

    it('giỏ từ API cũ không có comboGroups: không lỗi, không tự thêm', () => {
      expect(recompute(summary({ items: lines }), lines).comboGroups).toBeUndefined();
    });
  });
});
