import { formatSize, measureOf, nameGroup, parseMeasure, unitPriceOf } from './product-compare.unit';

describe('parseMeasure: tách dung tích/khối lượng từ tên', () => {
  it.each([
    ['3.8L', { unit: 'ml', qty: 3800 }],
    ['3,8 lít', { unit: 'ml', qty: 3800 }],
    ['500ml', { unit: 'ml', qty: 500 }],
    ['500 ML', { unit: 'ml', qty: 500 }],
    ['1kg', { unit: 'g', qty: 1000 }],
    ['250gr', { unit: 'g', qty: 250 }],
    ['250 gr', { unit: 'g', qty: 250 }],
    ['100 gram', { unit: 'g', qty: 100 }],
    ['5 lit', { unit: 'ml', qty: 5000 }],
    ['Nước rửa chén Fuwa3e 3.8L', { unit: 'ml', qty: 3800 }],
    ['Can 3.8L (3800ml)', { unit: 'ml', qty: 3800 }],
    ['1.000ml', { unit: 'ml', qty: 1000 }],
    ['0,5kg', { unit: 'g', qty: 500 }],
    ['Hộp 250g', { unit: 'g', qty: 250 }],
    ['Túi 1kg', { unit: 'g', qty: 1000 }],
    ['1 chai 500ml', { unit: 'ml', qty: 500 }],
    ['Bột giặt hộp 2.5kg', { unit: 'g', qty: 2500 }],
  ])('"%s"', (text, expected) => {
    expect(parseMeasure(text)).toEqual(expected);
  });

  it.each([
    ['2 x 500ml'],
    ['2x500ml'],
    ['500ml x 2'],
    ['Combo 3 chai 500ml'],
    ['combo 3'],
    ['Lốc 6 hộp 180ml'],
    ['Thùng 12 hộp 180ml'],
    ['Bộ 2 chai 500ml'],
    ['Hộp 10 gói 20g'],
    ['Cặp 2 chai'],
    ['Cặp dầu gội 500ml'],
    ['2 chai 500ml'],
    ['Set 3 hũ 250g'],
    ['Mùi sả'],
    [''],
    ['Fuwa3e'],
    ['Khăn 2 lớp'],
    ['10 gói'],
    ['500ml + 1L'],
    ['250g và 500ml'],
    ['0ml'],
  ])('"%s" → null', (text) => {
    expect(parseMeasure(text)).toBeNull();
  });
});

describe('measureOf: tên phân loại trước, tên sản phẩm sau', () => {
  it('phân loại ghi lượng thì dùng phân loại', () => {
    expect(measureOf('1L', 'Nước giặt 3.8L')).toEqual({ unit: 'ml', qty: 1000 });
  });

  it('phân loại không ghi lượng thì lấy từ tên sản phẩm', () => {
    expect(measureOf('Mùi sả', 'Nước giặt 3.8L')).toEqual({ unit: 'ml', qty: 3800 });
    expect(measureOf('', 'Bột giặt 1kg')).toEqual({ unit: 'g', qty: 1000 });
  });

  it('phân loại là gói nhiều món thì không lùi về tên sản phẩm', () => {
    expect(measureOf('Combo 2 chai', 'Nước rửa chén 500ml')).toBeNull();
    expect(measureOf('2 x 500ml', 'Nước rửa chén 500ml')).toBeNull();
    expect(measureOf('Cặp 2 chai', 'Nước giặt 3.8L')).toBeNull();
    expect(measureOf('Thùng 12 hộp', 'Sữa hạt 180ml')).toBeNull();
  });

  it('cả hai không ghi lượng thì null', () => {
    expect(measureOf('Mùi sả', 'Xà phòng thảo mộc')).toBeNull();
  });
});

describe('formatSize', () => {
  it.each([
    [{ unit: 'ml', qty: 3800 }, '3,8L'],
    [{ unit: 'ml', qty: 1000 }, '1L'],
    [{ unit: 'ml', qty: 1250 }, '1,25L'],
    [{ unit: 'ml', qty: 500 }, '500ml'],
    [{ unit: 'g', qty: 1000 }, '1kg'],
    [{ unit: 'g', qty: 1500 }, '1,5kg'],
    [{ unit: 'g', qty: 250 }, '250g'],
  ] as const)('%j → %s', (m, out) => {
    expect(formatSize(m)).toBe(out);
  });
});

describe('unitPriceOf', () => {
  it('giá trên 100ml làm tròn đồng', () => {
    expect(unitPriceOf(189_000, { unit: 'ml', qty: 3800 }, { unit: 'ml', qty: 500 })).toEqual({ per: '100ml', value: 4974 });
  });

  it('giá trên 100g', () => {
    expect(unitPriceOf(45_000, { unit: 'g', qty: 250 }, { unit: 'g', qty: 1000 })).toEqual({ per: '100g', value: 18_000 });
  });

  it('khác loại đơn vị với món đang xem, hay một bên không tách được → null', () => {
    expect(unitPriceOf(45_000, { unit: 'g', qty: 250 }, { unit: 'ml', qty: 500 })).toBeNull();
    expect(unitPriceOf(45_000, null, { unit: 'ml', qty: 500 })).toBeNull();
    expect(unitPriceOf(45_000, { unit: 'ml', qty: 500 }, null)).toBeNull();
  });
});

describe('nameGroup', () => {
  it.each([
    ['Nước rửa chén Fuwa3e 3.8L', 'Fuwa3e', 'nuoc rua chen'],
    ['Nước rửa chén sinh học hương sả', 'Ecocare', 'nuoc rua chen'],
    ['Nước giặt Ecocare hương quế', 'Ecocare', 'nuoc giat'],
    ['Nước giặt PƠ LANG 2L', 'PƠ LANG', 'nuoc giat'],
    ['Xà phòng 100g', 'X', 'xa phong'],
    ['NƯỚC  RỬA-CHÉN đậm đặc', 'Y', 'nuoc rua chen'],
  ])('"%s" (nhãn %s) → "%s"', (name, brand, group) => {
    expect(nameGroup(name, brand)).toBe(group);
  });

  it('tên mở đầu bằng nhãn → nhóm rỗng', () => {
    expect(nameGroup('Fuwa3e nước rửa chén', 'Fuwa3e')).toBe('');
    expect(nameGroup('Ecocare nước giặt', 'Ecocare')).toBe('');
  });

  it('nhãn viết liền trong tên vẫn dừng nhóm', () => {
    expect(nameGroup('Nước giặt Polang 2L', 'PƠ LANG')).toBe('nuoc giat');
  });
});
