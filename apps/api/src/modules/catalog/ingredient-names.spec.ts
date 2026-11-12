import { ingredientNames, mergeIngredients } from './ingredient-names';

describe('ingredientNames', () => {
  it('mảng {name}: lấy tên đã cắt khoảng trắng, bỏ tên trống và "[object Object]"', () => {
    expect(ingredientNames([{ name: ' Bơ tươi ', benefit: 'x' }, { name: '' }, { name: '[object Object]' }, { benefit: 'thiếu tên' }, { name: 5 }])).toEqual(['Bơ tươi']);
  });

  it('mảng chuỗi và phần tử rác', () => {
    expect(ingredientNames(['Gấc', '  ', null, 7, 'rác [object Object]'])).toEqual(['Gấc']);
  });

  it('chuỗi tách bằng dấu phẩy, chấm phẩy hay xuống dòng', () => {
    expect(ingredientNames('Bơ, Gấc; Dầu dừa\n Mật ong ,,')).toEqual(['Bơ', 'Gấc', 'Dầu dừa', 'Mật ong']);
  });

  it.each([[null], [undefined], [{}], [42], [true], ['  '], [[]], ['[object Object]']])('%j không có tên thật', (raw) => {
    expect(ingredientNames(raw)).toEqual([]);
  });
});

describe('mergeIngredients', () => {
  const existing = [
    { name: 'Enzyme dứa lên men', percentage: '15%', benefit: 'Phân giải vết bẩn' },
    { name: 'Bồ kết', benefit: 'Làm sạch nhẹ' },
  ];

  it('giữ nguyên dòng hiện có (percentage/benefit) và thành phần AI bỏ sót; chỉ nối tên mới', () => {
    expect(mergeIngredients(existing, ['Enzyme dứa lên men', 'Tinh dầu sả'])).toEqual([...existing, { name: 'Tinh dầu sả' }]);
  });

  it('so tên không phân biệt hoa thường và dấu tiếng Việt, không nối trùng', () => {
    expect(mergeIngredients(existing, ['enzyme dua len men', 'BỒ KẾT', 'bo ket', 'Gấc', 'gac'])).toEqual([...existing, { name: 'Gấc' }]);
  });

  it('dữ liệu cũ dạng mảng chuỗi hay chuỗi tách dấu phẩy thành [{name}]', () => {
    expect(mergeIngredients(['Bơ', '  '], ['Gấc'])).toEqual([{ name: 'Bơ' }, { name: 'Gấc' }]);
    expect(mergeIngredients('Bơ, Gấc', ['Gấc', 'Mật ong'])).toEqual([{ name: 'Bơ' }, { name: 'Gấc' }, { name: 'Mật ong' }]);
  });

  it.each([[null], [undefined], [{}], [42]])('cột %j chưa có thành phần: chỉ ghi tên đã duyệt', (raw) => {
    expect(mergeIngredients(raw, ['Bơ', ' ', 'bơ'])).toEqual([{ name: 'Bơ' }]);
  });
});
