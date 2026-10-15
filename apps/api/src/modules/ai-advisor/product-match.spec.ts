import { matchedTokenCount, productQueryTokens, rankProducts } from './product-match';

describe('productQueryTokens', () => {
  it('bỏ dấu, bỏ từ đệm, bỏ trùng', () => {
    expect(productQueryTokens('Tôi muốn mua nước rửa chén an toàn cho bé, nước rửa chén')).toEqual([
      'nuoc', 'rua', 'chen', 'an', 'toan', 'be',
    ]);
  });

  it('giữ từ trùng tên hàng thật (cỏ, bàn chải, gói, đen)', () => {
    expect(productQueryTokens('cỏ bạc hà')).toEqual(['co', 'bac', 'ha']);
    expect(productQueryTokens('bàn chải tre')).toEqual(['ban', 'chai', 'tre']);
    expect(productQueryTokens('gói trà đen')).toEqual(['goi', 'tra', 'den']);
  });

  it('tối đa 8 từ khoá', () => {
    expect(productQueryTokens('aa bb cc dd ee ff gg hh ii jj')).toHaveLength(8);
  });
});

describe('matchedTokenCount', () => {
  it('khớp nguyên từ, không khớp chuỗi con', () => {
    expect(matchedTokenCount(['mat'], 'Sáp vuốt tóc Hector Matte')).toBe(0);
    expect(matchedTokenCount(['mat', 'ong'], 'Mật ong rừng')).toBe(2);
  });

  it('từ khoá đủ dài (≥4) khớp tiền tố: gõ dở "matt" vẫn ra Matte', () => {
    expect(matchedTokenCount(['matt'], 'Sáp Hector Matte')).toBe(1);
  });
});

describe('rankProducts', () => {
  it('hoà điểm thì giữ thứ tự đầu vào (đã sắp theo nổi bật)', () => {
    const list = [{ name: 'Nước rửa tay' }, { name: 'Nước rửa chén' }];
    expect(rankProducts(['nuoc', 'rua'], list, 5).map((x) => x.name)).toEqual(['Nước rửa tay', 'Nước rửa chén']);
  });
});
