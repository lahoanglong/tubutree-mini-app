import { describe, expect, it } from 'vitest';
import { moveInList, orderedIdsAfterMove, withReorderedCollections, withReorderedItems } from './storefront-order';

const row = (id: string, isPinned = false) => ({ id, isPinned });
const ids = (list: readonly { id: string }[] | null) => list?.map((r) => r.id);

describe('moveInList', () => {
  const list = [row('a'), row('b'), row('c')];

  it('lên: đổi chỗ với hàng trên, không đụng mảng gốc', () => {
    expect(ids(moveInList(list, 'b', 'up'))).toEqual(['b', 'a', 'c']);
    expect(ids(list)).toEqual(['a', 'b', 'c']);
  });

  it('xuống: đổi chỗ với hàng dưới', () => {
    expect(ids(moveInList(list, 'b', 'down'))).toEqual(['a', 'c', 'b']);
  });

  it('đã ở rìa hoặc không có trong danh sách: null (nút bị khoá)', () => {
    expect(moveInList(list, 'a', 'up')).toBeNull();
    expect(moveInList(list, 'c', 'down')).toBeNull();
    expect(moveInList(list, 'zzz', 'up')).toBeNull();
  });

  it('không đổi chỗ qua ranh giới nhóm: món ghim luôn nằm trên món thường nên đổi chỗ qua ranh giới không có tác dụng', () => {
    const items = [row('p1', true), row('p2', true), row('u1'), row('u2')];
    const sameGroup = (a: { isPinned: boolean }, b: { isPinned: boolean }) => a.isPinned === b.isPinned;
    expect(moveInList(items, 'u1', 'up', sameGroup)).toBeNull();
    expect(moveInList(items, 'p2', 'down', sameGroup)).toBeNull();
    expect(ids(moveInList(items, 'p2', 'up', sameGroup))).toEqual(['p2', 'p1', 'u1', 'u2']);
    expect(ids(moveInList(items, 'u1', 'down', sameGroup))).toEqual(['p1', 'p2', 'u2', 'u1']);
  });
});

describe('orderedIdsAfterMove', () => {
  it('trả thứ tự id đầy đủ theo đúng thứ tự gửi cho API sắp xếp', () => {
    expect(orderedIdsAfterMove([row('a'), row('b'), row('c')], 'c', 'up')).toEqual(['a', 'c', 'b']);
  });
  it('không đổi được thì null', () => {
    expect(orderedIdsAfterMove([row('a')], 'a', 'up')).toBeNull();
  });
});

describe('withReorderedCollections / withReorderedItems (cập nhật lạc quan)', () => {
  const sf = {
    title: 'Shop',
    collections: [
      { id: 'c1', items: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }] },
      { id: 'c2', items: [{ id: 'i4' }] },
    ],
  };

  it('sắp lại bộ sưu tập theo orderedIds, giữ nguyên phần còn lại và không đụng bản gốc', () => {
    const out = withReorderedCollections(sf, ['c2', 'c1']);
    expect(out.collections.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(out.title).toBe('Shop');
    expect(sf.collections.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('sắp lại món trong đúng một bộ sưu tập', () => {
    const out = withReorderedItems(sf, 'c1', ['i3', 'i1', 'i2']);
    expect(out.collections[0]!.items.map((i) => i.id)).toEqual(['i3', 'i1', 'i2']);
    expect(out.collections[1]!.items.map((i) => i.id)).toEqual(['i4']);
  });

  it('id thiếu trong orderedIds được nối cuối theo thứ tự cũ, id lạ bị bỏ (như API)', () => {
    expect(withReorderedItems(sf, 'c1', ['i3', 'zzz']).collections[0]!.items.map((i) => i.id)).toEqual(['i3', 'i1', 'i2']);
  });
});
