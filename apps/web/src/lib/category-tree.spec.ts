import { describe, it, expect } from 'vitest';
import { buildCategoryTree, canAddChild, canAddRoot, isLeaf, moveInOrder, type CategoryLimits } from './category-tree';
import type { AdminCategory } from './product-categories';

const LIMITS: CategoryLimits = { maxRoots: 8, maxChildren: 8 };
const cat = (id: string, parentId: string | null = null, sortOrder = 0): AdminCategory => ({
  id,
  name: id.toUpperCase(),
  slug: id,
  parentId,
  sortOrder,
  productCount: 0,
  totalCount: 0,
});

describe('buildCategoryTree', () => {
  it('danh sách phẳng như seed (7 gốc, không con) cho 7 gốc rỗng con', () => {
    const tree = buildCategoryTree(Array.from({ length: 7 }, (_, i) => cat(`c${i}`, null, i)));
    expect(tree).toHaveLength(7);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it('con xếp theo cha; mỗi nhóm theo sortOrder rồi id', () => {
    const tree = buildCategoryTree([cat('b', null, 2), cat('a', null, 1), cat('a2', 'a', 2), cat('a1', 'a', 1), cat('a0', 'a', 1)]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(['a0', 'a1', 'a2']);
  });

  it('cha trỏ vào id không còn trong danh sách thì coi như gốc', () => {
    const tree = buildCategoryTree([cat('a'), cat('mo-coi', 'da-xoa', 1)]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'mo-coi']);
  });
});

describe('giới hạn và lá', () => {
  it('canAddRoot / canAddChild theo limits', () => {
    expect(canAddRoot(7, LIMITS)).toBe(true);
    expect(canAddRoot(8, LIMITS)).toBe(false);
    expect(canAddChild(7, LIMITS)).toBe(true);
    expect(canAddChild(8, LIMITS)).toBe(false);
  });

  it('isLeaf: gốc có con không phải lá; gốc không con và mục con là lá; id lạ không phải lá', () => {
    const tree = buildCategoryTree([cat('a'), cat('a1', 'a'), cat('b', null, 1)]);
    expect(isLeaf(tree, 'a')).toBe(false);
    expect(isLeaf(tree, 'b')).toBe(true);
    expect(isLeaf(tree, 'a1')).toBe(true);
    expect(isLeaf(tree, 'zz')).toBe(false);
  });
});

describe('moveInOrder', () => {
  it('đổi chỗ với láng giềng, trả mảng mới', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveInOrder(ids, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(ids, 'b', 'down')).toEqual(['a', 'c', 'b']);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('null khi đã ở đầu/cuối hoặc không có id', () => {
    expect(moveInOrder(['a', 'b'], 'a', 'up')).toBeNull();
    expect(moveInOrder(['a', 'b'], 'b', 'down')).toBeNull();
    expect(moveInOrder(['a', 'b'], 'zz', 'up')).toBeNull();
  });
});
