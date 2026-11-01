import { childrenByParent, expandCategoryScope } from './category-scope';

const rows = [
  { id: 'cha', parentId: null },
  { id: 'c1', parentId: 'cha' },
  { id: 'c2', parentId: 'cha' },
  { id: 'c1a', parentId: 'c1' },
  { id: 'la', parentId: null },
];

describe('expandCategoryScope', () => {
  const children = childrenByParent(rows);

  it('danh mục cha trả cha và mọi con cháu', () => {
    expect(expandCategoryScope(children, 'cha').sort()).toEqual(['c1', 'c1a', 'c2', 'cha']);
  });

  it('danh mục lá hoặc id lạ trả đúng [id]', () => {
    expect(expandCategoryScope(children, 'la')).toEqual(['la']);
    expect(expandCategoryScope(children, 'khong-co')).toEqual(['khong-co']);
  });

  it('vòng parentId không treo', () => {
    const loop = childrenByParent([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]);
    expect(expandCategoryScope(loop, 'a').sort()).toEqual(['a', 'b']);
  });
});
