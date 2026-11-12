import { ingredientNames } from './ingredient-names';

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
