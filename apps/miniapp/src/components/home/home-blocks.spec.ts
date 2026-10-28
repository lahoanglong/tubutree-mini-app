import { describe, it, expect, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { HOME_QUERY_PREFIXES, customerKind, dedupeAgainst, homeBlockOrder, refreshHomeQueries } from './home-blocks';

describe('homeBlockOrder (nguồn ở app-core, Mini App chỉ re-export)', () => {
  it('khách cũ: thẻ thành viên, việc cần làm, lối tắt, mua lại, giờ vàng, danh mục, hành trình, cộng đồng, một lưới gợi ý', () => {
    expect(homeBlockOrder('returning')).toEqual([
      'search', 'member', 'todo', 'shortcuts', 'purchased', 'flash', 'categories', 'journey', 'community', 'suggest',
    ]);
  });

  it('khách mới: Quà khách mới thay thẻ thành viên, không có Mua lại', () => {
    expect(homeBlockOrder('new')).toEqual([
      'search', 'welcome', 'todo', 'shortcuts', 'flash', 'bestSellers', 'categories', 'journey', 'community', 'suggest',
    ]);
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
    expect(HOME_QUERY_PREFIXES).toEqual(expect.arrayContaining(['products', 'for-you', 'flash-sales', 'cart', 'purchased-items', 'orders', 'subscriptions', 'categories', 'loyalty', 'coupons']));
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
