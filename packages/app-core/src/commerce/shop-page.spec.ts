import { describe, expect, it } from 'vitest';
import { SHOP_COPY } from '../shop-copy';
import {
  SHOP_PAGE_SIZE,
  SHOP_SORT_OPTIONS,
  brandStatsInput,
  comboTotals,
  followerStat,
  nextShopSort,
  pageWindow,
  planShopSections,
  promotionVoucher,
  publicTier,
  shopSortToCatalog,
  shopSortValue,
  shopTabs,
  sortShopProducts,
  storefrontStatsInput,
  uniqueShopProducts,
  type ShopSort,
} from './shop-page';

const p = (id: string, over: Record<string, unknown> = {}) => ({ id, basePrice: 100_000, salePrice: null, sold: 0, createdAt: null, ...over });
const col = (kind: string, ids: string[]) => ({ kind, items: ids.map((id) => ({ product: p(id) })) });

describe('shopTabs', () => {
  it('Shop | Sản phẩm (n) | Danh mục', () => {
    const tabs = shopTabs({ productCount: 17 });
    expect(tabs.map((t) => t.key)).toEqual(['shop', 'products', 'categories']);
    expect(tabs.map((t) => t.label)).toEqual(['Shop', 'Sản phẩm', 'Danh mục']);
    expect(tabs.find((t) => t.key === 'products')?.count).toBe(17);
    expect(tabs.find((t) => t.key === 'shop')?.count).toBeUndefined();
  });

  it('thương hiệu có thêm Câu chuyện; không bộ sưu tập thì bỏ Danh mục', () => {
    expect(shopTabs({ productCount: 3, hasStory: true }).map((t) => t.key)).toEqual(['shop', 'products', 'categories', 'story']);
    expect(shopTabs({ productCount: 3, hasStory: true, hasCategories: false }).map((t) => t.key)).toEqual(['shop', 'products', 'story']);
  });
});

describe('sắp xếp tab Sản phẩm', () => {
  it('chọn "Giá" lần đầu là tăng dần, bấm lại đảo chiều, chọn tab khác thì đổi hẳn', () => {
    expect(nextShopSort('popular', 'price')).toBe('price_asc');
    expect(nextShopSort('price_asc', 'price')).toBe('price_desc');
    expect(nextShopSort('price_desc', 'price')).toBe('price_asc');
    expect(nextShopSort('price_asc', 'newest')).toBe('newest');
  });

  it('giá trị của SortBar và tham số catalog', () => {
    expect(shopSortValue('price_desc')).toBe('price');
    expect(shopSortValue('newest')).toBe('newest');
    expect(SHOP_SORT_OPTIONS.map((o) => o.value)).toEqual(['popular', 'newest', 'best_seller_30d', 'price']);
    expect(SHOP_SORT_OPTIONS.map((o) => o.label)).toEqual(['Phổ biến', 'Mới', 'Bán chạy', 'Giá ⇅']);
    expect(SHOP_SORT_OPTIONS.find((o) => o.value === 'price')?.spoken).toBe('Giá, đổi chiều sắp xếp');
    expect(shopSortToCatalog('popular')).toBeUndefined();
    expect(shopSortToCatalog('best_seller_30d')).toBe('best_seller_30d');
    expect(shopSortToCatalog('price_desc')).toBe('price_desc');
  });

  it('sortShopProducts: giá theo giá đang bán, mới theo ngày (thiếu ngày xuống cuối), bán chạy theo sold, phổ biến giữ nguyên', () => {
    const list = [
      p('a', { basePrice: 100, salePrice: 60, sold: 5, createdAt: '2026-10-01T00:00:00Z' }),
      p('b', { basePrice: 80, sold: 50, createdAt: '2026-10-20T00:00:00Z' }),
      p('c', { basePrice: 70, sold: 20 }),
    ];
    const ids = (s: ShopSort) => sortShopProducts(list, s).map((x) => x.id);
    expect(ids('price_asc')).toEqual(['a', 'c', 'b']);
    expect(ids('price_desc')).toEqual(['b', 'c', 'a']);
    expect(ids('newest')).toEqual(['b', 'a', 'c']);
    expect(ids('best_seller_30d')).toEqual(['b', 'c', 'a']);
    expect(ids('popular')).toEqual(['a', 'b', 'c']);
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('uniqueShopProducts', () => {
  it('bỏ sản phẩm trùng giữa các bộ, giữ thứ tự khối', () => {
    expect(uniqueShopProducts([col('NORMAL', ['a', 'b']), col('NORMAL', ['b', 'c'])]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('planShopSections', () => {
  it('tối đa 6 khối ở tab Shop, khối thứ 7 trở đi chỉ ở tab Danh mục', () => {
    const cols = Array.from({ length: 8 }, (_, i) => col('NORMAL', [`p${i}`]));
    const plan = planShopSections(cols);
    expect(plan.main).toHaveLength(6);
    expect(plan.extra).toHaveLength(2);
    expect(plan.extra[0]).toBe(cols[6]);
  });

  it('bỏ bộ rỗng; combo chỉ một sản phẩm khác nhau thì ẩn hẳn (không tính vào 6)', () => {
    const plan = planShopSections([col('NORMAL', []), col('COMBO', ['a', 'a']), col('COMBO', ['a', 'b']), col('NORMAL', ['c'])]);
    expect(plan.main.map((c) => c.kind)).toEqual(['COMBO', 'NORMAL']);
    expect(plan.extra).toEqual([]);
  });

  it('không có bộ nào thì cả hai rỗng', () => {
    expect(planShopSections([])).toEqual({ main: [], extra: [] });
  });
});

describe('comboTotals', () => {
  it('giảm sàn từng dòng như allocateComboDiscounts của API', () => {
    expect(comboTotals([100_000, 50_000], 10)).toEqual({ total: 150_000, comboTotal: 135_000, saving: 15_000 });
    expect(comboTotals([33_333, 33_333], 10)).toEqual({ total: 66_666, comboTotal: 60_000, saving: 6_666 });
  });

  it('pct không hợp lệ thì không giảm; quá 100 kẹp về 100', () => {
    for (const pct of [null, Number.NaN, 0, -5]) expect(comboTotals([100, 200], pct).saving).toBe(0);
    expect(comboTotals([100, 200], 150)).toEqual({ total: 300, comboTotal: 0, saving: 300 });
  });
});

describe('publicTier', () => {
  it('ẩn bậc thấp nhất; API cũ chưa gửi cờ thì cũng ẩn', () => {
    expect(publicTier({ name: 'Tân binh', emoji: '🌱', publicBadge: false })).toBeNull();
    expect(publicTier({ name: 'Tân binh', emoji: '🌱' })).toBeNull();
    expect(publicTier(null)).toBeNull();
    expect(publicTier(undefined)).toBeNull();
    expect(publicTier({ name: 'Bạc', emoji: '🥈', publicBadge: true })).toEqual({ name: 'Bạc', emoji: '🥈' });
  });
});

describe('số liệu shop', () => {
  const item = (id: string, over: Record<string, unknown>) => ({ product: { id, ratingAvg: 0, reviewCount: 0, sold: 0, ...over } });

  it('gian hàng CTV: đếm sản phẩm khác nhau, sao trung bình theo số đánh giá, bán cộng dồn', () => {
    const stats = storefrontStatsInput([
      { items: [item('a', { ratingAvg: 5, reviewCount: 3, sold: 10 }), item('b', { ratingAvg: 4, reviewCount: 3, sold: 5 })] },
      { items: [item('a', { ratingAvg: 5, reviewCount: 3, sold: 10 })] },
    ]);
    expect(stats.productCount).toBe(2);
    expect(stats.ratingAvg).toBeCloseTo(4.5);
    expect(stats.sold).toBe(15);
  });

  it('dưới 5 đánh giá thì không khoe sao; không ai bán thì sold null', () => {
    const stats = storefrontStatsInput([{ items: [item('a', { ratingAvg: 5, reviewCount: 4 })] }]);
    expect(stats).toEqual({ productCount: 1, ratingAvg: null, sold: null });
  });

  it('thương hiệu: danh sách cụt (30 trên 40) thì chỉ khoe số sản phẩm', () => {
    const products = Array.from({ length: 30 }, (_, i) => ({ ratingAvg: 5, reviewCount: 10, sold: 100 + i }));
    expect(brandStatsInput({ productCount: 40, products })).toEqual({ productCount: 40, ratingAvg: null, sold: null });
  });

  it('thương hiệu: thiếu productCount (API cũ) thì đếm danh sách và tính sao, bán bình thường', () => {
    const stats = brandStatsInput({ products: [{ ratingAvg: 4, reviewCount: 5, sold: 7 }, { ratingAvg: 5, reviewCount: 5, sold: 3 }] });
    expect(stats.productCount).toBe(2);
    expect(stats.ratingAvg).toBeCloseTo(4.5);
    expect(stats.sold).toBe(10);
  });

  it('followerStat: số có dấu chấm nghìn; 0, null, NaN thì không có ô', () => {
    expect(followerStat(1200)).toEqual({ label: 'Theo dõi', value: '1.200', spoken: '1.200 người theo dõi' });
    expect(followerStat(0)).toBeNull();
    expect(followerStat(null)).toBeNull();
    expect(followerStat(Number.NaN)).toBeNull();
  });
});

describe('promotionVoucher', () => {
  const now = Date.parse('2026-11-01T05:00:00Z');
  it('khuyến mãi có mã thành phiếu của shop để sao chép', () => {
    const v = promotionVoucher({ id: 'p1', title: 'Giảm 15%', subtitle: 'Đơn từ 199k', couponCode: 'FUWA15', endAt: '2026-11-30T16:00:00Z' }, now);
    expect(v).toMatchObject({ id: 'p1', code: 'FUWA15', title: 'Giảm 15%', kind: 'shop', condition: 'Đơn từ 199k', state: 'collectable', expiry: 'Dùng đến 30/11' });
  });

  it('không mã thì chỉ là thông tin, hạn hỏng thì chữ hạn rỗng', () => {
    const v = promotionVoucher({ id: 'p2', title: 'Tuần lễ nhãn', couponCode: null, endAt: 'rác' }, now);
    expect(v.code).toBe('');
    expect(v.condition).toBe('');
    expect(v.expiry).toBe('');
  });
});

describe('pageWindow', () => {
  it('ít trang thì liệt kê hết', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 0)).toEqual([]);
  });

  it('nhiều trang thì rút gọn bằng dấu …', () => {
    expect(pageWindow(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, '…', 20]);
    expect(pageWindow(20, 20)).toEqual([1, '…', 18, 19, 20]);
  });
});

describe('chữ trang shop', () => {
  it('đủ khoá, kích thước trang 20', () => {
    expect(SHOP_PAGE_SIZE).toBe(20);
    for (const k of ['shop.tabShop', 'shop.tabProducts', 'shop.tabCategories', 'shop.tabStory', 'shop.follow', 'shop.following', 'shop.vouchers', 'shop.sortPopular', 'shop.sortNew', 'shop.sortSold', 'shop.sortPrice', 'shop.loadMore', 'shop.emptyProducts', 'shop.categoryCount', 'shop.pagerLabel', 'shop.comboError', 'shop.comboAdded', 'shop.loginForCombo', 'stats.followers', 'stats.followersSpoken', 'combo.soldOutSpoken']) {
      expect(SHOP_COPY[k], k).toBeTruthy();
    }
  });
});
