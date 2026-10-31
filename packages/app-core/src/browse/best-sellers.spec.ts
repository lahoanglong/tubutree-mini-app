import { describe, expect, it } from 'vitest';
import { BEST_SELLERS_ALL_KEY, bestSellerScope, bestSellerTabs, bestSellersHref, bestSellersRankFrom } from './best-sellers';
import type { CategoryNode } from './category-tree';

const node = (id: string, over: Partial<CategoryNode> = {}): CategoryNode => ({
  id, parentId: null, name: `Danh mục ${id}`, slug: id, image: null, productCount: 3, children: [], ...over,
});
const ALL = { key: BEST_SELLERS_ALL_KEY, label: 'Tất cả' };

describe('bestSellerTabs', () => {
  it('cây rỗng hoặc chưa có: chỉ còn tab "Tất cả"', () => {
    expect(bestSellerTabs(undefined)).toEqual([ALL]);
    expect(bestSellerTabs([])).toEqual([ALL]);
  });

  it('tab theo thứ tự cây, chỉ danh mục gốc có hàng; con không thành tab', () => {
    const tree = [
      node('da', { children: [node('rua-mat', { parentId: 'da' })] }),
      node('het-hang', { productCount: 0 }),
      node('cho-be'),
    ];
    expect(bestSellerTabs(tree)).toEqual([ALL, { key: 'da', label: 'Danh mục da' }, { key: 'cho-be', label: 'Danh mục cho-be' }]);
  });

  it('gốc thiếu productCount (API cũ) vẫn có tab; nút có parentId (danh sách phẳng cũ lẫn con) không thành tab', () => {
    const flat = [node('a', { productCount: undefined }), node('con', { parentId: 'a' })];
    expect(bestSellerTabs(flat).map((t) => t.key)).toEqual([BEST_SELLERS_ALL_KEY, 'a']);
  });

  it('tối đa 8 danh mục (cộng "Tất cả")', () => {
    const tree = Array.from({ length: 10 }, (_, i) => node(`c${i}`));
    expect(bestSellerTabs(tree)).toHaveLength(9);
    expect(bestSellerTabs(tree).at(-1)!.key).toBe('c7');
  });
});

describe('bestSellerScope', () => {
  const tabs = bestSellerTabs([node('c1'), node('c2')]);

  it('cây chưa tải (tabs=null): tin tham số trên URL để không tải hai lần', () => {
    expect(bestSellerScope(null, 'c1')).toEqual({ tab: 'c1', category: 'c1' });
    expect(bestSellerScope(null, undefined)).toEqual({ tab: BEST_SELLERS_ALL_KEY, category: undefined });
  });

  it('cây đã tải: tham số là tab thì lọc theo nó; thiếu, rỗng hoặc lạ thì "Tất cả" không lọc', () => {
    expect(bestSellerScope(tabs, 'c2')).toEqual({ tab: 'c2', category: 'c2' });
    expect(bestSellerScope(tabs, undefined)).toEqual({ tab: BEST_SELLERS_ALL_KEY, category: undefined });
    expect(bestSellerScope(tabs, '')).toEqual({ tab: BEST_SELLERS_ALL_KEY, category: undefined });
    expect(bestSellerScope(tabs, 'cu-da-xoa')).toEqual({ tab: BEST_SELLERS_ALL_KEY, category: undefined });
    expect(bestSellerScope([ALL], 'c1')).toEqual({ tab: BEST_SELLERS_ALL_KEY, category: undefined });
  });
});

describe('bestSellersRankFrom', () => {
  it('hạng đầu của trang bắt đầu: 20 món mỗi trang, tiếp nối', () => {
    expect(bestSellersRankFrom(1)).toBe(1);
    expect(bestSellersRankFrom(2)).toBe(21);
    expect(bestSellersRankFrom(3)).toBe(41);
  });

  it('số trang hỏng về hạng 1', () => {
    expect(bestSellersRankFrom(0)).toBe(1);
    expect(bestSellersRankFrom(-4)).toBe(1);
    expect(bestSellersRankFrom(Number.NaN)).toBe(1);
  });
});

describe('bestSellersHref', () => {
  it('địa chỉ trang theo nền: Mini /best-sellers, web /ban-chay', () => {
    expect(bestSellersHref('mini')).toBe('/best-sellers');
    expect(bestSellersHref('web')).toBe('/ban-chay');
  });

  it('giữ danh mục (mã hoá) và số trang; trang 1 không ghi page', () => {
    expect(bestSellersHref('web', { category: 'c 1' })).toBe('/ban-chay?category=c+1');
    expect(bestSellersHref('web', { category: 'c1', page: 2 })).toBe('/ban-chay?category=c1&page=2');
    expect(bestSellersHref('mini', { page: 3 })).toBe('/best-sellers?page=3');
    expect(bestSellersHref('mini', { page: 1 })).toBe('/best-sellers');
    expect(bestSellersHref('mini', { category: '' , page: Number.NaN })).toBe('/best-sellers');
  });
});
