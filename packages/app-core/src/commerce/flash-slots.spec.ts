import { describe, expect, it } from 'vitest';
import type { FlashSlot, FlashSlotItem } from '../api/flash-sale';
import { FLASH_CHIP_MIN_ITEMS, initialSlotId, slotAfterEnd, slotCategoryChips, slotListView, slotTabs, tabKeyTarget } from './flash-slots';

// 13:00 ngày 1/11/2026 giờ VN.
const NOW = Date.parse('2026-11-01T06:00:00Z');
const slot = (id: string, startIso: string, hours = 2, over: Partial<FlashSlot> = {}): FlashSlot => ({
  id,
  title: id,
  startAt: startIso,
  endAt: new Date(Date.parse(startIso) + hours * 3_600_000).toISOString(),
  status: 'UPCOMING',
  itemCount: 3,
  ...over,
});
const LIVE = slot('s12', '2026-11-01T05:00:00Z');
const EVENING = slot('s20', '2026-11-01T13:00:00Z');
const TOMORROW = slot('t12', '2026-11-02T05:00:00Z');
const ENDED = slot('s08', '2026-11-01T01:00:00Z');

describe('slotTabs', () => {
  it('giờ VN, chú thích và câu đọc theo trạng thái tính từ giờ hiện tại, không tin status cũ trong cache', () => {
    const tabs = slotTabs([{ ...LIVE, status: 'UPCOMING' }, EVENING, TOMORROW], NOW);
    expect(tabs).toEqual([
      { id: 's12', clock: '12:00', caption: 'Đang diễn ra', spoken: '12:00, đang diễn ra', status: 'LIVE' },
      { id: 's20', clock: '20:00', caption: 'Sắp diễn ra', spoken: '20:00, sắp diễn ra', status: 'UPCOMING' },
      { id: 't12', clock: '12:00', caption: 'Ngày mai', spoken: '12:00, ngày mai', status: 'UPCOMING' },
    ]);
  });

  it('bỏ khung đã kết thúc, xếp theo giờ bắt đầu, tối đa 5 tab', () => {
    const many = [0, 1, 2, 3, 4, 5, 6].map((i) => slot(`x${i}`, new Date(Date.parse('2026-11-01T13:00:00Z') + i * 3 * 3_600_000).toISOString()));
    const tabs = slotTabs([...many].reverse().concat(ENDED), NOW);
    expect(tabs.map((t) => t.id)).toEqual(['x0', 'x1', 'x2', 'x3', 'x4']);
  });

  it('khung bắt đầu sau nửa đêm giờ VN là "Ngày mai" dù cách chưa tới 24 giờ', () => {
    const lateNow = Date.parse('2026-11-01T16:00:00Z'); // 23:00 giờ VN
    const [tab] = slotTabs([slot('after', '2026-11-01T17:30:00Z')], lateNow);
    expect(tab).toMatchObject({ clock: '00:30', caption: 'Ngày mai' });
  });

  it('không có khung nào thì rỗng', () => {
    expect(slotTabs([], NOW)).toEqual([]);
    expect(slotTabs([ENDED], NOW)).toEqual([]);
  });
});

describe('initialSlotId', () => {
  it('khung đang diễn ra sớm nhất; không có thì khung sắp tới sớm nhất; không có gì thì null', () => {
    expect(initialSlotId([EVENING, LIVE, TOMORROW], NOW)).toBe('s12');
    expect(initialSlotId([TOMORROW, EVENING], NOW)).toBe('s20');
    expect(initialSlotId([ENDED], NOW)).toBeNull();
    expect(initialSlotId([], NOW)).toBeNull();
  });
});

describe('slotAfterEnd', () => {
  it('khung kế của khung vừa hết giờ', () => {
    const later = NOW + 2 * 3_600_000; // 15:00: khung 12:00 đã hết
    expect(slotAfterEnd([LIVE, EVENING, TOMORROW], 's12', later)).toBe('s20');
    expect(slotAfterEnd([LIVE, EVENING, TOMORROW], 's20', Date.parse('2026-11-01T15:30:00Z'))).toBe('t12');
  });

  it('khung vừa hết là khung cuối thì null (trang báo đã kết thúc)', () => {
    expect(slotAfterEnd([LIVE], 's12', NOW + 2 * 3_600_000)).toBeNull();
  });

  it('khung vừa hết đã biến mất khỏi danh sách làm mới: lấy khung phù hợp nhất lúc này', () => {
    expect(slotAfterEnd([EVENING, TOMORROW], 's12', NOW + 2 * 3_600_000)).toBe('s20');
  });
});

describe('tabKeyTarget', () => {
  it('mũi tên quay vòng, Home và End nhảy tới đầu cuối, phím khác bỏ qua', () => {
    expect(tabKeyTarget('ArrowRight', 0, 3)).toBe(1);
    expect(tabKeyTarget('ArrowRight', 2, 3)).toBe(0);
    expect(tabKeyTarget('ArrowLeft', 0, 3)).toBe(2);
    expect(tabKeyTarget('ArrowLeft', 2, 3)).toBe(1);
    expect(tabKeyTarget('Home', 2, 3)).toBe(0);
    expect(tabKeyTarget('End', 0, 3)).toBe(2);
    expect(tabKeyTarget('a', 1, 3)).toBeNull();
    expect(tabKeyTarget('Enter', 1, 3)).toBeNull();
  });

  it('không có tab thì không có đích', () => {
    expect(tabKeyTarget('ArrowRight', 0, 0)).toBeNull();
    expect(tabKeyTarget('Home', 0, 0)).toBeNull();
  });
});

const item = (id: string, categoryIds: string[], soldOut = false): FlashSlotItem => ({
  itemId: id,
  variationId: `v-${id}`,
  variationName: null,
  productId: `p-${id}`,
  productSlug: id,
  productName: id,
  thumbnail: null,
  categoryIds,
  flashPrice: 50_000,
  retailPrice: 100_000,
  salePrice: null,
  soldCount: soldOut ? 10 : 1,
  quota: 10,
  soldOut,
  perUserLimit: 5,
});
const CATS = [
  { id: 'food', name: 'Thực phẩm', children: [{ id: 'snack' }, { id: 'drink' }] },
  { id: 'home', name: 'Gia dụng', children: [] },
  { id: 'empty', name: 'Rỗng' },
];
const twelve = (ids: string[]) => Array.from({ length: FLASH_CHIP_MIN_ITEMS }, (_, i) => item(`i${i}`, [ids[i % ids.length]!]));

describe('slotCategoryChips', () => {
  it('ít hơn 12 món thì không hiện chip', () => {
    expect(FLASH_CHIP_MIN_ITEMS).toBe(12);
    expect(slotCategoryChips(twelve(['food']).slice(0, 11), CATS)).toEqual([]);
  });

  it('từ 12 món: mỗi danh mục có món một chip kèm số món, danh mục cha cộng cả món của con, bỏ danh mục không có món', () => {
    const items = [...twelve(['snack', 'home']), item('extra', ['food'])];
    expect(slotCategoryChips(items, CATS)).toEqual([
      { id: 'food', name: 'Thực phẩm', count: 7 },
      { id: 'home', name: 'Gia dụng', count: 6 },
    ]);
  });

  it('một món thuộc cả cha lẫn con chỉ được đếm một lần', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`i${i}`, ['food', 'snack']));
    expect(slotCategoryChips(items, CATS)).toEqual([{ id: 'food', name: 'Thực phẩm', count: 12 }]);
  });
});

describe('slotListView', () => {
  it('món hết suất xuống cuối, giữ thứ tự tương đối của hai nhóm', () => {
    const items = [item('a', [], true), item('b', []), item('c', [], true), item('d', [])];
    expect(slotListView(items, null, CATS).map((i) => i.itemId)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('lọc theo danh mục cha gồm cả con; danh mục lạ cho danh sách rỗng', () => {
    const items = [item('a', ['snack']), item('b', ['home']), item('c', ['food']), item('d', ['drink'], true)];
    expect(slotListView(items, 'food', CATS).map((i) => i.itemId)).toEqual(['a', 'c', 'd']);
    expect(slotListView(items, 'home', CATS).map((i) => i.itemId)).toEqual(['b']);
    expect(slotListView(items, 'zzz', CATS)).toEqual([]);
  });

  it('không đổi mảng đầu vào', () => {
    const items = [item('a', [], true), item('b', [])];
    slotListView(items, null, CATS);
    expect(items.map((i) => i.itemId)).toEqual(['a', 'b']);
  });
});
