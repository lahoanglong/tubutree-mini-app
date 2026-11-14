import { describe, expect, it } from 'vitest';
import { INGREDIENT_NAME_MAX, INGREDIENTS_MAX, ingredientsToText, parseIngredientDraft } from './ingredient-draft';

describe('parseIngredientDraft — ô nhập thành phần thành danh sách tên', () => {
  it('tách theo dòng, dấu chấm phẩy và dấu phẩy; bỏ khoảng trắng thừa', () => {
    expect(parseIngredientDraft('Đường\n Muối ;Bột ngọt, Tiêu  ')).toEqual(['Đường', 'Muối', 'Bột ngọt', 'Tiêu']);
  });

  it('không cắt dấu phẩy nằm trong ngoặc: cụm "(dầu cọ, dầu dừa)" thuộc về một thành phần', () => {
    expect(parseIngredientDraft('Dầu thực vật (dầu cọ, dầu dừa), Muối (i-ốt, chống vón), Nước')).toEqual(['Dầu thực vật (dầu cọ, dầu dừa)', 'Muối (i-ốt, chống vón)', 'Nước']);
    expect(parseIngredientDraft('A [x, y], B {z, w}')).toEqual(['A [x, y]', 'B {z, w}']);
  });

  it('ngoặc đóng thừa hay ngoặc mở thiếu không làm hỏng việc tách các dòng sau', () => {
    expect(parseIngredientDraft('A), B\nC (d, e')).toEqual(['A)', 'B', 'C (d, e']);
  });

  it('bỏ dòng trống và tên trùng (không phân biệt hoa thường, giữ bản đầu)', () => {
    expect(parseIngredientDraft('\n\nĐường\nđường\n  \nMuối\nĐƯỜNG')).toEqual(['Đường', 'Muối']);
  });

  it('chuỗi rỗng hoặc chỉ khoảng trắng cho danh sách rỗng', () => {
    expect(parseIngredientDraft('')).toEqual([]);
    expect(parseIngredientDraft(' \n ; , ')).toEqual([]);
  });

  it('gập khoảng trắng liên tiếp bên trong một tên (dán từ ảnh/PDF hay có hai dấu cách)', () => {
    expect(parseIngredientDraft('Bột   mì\tnguyên   cám')).toEqual(['Bột mì nguyên cám']);
  });
});

describe('ingredientsToText', () => {
  it('mỗi tên một dòng, ghép lại rồi tách ra được đúng danh sách cũ', () => {
    const names = ['Dầu thực vật (dầu cọ, dầu dừa)', 'Muối', 'Đường'];
    expect(ingredientsToText(names)).toBe('Dầu thực vật (dầu cọ, dầu dừa)\nMuối\nĐường');
    expect(parseIngredientDraft(ingredientsToText(names))).toEqual(names);
    expect(ingredientsToText([])).toBe('');
  });
});

describe('trần thành phần khớp API', () => {
  it('tối đa 8 tên, mỗi tên tối đa 80 ký tự (COPY_INGREDIENTS_MAX, COPY_INGREDIENT_NAME_MAX của apps/api copy-draft.ts)', () => {
    expect(INGREDIENTS_MAX).toBe(8);
    expect(INGREDIENT_NAME_MAX).toBe(80);
  });
});
