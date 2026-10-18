import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { HOME_GRID_BLOCKS, HOME_QUERY_PREFIXES, customerKind, dedupeAgainst, homeBlockOrder, refreshHomeQueries } from './home-blocks';

const firstGrid = (order: readonly string[]) => order.findIndex((b) => (HOME_GRID_BLOCKS as readonly string[]).includes(b)) + 1;

describe('homeBlockOrder (spec 5b.1, plan 4b Ruling 8)', () => {
  it('khách cũ: tìm → Mua lại → dải đơn → Flash → Dành cho bạn → Bán chạy → Danh mục → Đã xem → Tubu chọn → Mới về → phụ', () => {
    expect(homeBlockOrder('returning')).toEqual([
      'search', 'purchased', 'orderStrip', 'flash', 'forYou', 'bestSellers', 'categories', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
    ]);
  });

  it('khách mới: ưu tiên Flash + Bán chạy + Danh mục; ô Mua lại/dải đơn GIỮ CHỖ (tự rỗng) để trang không nhảy khi dữ liệu về; "Quà khách mới" ngay sau Danh mục để không đẩy lưới SP đầu tiên', () => {
    expect(homeBlockOrder('new')).toEqual([
      'search', 'purchased', 'orderStrip', 'flash', 'bestSellers', 'categories', 'welcome', 'forYou', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
    ]);
    expect(homeBlockOrder('new', false)).toEqual(homeBlockOrder('new'));
  });

  // D7 việc 1 (chủ dự án chưa chốt, cờ home.new_customer_layout): Quà khách mới và Danh mục lên trước giờ vàng.
  it('bố cục mới cho khách mới (cờ bật): Quà khách mới rồi Danh mục ngay sau dải đơn, trước giờ vàng; khách cũ không đổi', () => {
    expect(homeBlockOrder('new', true)).toEqual([
      'search', 'purchased', 'orderStrip', 'welcome', 'categories', 'flash', 'bestSellers', 'forYou', 'recentlyViewed', 'featured', 'newArrivals', 'extras',
    ]);
    expect(homeBlockOrder('returning', true)).toEqual(homeBlockOrder('returning'));
  });

  it('bố cục mới giữ Mua lại/dải đơn ở vị trí 2–3 và mọi khối đúng một lần', () => {
    const order = homeBlockOrder('new', true);
    expect(order.indexOf('purchased') + 1).toBe(2);
    expect(order.indexOf('orderStrip') + 1).toBe(3);
    expect(new Set(order).size).toBe(order.length);
    expect([...order].sort()).toEqual([...homeBlockOrder('new')].sort());
  });

  // Chỉ ghim THỨ TỰ TĨNH; "Dành cho bạn" rỗng (khách cũ chưa có gợi ý) làm lưới đầu tiên trượt xuống khối 6 — ngoại lệ đã chấp nhận, do Task 21 xử lý.
  it('lưới SP đầu tiên nằm trong 5 khối đầu (đầu trang/logo không tính là khối)', () => {
    expect(firstGrid(homeBlockOrder('returning'))).toBeLessThanOrEqual(5);
    expect(firstGrid(homeBlockOrder('new'))).toBeLessThanOrEqual(5);
  });

  it('Mua lại + dải đơn luôn ở vị trí 2–3 ở CẢ hai thứ tự (guard skeleton kệ Mua lại của 4a)', () => {
    for (const kind of ['returning', 'new'] as const) {
      const order = homeBlockOrder(kind);
      expect(order.indexOf('purchased') + 1).toBe(2);
      expect(order.indexOf('orderStrip') + 1).toBe(3);
    }
  });

  it('hai thứ tự là hoán vị của cùng một tập khối (khối "welcome" chỉ có ở khách mới), mỗi khối đúng một lần', () => {
    const a = [...homeBlockOrder('returning')];
    const b = homeBlockOrder('new').filter((id) => id !== 'welcome');
    expect(new Set(a).size).toBe(a.length);
    expect([...b].sort()).toEqual([...a].sort());
    expect(homeBlockOrder('new').filter((id) => id === 'welcome')).toHaveLength(1);
    expect(a).not.toContain('welcome');
  });

  it('customerKind: ≥1 SP đã nhận → khách cũ; 0 / chưa biết (đang tải, 404 API cũ) → khách mới', () => {
    expect(customerKind(1)).toBe('returning');
    expect(customerKind(10)).toBe('returning');
    expect(customerKind(0)).toBe('new');
    expect(customerKind(undefined)).toBe('new');
  });
});

describe('refreshHomeQueries (A2-33: kéo để làm mới phải làm mới ĐỦ)', () => {
  it('invalidate mọi tiền tố query của Trang chủ, gồm for-you, flash, giỏ, Mua lại', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await refreshHomeQueries({ invalidateQueries } as unknown as QueryClient);
    expect(invalidateQueries.mock.calls.map(([f]) => f.queryKey[0])).toEqual([...HOME_QUERY_PREFIXES]);
    expect(HOME_QUERY_PREFIXES).toEqual(expect.arrayContaining(['products', 'for-you', 'flash-sales', 'cart', 'purchased-items', 'orders', 'subscriptions', 'categories']));
  });
});

describe('dedupeAgainst', () => {
  it('bỏ SP đã hiện ở khối trước (A2-32: "Tubu chọn" trùng "Dành cho bạn")', () => {
    expect(dedupeAgainst([{ id: 'a' }, { id: 'b' }], new Set(['a']))).toEqual([{ id: 'b' }]);
  });

  it('giữ nguyên thứ tự và không đổi mảng đầu vào', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(dedupeAgainst(items, new Set(['b'])).map((p) => p.id)).toEqual(['a', 'c']);
    expect(items).toHaveLength(3);
    expect(dedupeAgainst(items, new Set())).toEqual(items);
  });
});
