import {
  DID_YOU_MEAN_MAX,
  FUZZY_LIMIT,
  buildVocabulary,
  clipDidYouMean,
  correctPhrase,
  editDistance,
  fuzzyMatchSql,
  shouldTryFuzzy,
  synonymQuery,
} from './search-fuzzy';

const NAMES = ['Nước giặt hương Cam Fuwa3e 500ml', 'Nước giặt cho bé Pineboo 500ml', 'Nước rửa chén Fuwa3e 100ml', 'Bọt rửa bình sữa cho bé Pineboo 500ml', 'Xịt khử mùi ô tô Fuwa3e 150ml'];

describe('search-fuzzy: helper thuần', () => {
  it('shouldTryFuzzy: chỉ khi chính xác ra dưới 3 món và từ khoá (bỏ dấu cách) từ 4 chữ', () => {
    expect(shouldTryFuzzy('nuoc gait', 0)).toBe(true);
    expect(shouldTryFuzzy('nuoc gait', 2)).toBe(true);
    expect(shouldTryFuzzy('nuoc gait', 3)).toBe(false);
    expect(shouldTryFuzzy('a b c', 0)).toBe(false);
    expect(shouldTryFuzzy('abcd', 0)).toBe(true);
  });

  it('editDistance: đổi chỗ 2 chữ kề = 1, thiếu chữ = 1, vượt trần thì trả trần + 1', () => {
    expect(editDistance('gait', 'giat', 1)).toBe(1);
    expect(editDistance('giat', 'giat', 1)).toBe(0);
    expect(editDistance('nuc', 'nuoc', 1)).toBe(1);
    expect(editDistance('nuowc', 'nuoc', 1)).toBe(1);
    expect(editDistance('abcdef', 'zzzzzz', 2)).toBe(3);
    expect(editDistance('a', 'abcd', 1)).toBe(2);
  });

  it('buildVocabulary: khoá gấp dấu, hiện dạng có dấu hay gặp nhất, bỏ dấu câu hai đầu', () => {
    const v = buildVocabulary([...NAMES, '[CHO BÉ] Mật cô đặc']);
    expect(v.get('giat')?.display).toBe('giặt');
    expect(v.get('be')?.display).toBe('bé');
    expect(v.get('be')?.count).toBe(3);
    expect(v.has('[cho')).toBe(false);
    expect(v.get('cho')?.count).toBe(3);
  });

  it('correctPhrase: sửa từ gõ sai và tách từ dính; giữ nguyên thì null; còn từ lạ không sửa được thì null', () => {
    const v = buildVocabulary(NAMES);
    expect(correctPhrase('nuoc gait', v)).toEqual({ folded: 'nuoc giat', display: 'nước giặt' });
    expect(correctPhrase('nuocgiat', v)).toEqual({ folded: 'nuoc giat', display: 'nước giặt' });
    expect(correctPhrase('nuowc rua chen', v)).toEqual({ folded: 'nuoc rua chen', display: 'nước rửa chén' });
    expect(correctPhrase('nuoc giat', v)).toBeNull();
    expect(correctPhrase('qzxw', v)).toBeNull();
    expect(correctPhrase('nuoc qzxw', v)).toBeNull();
  });

  it('synonymQuery: chỉ khớp trọn từ, cụm dài thắng, không đổi gì thì null', () => {
    const syn = [
      { term: 'rua bat', canonical: 'rua chen' },
      { term: 'nuoc rua bat', canonical: 'nuoc rua chen' },
      { term: 'oto', canonical: 'o to' },
    ];
    expect(synonymQuery('nuoc rua bat fuwa', syn)).toBe('nuoc rua chen fuwa');
    expect(synonymQuery('rua bat', syn)).toBe('rua chen');
    expect(synonymQuery('motor', syn)).toBeNull();
    expect(synonymQuery('khu mui oto', syn)).toBe('khu mui o to');
    expect(synonymQuery('nuoc giat', syn)).toBeNull();
  });

  it('fuzzyMatchSql: toán tử <% dùng chỉ mục, mọi giá trị là tham số, LIMIT là tham số', () => {
    const sql = fuzzyMatchSql("o'reilly %_!");
    expect(sql.sql).toContain('<% p."nameSearch"');
    expect(sql.sql).not.toContain("o'reilly");
    expect(sql.values).toEqual(["o'reilly %_!", "o'reilly %_!", FUZZY_LIMIT]);
  });

  it('clipDidYouMean: cắt tên dài', () => {
    expect(clipDidYouMean('  nước giặt ')).toBe('nước giặt');
    const long = clipDidYouMean('a'.repeat(100));
    expect(long.length).toBe(DID_YOU_MEAN_MAX);
    expect(long.endsWith('…')).toBe(true);
  });
});
