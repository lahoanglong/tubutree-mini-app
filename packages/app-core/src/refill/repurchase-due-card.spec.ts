import { beforeEach, describe, expect, it } from 'vitest';
import type { RepurchaseDueItemDTO } from '../api/repurchase-due';
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

  it('trần độ dài sau khi điền số xấu nhất; mọi khoá điền đủ biến', () => {
    const worst: Record<string, string | number> = { days: 40, product: 'x', refill: 'x', price: vnd(9_999_000) };
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
