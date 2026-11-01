import { describe, expect, it } from 'vitest';
import { categoryTrail, chipScope, findCategory, type CategoryNode } from './category-tree';

const node = (id: string, over: Partial<CategoryNode> = {}): CategoryNode => ({
  id, parentId: null, name: id, slug: id, image: null, productCount: 3, children: [], ...over,
});
const TREE: CategoryNode[] = [
  node('da', { children: [node('rua-mat', { parentId: 'da' }), node('chong-nang', { parentId: 'da' }), node('trong', { parentId: 'da', productCount: 0 })] }),
  node('la'),
];

describe('findCategory', () => {
  it('tìm cả nút con; id lạ hoặc cây thiếu trả null', () => {
    expect(findCategory(TREE, 'chong-nang')?.id).toBe('chong-nang');
    expect(findCategory(TREE, 'khong-co')).toBeNull();
    expect(findCategory(undefined, 'da')).toBeNull();
  });

  it('API cũ không có `children`: không ném lỗi', () => {
    const flat = [{ id: 'a', parentId: null, name: 'A', slug: 'a', image: null }] as CategoryNode[];
    expect(findCategory(flat, 'a')?.id).toBe('a');
    expect(findCategory(flat, 'b')).toBeNull();
  });
});

describe('categoryTrail', () => {
  it('đường từ gốc tới nút; id lạ là mảng rỗng', () => {
    expect(categoryTrail(TREE, 'rua-mat').map((c) => c.id)).toEqual(['da', 'rua-mat']);
    expect(categoryTrail(TREE, 'la').map((c) => c.id)).toEqual(['la']);
    expect(categoryTrail(TREE, 'x')).toEqual([]);
  });
});

describe('chipScope', () => {
  it('gốc có con: cha là chính nó, chip là các con còn hàng', () => {
    const s = chipScope(TREE, 'da')!;
    expect(s.parent.id).toBe('da');
    expect(s.chips.map((c) => c.id)).toEqual(['rua-mat', 'chong-nang']);
  });

  it('đang ở lá: chip anh em gồm chính nó', () => {
    const s = chipScope(TREE, 'chong-nang')!;
    expect(s.parent.id).toBe('da');
    expect(s.chips.map((c) => c.id)).toEqual(['rua-mat', 'chong-nang']);
  });

  it('con hết hàng vẫn hiện khi chính là nút đang xem', () => {
    expect(chipScope(TREE, 'trong')!.chips.map((c) => c.id)).toEqual(['rua-mat', 'chong-nang', 'trong']);
  });

  it('gốc không con, id lạ, cây thiếu: không có hàng chip', () => {
    expect(chipScope(TREE, 'la')).toBeNull();
    expect(chipScope(TREE, 'x')).toBeNull();
    expect(chipScope(undefined, 'da')).toBeNull();
  });

  it('vòng parentId không treo', () => {
    const a = node('a', { parentId: 'b' });
    const b = node('b', { parentId: 'a', children: [a] });
    a.children = [b];
    expect(() => categoryTrail([a], 'b')).not.toThrow();
    expect(() => chipScope([a], 'b')).not.toThrow();
  });
});
