import { describe, expect, it } from 'vitest';
import {
  PDP_BLOCK_ORDER,
  hasOwnStory,
  ingredientsPreview,
  pdpAddOnSource,
  pdpRebuy,
  storyProductWithoutLead,
  subscribePct,
  vnDayMonth,
} from './pdp-info';

describe('pdpAddOnSource: một khối mua kèm', () => {
  it('combo/mua kèm thật thắng FBT và "khách thường mua cùng"', () => {
    expect(pdpAddOnSource({ bundles: true, fbt: true, bought: true })).toBe('bundles');
  });
  it('không có combo thì FBT', () => {
    expect(pdpAddOnSource({ bundles: false, fbt: true, bought: true })).toBe('fbt');
  });
  it('không có FBT thì dải "khách thường mua cùng"', () => {
    expect(pdpAddOnSource({ bundles: false, fbt: false, bought: true })).toBe('bought');
  });
  it('không nguồn nào có dữ liệu thì không khối nào', () => {
    expect(pdpAddOnSource({ bundles: false, fbt: false, bought: false })).toBeNull();
  });
});

describe('ingredientsPreview', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];
  it('mở sẵn 3 dòng, còn lại ẩn', () => {
    expect(ingredientsPreview(list, false)).toEqual({ shown: ['a', 'b', 'c'], hidden: 2 });
  });
  it('bấm Xem đủ thì hiện hết', () => {
    expect(ingredientsPreview(list, true)).toEqual({ shown: list, hidden: 0 });
  });
  it('từ 3 dòng trở xuống không có nút', () => {
    expect(ingredientsPreview(['a', 'b', 'c'], false)).toEqual({ shown: ['a', 'b', 'c'], hidden: 0 });
    expect(ingredientsPreview(null, false)).toEqual({ shown: [], hidden: 0 });
  });
});

describe('subscribePct: % định kỳ theo cấu hình', () => {
  it('0,12 thành 12', () => {
    expect(subscribePct(0.12)).toBe(12);
    expect(subscribePct(0.05)).toBe(5);
  });
  it('không đặt sàn 10%', () => {
    expect(subscribePct(0.08)).toBe(8);
  });
  it('thiếu hay sai thì không nêu số', () => {
    expect(subscribePct(undefined)).toBeNull();
    expect(subscribePct(null)).toBeNull();
    expect(subscribePct(0)).toBeNull();
    expect(subscribePct(Number.NaN)).toBeNull();
    expect(subscribePct(1)).toBeNull();
    expect(subscribePct(12)).toBeNull();
    expect(subscribePct(0.001)).toBeNull();
  });
});

describe('hasOwnStory', () => {
  it('không có cấu hình riêng, cấu hình hỏng hoặc tắt: không vẽ', () => {
    expect(hasOwnStory({ storyConfig: null })).toBe(false);
    expect(hasOwnStory({ storyConfig: undefined })).toBe(false);
    expect(hasOwnStory({ storyConfig: { garbage: true } })).toBe(false);
    expect(hasOwnStory({ storyConfig: { version: 1, enabled: false, scenes: [] } })).toBe(false);
  });
  it('cấu hình riêng hợp lệ đang bật: vẽ', () => {
    expect(hasOwnStory({ storyConfig: { version: 1, enabled: true, scenes: [] } })).toBe(true);
  });
});

describe('storyProductWithoutLead', () => {
  const p = { images: ['a.jpg', 'b.jpg'], thumbnail: 'a.jpg', name: 'x' };
  it('không ảnh tách nền: bỏ ảnh đầu của thư viện', () => {
    expect(storyProductWithoutLead(p, { cutoutUrl: undefined })).toEqual({ images: ['b.jpg'], thumbnail: 'b.jpg', name: 'x' });
    expect(storyProductWithoutLead({ images: ['a.jpg'], thumbnail: 'a.jpg' }, null)).toEqual({ images: [], thumbnail: null });
  });
  it('có ảnh tách nền: giữ nguyên', () => {
    expect(storyProductWithoutLead(p, { cutoutUrl: 'cut.png' })).toBe(p);
  });
});

describe('vnDayMonth', () => {
  it('theo giờ Việt Nam', () => {
    expect(vnDayMonth('2026-11-03T18:30:00.000Z')).toBe('04/11');
    expect(vnDayMonth('2026-01-09T01:00:00.000Z')).toBe('09/01');
    expect(vnDayMonth('xx')).toBeNull();
  });
});

describe('pdpRebuy', () => {
  const vars = [
    { id: 'v1', stock: 3 },
    { id: 'v2', stock: 0 },
  ];
  const item = (variationId: string, lastPurchasedAt: string, productId = 'p1', inStock = true) => ({ productId, variationId, lastPurchasedAt, inStock });
  it('lần mua gần nhất của đúng sản phẩm, phân loại còn hàng', () => {
    expect(pdpRebuy([item('v1', '2026-11-01T03:00:00Z'), item('x', '2026-11-10T03:00:00Z', 'p2')], 'p1', vars)).toEqual({
      variationId: 'v1',
      lastPurchasedAt: '2026-11-01T03:00:00Z',
      dateLabel: '01/11',
    });
  });
  it('phân loại lần trước hết hàng: không có dòng (không thay bằng phân loại khác)', () => {
    expect(pdpRebuy([item('v1', '2026-10-01T03:00:00Z'), item('v2', '2026-11-01T03:00:00Z')], 'p1', vars)).toBeNull();
    expect(pdpRebuy([item('v1', '2026-11-01T03:00:00Z', 'p1', false)], 'p1', vars)).toBeNull();
  });
  it('phân loại không còn trên trang: không có dòng', () => {
    expect(pdpRebuy([item('gone', '2026-11-01T03:00:00Z')], 'p1', vars)).toBeNull();
  });
  it('chưa mua hay chưa tải: không có dòng', () => {
    expect(pdpRebuy([], 'p1', vars)).toBeNull();
    expect(pdpRebuy(undefined, 'p1', vars)).toBeNull();
  });
});

describe('PDP_BLOCK_ORDER', () => {
  it('Thành phần ngay sau lợi ích, Mua lại trước Đặt định kỳ, một khối mua kèm trước Đánh giá', () => {
    const at = (k: (typeof PDP_BLOCK_ORDER)[number]) => PDP_BLOCK_ORDER.indexOf(k);
    expect(at('ingredients')).toBe(at('benefits') + 1);
    expect(at('rebuy')).toBeLessThan(at('subscribe'));
    expect(at('addons')).toBeLessThan(at('reviews'));
    expect(at('reviews')).toBeLessThan(at('compare'));
    expect(new Set(PDP_BLOCK_ORDER).size).toBe(PDP_BLOCK_ORDER.length);
  });
});
