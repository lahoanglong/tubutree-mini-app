import { beforeEach, describe, expect, it } from 'vitest';
import type { RepurchaseDueItemDTO } from '../api/repurchase-due';
import type { RefillLandingDTO } from './refill-landing';
import {
  dismissRepurchaseDue,
  isRepurchaseDueDismissed,
  REPURCHASE_DUE_COPY,
  REPURCHASE_DUE_COPY_MAX,
  REPURCHASE_DUE_DISMISS_MS,
  REPURCHASE_DUE_DISMISS_STORAGE_KEY,
  repurchaseDueCopy,
  repurchaseDueView,
  resetRepurchaseDueMemoryForTest,
  type RepurchaseDueStore,
} from './repurchase-due-card';

const vnd = (n: number) => `${n.toLocaleString('vi-VN')}đ`;

const item = (over: Partial<RepurchaseDueItemDTO> = {}): RepurchaseDueItemDTO => ({
  key: 'o1:v-refill',
  days: 30,
  boughtName: 'Nước rửa chén Fuwa3e 500ml',
  kind: 'refill',
  variationId: 'v-refill',
  productId: 'p-refill',
  slug: 'nuoc-rua-chen-fuwa3e-refill-1l',
  productName: 'Túi Refill nước rửa chén Fuwa3e 1L',
  variationName: '',
  thumbnail: null,
  price: 89000,
  listPrice: 99000,
  ...over,
});

function memStore(): RepurchaseDueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const broken: RepurchaseDueStore = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('repurchaseDueView', () => {
  it('gói Refill: tiêu đề theo ngày và món đã nhận, thân nêu gói Refill, nút kèm giá giỏ', () => {
    const v = repurchaseDueView(item(), vnd)!;
    expect(v.title).toBe('Đã 30 ngày từ khi bạn nhận Nước rửa chén Fuwa3e 500ml');
    expect(v.body).toBe('Châm lại bằng Túi Refill nước rửa chén Fuwa3e 1L, tiết kiệm hơn và bớt một chai nhựa.');
    expect(v.cta).toBe(`Thêm vào giỏ · ${vnd(89000)}`);
    expect(v).toMatchObject({ key: 'o1:v-refill', variationId: 'v-refill' });
  });

  it('không có gói Refill: thân mời đặt thêm đúng món, không nói chai nhựa', () => {
    const v = repurchaseDueView(item({ kind: 'same', productName: 'Nước ngâm rửa rau quả', variationName: '1L' }), vnd)!;
    expect(v.body).toBe('Sắp dùng hết? Đặt thêm Nước ngâm rửa rau quả trước khi cạn.');
    expect(v.body).not.toContain('nhựa');
  });

  it('không có món: null', () => {
    expect(repurchaseDueView(null, vnd)).toBeNull();
    expect(repurchaseDueView(undefined, vnd)).toBeNull();
  });

  it('Tài khoản giữ chữ w36-01; giỏ trống và trang Refill nói "Sắp hết hàng? Đặt lại 1 chạm" (w55-01)', () => {
    expect(repurchaseDueView(item(), vnd, { surface: 'account' })!.title).toBe('Đã 30 ngày từ khi bạn nhận Nước rửa chén Fuwa3e 500ml');
    for (const surface of ['cart_empty', 'refill_landing'] as const) {
      const v = repurchaseDueView(item(), vnd, { surface })!;
      expect(v.title).toBe('Sắp hết hàng? Đặt lại 1 chạm');
      expect(v.body).toBe('Nước rửa chén Fuwa3e 500ml đã 30 ngày. Châm lại bằng Túi Refill nước rửa chén Fuwa3e 1L.');
      expect(v.cta).toBe(`Thêm vào giỏ · ${vnd(89000)}`);
      expect(v.source).toBe('order');
    }
    const same = repurchaseDueView(item({ kind: 'same', productName: 'Nước ngâm rửa rau quả' }), vnd, { surface: 'cart_empty' })!;
    expect(same.body).toBe('Nước ngâm rửa rau quả đã 30 ngày, sắp dùng hết.');
  });

  describe('mốc đơn sàn (không có món theo đơn trực tiếp)', () => {
    const landing: RefillLandingDTO = {
      enabled: true,
      pairs: [
        {
          bottle: { productId: 'b1', slug: 'nuoc-rua-chen-500ml', name: 'Nước rửa chén Fuwa3e 500ml', thumbnail: null, price: 68_000, compareAt: null, sizeLabel: null, inStock: true },
          refill: {
            productId: 'p-refill',
            slug: 'refill-nuoc-rua-chen-fuwa3e-10l',
            name: 'Refill Nước rửa chén Fuwa3e 10L',
            thumbnail: null,
            variationId: 'v-refill',
            price: 890_000,
            compareAt: null,
            sizeLabel: '10L',
            inStock: true,
            tubu: true,
          },
          savingPct: 34,
        },
      ],
    };

    it('giỏ trống: ghép gói Refill đầu trang Refill, khoá ẩn riêng theo gói, nói đúng là đơn sàn', () => {
      const v = repurchaseDueView(null, vnd, { surface: 'cart_empty', scanDays: 27, landing })!;
      expect(v).toMatchObject({
        key: 'scan:v-refill',
        variationId: 'v-refill',
        source: 'scan',
        title: 'Sắp hết hàng? Đặt lại 1 chạm',
        body: 'Đơn sàn của bạn giao 27 ngày trước. Châm lại bằng Refill Nước rửa chén Fuwa3e 10L.',
        cta: `Thêm vào giỏ · ${vnd(890_000)}`,
      });
    });

    it('chỉ ở giỏ trống: Tài khoản và trang Refill (đã liệt kê đúng gói đó) không vẽ', () => {
      expect(repurchaseDueView(null, vnd, { surface: 'account', scanDays: 27, landing })).toBeNull();
      expect(repurchaseDueView(null, vnd, { surface: 'refill_landing', scanDays: 27, landing })).toBeNull();
      expect(repurchaseDueView(null, vnd, { scanDays: 27, landing })).toBeNull();
    });

    it('thiếu mốc, mốc hỏng, trang Refill chưa tải/cờ tắt/rỗng: không vẽ; món theo đơn luôn thắng mốc', () => {
      for (const scanDays of [undefined, null, 0, -3]) expect(repurchaseDueView(null, vnd, { surface: 'cart_empty', scanDays, landing })).toBeNull();
      for (const bad of [null, undefined, { enabled: false, pairs: landing.pairs }, { enabled: true, pairs: [] }]) {
        expect(repurchaseDueView(null, vnd, { surface: 'cart_empty', scanDays: 27, landing: bad })).toBeNull();
      }
      expect(repurchaseDueView(item(), vnd, { surface: 'cart_empty', scanDays: 27, landing })!.source).toBe('order');
    });
  });

  it('trần độ dài sau khi điền số xấu nhất; mọi khoá điền đủ biến', () => {
    const worst: Record<string, string | number> = { days: 40, product: 'x', refill: 'x', bought: 'x', price: vnd(9_999_000) };
    for (const key of Object.keys(REPURCHASE_DUE_COPY) as (keyof typeof REPURCHASE_DUE_COPY)[]) {
      const text = repurchaseDueCopy(key, worst);
      expect(text).not.toMatch(/[{}]/);
      const max = REPURCHASE_DUE_COPY_MAX[key];
      if (max !== null) expect([...text].length, key).toBeLessThanOrEqual(max);
    }
  });
});

describe('ẩn thẻ 14 ngày theo khoá orderId:variationId', () => {
  const NOW = Date.parse('2026-11-25T03:00:00Z');
  beforeEach(() => resetRepurchaseDueMemoryForTest());

  it('ẩn đúng khoá đã bấm ×, khoá khác vẫn hiện; hết 14 ngày thì hiện lại', () => {
    const store = memStore();
    dismissRepurchaseDue('o1:v1', NOW, store);
    expect(isRepurchaseDueDismissed('o1:v1', NOW + 1, store)).toBe(true);
    expect(isRepurchaseDueDismissed('o2:v1', NOW + 1, store)).toBe(false);
    expect(isRepurchaseDueDismissed('o1:v1', NOW + REPURCHASE_DUE_DISMISS_MS - 1, store)).toBe(true);
    resetRepurchaseDueMemoryForTest();
    expect(isRepurchaseDueDismissed('o1:v1', NOW + REPURCHASE_DUE_DISMISS_MS, store)).toBe(false);
  });

  it('ghi vào kho thật (mở lại app vẫn ẩn), dọn khoá hết hạn', () => {
    const store = memStore();
    store.setItem(REPURCHASE_DUE_DISMISS_STORAGE_KEY, JSON.stringify({ 'old:v': NOW - REPURCHASE_DUE_DISMISS_MS - 1, 'keep:v': NOW - 1000 }));
    dismissRepurchaseDue('o1:v1', NOW, store);
    resetRepurchaseDueMemoryForTest();
    expect(isRepurchaseDueDismissed('o1:v1', NOW + 1, store)).toBe(true);
    expect(Object.keys(JSON.parse(store.data.get(REPURCHASE_DUE_DISMISS_STORAGE_KEY)!)).sort()).toEqual(['keep:v', 'o1:v1']);
  });

  it('kho ném lỗi hoặc không có kho: vẫn ẩn trong phiên, không ném', () => {
    expect(() => dismissRepurchaseDue('o1:v1', NOW, broken)).not.toThrow();
    expect(isRepurchaseDueDismissed('o1:v1', NOW + 1, broken)).toBe(true);
    dismissRepurchaseDue('o2:v2', NOW, null);
    expect(isRepurchaseDueDismissed('o2:v2', NOW + 1, null)).toBe(true);
  });

  it('dữ liệu kho hỏng: coi như chưa ẩn', () => {
    const store = memStore();
    store.setItem(REPURCHASE_DUE_DISMISS_STORAGE_KEY, '{not json');
    expect(isRepurchaseDueDismissed('o1:v1', NOW, store)).toBe(false);
    store.setItem(REPURCHASE_DUE_DISMISS_STORAGE_KEY, '[1,2]');
    expect(isRepurchaseDueDismissed('o1:v1', NOW, store)).toBe(false);
  });

  it('giữ tối đa 50 khoá mới nhất', () => {
    const store = memStore();
    for (let i = 0; i < 60; i += 1) dismissRepurchaseDue(`o${i}:v`, NOW - (60 - i) * 1000, store);
    const kept = Object.keys(JSON.parse(store.data.get(REPURCHASE_DUE_DISMISS_STORAGE_KEY)!));
    expect(kept).toHaveLength(50);
    expect(kept).toContain('o59:v');
    expect(kept).not.toContain('o0:v');
  });
});
