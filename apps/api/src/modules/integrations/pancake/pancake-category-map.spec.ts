import { categoryMapProblem, flattenPancakeCategories, mapPancakeCategories, pancakeCategoryRefs } from './pancake-category-map';

describe('pancake-category-map', () => {
  const valid = new Set(['catA', 'catB']);

  it('đọc mã từ category_ids (số hoặc chuỗi) và mã/tên từ categories', () => {
    expect(pancakeCategoryRefs({ category_ids: [865301, ' 30163 '], categories: [{ id: 5, name: 'Áo Thun' }, 'Khác', 7] })).toEqual([
      '865301',
      '30163',
      '5',
      'áo thun',
      'khác',
      '7',
    ]);
    expect(pancakeCategoryRefs({})).toEqual([]);
    expect(pancakeCategoryRefs({ category_ids: null, categories: null })).toEqual([]);
  });

  it('ánh xạ theo mã hoặc theo tên không phân biệt hoa thường, bỏ id danh mục Tubu không tồn tại', () => {
    const map = { '865301': 'catA', 'Áo Thun': 'catB', '999': 'ghost' };
    expect(mapPancakeCategories({ category_ids: [865301, 999], categories: [{ name: 'áo thun' }] }, map, valid).sort()).toEqual(['catA', 'catB']);
    expect(mapPancakeCategories({ category_ids: [999] }, map, valid)).toEqual([]);
    expect(mapPancakeCategories({ category_ids: [1] }, map, valid)).toEqual([]);
  });

  it('luật ghi: chỉ nhận object chuỗi → chuỗi', () => {
    expect(categoryMapProblem({})).toBeNull();
    expect(categoryMapProblem({ '1': 'abc' })).toBeNull();
    expect(categoryMapProblem([])).not.toBeNull();
    expect(categoryMapProblem(null)).not.toBeNull();
    expect(categoryMapProblem('x')).not.toBeNull();
    expect(categoryMapProblem({ '1': 5 })).not.toBeNull();
    expect(categoryMapProblem({ '1': '' })).not.toBeNull();
    expect(categoryMapProblem({ ' ': 'abc' })).not.toBeNull();
  });

  it('làm phẳng cây nhóm hàng kèm đường dẫn', () => {
    expect(flattenPancakeCategories([{ id: 1, text: 'Cha', nodes: [{ id: 2, text: 'Con', nodes: [] }] }])).toEqual([
      { id: '1', name: 'Cha', path: 'Cha' },
      { id: '2', name: 'Con', path: 'Cha > Con' },
    ]);
  });
});
