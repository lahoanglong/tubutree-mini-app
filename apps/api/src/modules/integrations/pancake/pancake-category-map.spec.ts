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

  describe('payload kiểu lạ (W11)', () => {
    it.each([[865301, ['865301']], ['865301', ['865301']], [{ id: 5, name: 'Áo' }, []], [true, []], [{}, []], ['', []], [NaN, []]])(
      'category_ids=%j (không phải mảng): đọc như một phần tử lẻ, không ném, không tách ký tự',
      (raw, expected) => {
        expect(pancakeCategoryRefs({ category_ids: raw as never })).toEqual(expected);
      },
    );

    it('categories là một object lẻ hoặc chứa mảng lồng: không ném, phần không đọc được bị bỏ', () => {
      expect(pancakeCategoryRefs({ categories: { id: 9, text: 'Nhóm' } as never })).toEqual(['9', 'nhóm']);
      expect(pancakeCategoryRefs({ categories: [[1, 2], null, { id: {}, name: ['x'], text: '  ' }] as never })).toEqual([]);
    });

    it('làm phẳng cây: nút rác bị bỏ, tên object/thiếu mã không thành "[object Object]" hay "undefined"', () => {
      const tree = [
        null,
        'rác',
        { text: { vi: 'Tên object' }, id: 1 },
        { id: undefined, text: 'Không mã' },
        { id: 3, text: 'Cha', nodes: [{ id: 4, text: 'Con' }, 7, { id: {}, name: 'Con rác mã' }] },
        { id: 5, text: 'Nodes không phải mảng', nodes: 'abc' },
      ] as never;
      const flat = flattenPancakeCategories(tree);
      expect(flat).toEqual([
        { id: '1', name: '1', path: '1' },
        { id: '3', name: 'Cha', path: 'Cha' },
        { id: '4', name: 'Con', path: 'Cha > Con' },
        { id: '5', name: 'Nodes không phải mảng', path: 'Nodes không phải mảng' },
      ]);
      expect(JSON.stringify(flat)).not.toMatch(/undefined|\[object Object\]/);
    });

    it('danh sách gốc không phải mảng: trả rỗng', () => {
      expect(flattenPancakeCategories({} as never)).toEqual([]);
      expect(flattenPancakeCategories(null as never)).toEqual([]);
    });
  });
});
