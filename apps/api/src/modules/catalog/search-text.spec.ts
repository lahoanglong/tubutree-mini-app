import { LIKE_ESCAPE, VN_FOLD_FROM, VN_FOLD_TO, escapeLike, foldVietnamese, likeContainsPattern } from './search-text';

/** Đúng ngữ nghĩa translate() của Postgres: ký tự của `from` không có cặp ở `to` thì bị XOÁ. */
function pgTranslate(s: string, from: string, to: string): string {
  let out = '';
  for (const ch of s) {
    const i = from.indexOf(ch);
    if (i === -1) out += ch;
    else if (i < to.length) out += to[i];
  }
  return out;
}
/** Mô phỏng biểu thức SQL trong catalog.service: regexp_replace(lower(translate(...)), '[[:space:]]+', ' ') + trim. */
const sqlFold = (s: string) => pgTranslate(s, VN_FOLD_FROM, VN_FOLD_TO).toLowerCase().replace(/\s+/g, ' ').trim();

describe('foldVietnamese', () => {
  it('bỏ dấu, về chữ thường', () => {
    expect(foldVietnamese('Nước Rửa Chén')).toBe('nuoc rua chen');
    expect(foldVietnamese('Xà phòng thảo mộc Đậu Đỏ')).toBe('xa phong thao moc dau do');
  });

  it('chữ HOA có dấu (lower() của Postgres dưới collation C không hạ được) vẫn gấp đúng', () => {
    expect(foldVietnamese('NƯỚC RỬA CHÉN ĐẬU')).toBe('nuoc rua chen dau');
  });

  it('chuỗi dựng sẵn dạng NFD (dấu tách rời) gấp giống NFC', () => {
    expect(foldVietnamese('Nước rửa'.normalize('NFD'))).toBe('nuoc rua');
  });

  it('gom khoảng trắng thừa, cắt hai đầu', () => {
    expect(foldVietnamese('  xà   phòng  ')).toBe('xa phong');
  });

  it('ASCII giữ nguyên (chỉ hạ chữ)', () => {
    expect(foldVietnamese('Tubu Tree 500ML')).toBe('tubu tree 500ml');
  });

  it('khớp từng ký tự với cách Postgres translate() + lower() xử lý (cả NFD, chữ hoa)', () => {
    const samples = [
      'Nước Rửa Chén Hương Chanh', 'NƯỚC RỬA', 'Kem chống nắng Rau Má', 'Ổi Ửng Ỹ Ỵ ữ', 'Đà Lạt',
      'Nước'.normalize('NFD'), 'Bình sữa cho bé'.normalize('NFD'),
    ];
    for (const s of samples) expect(foldVietnamese(s)).toBe(sqlFold(s));
  });
});

describe('bảng translate', () => {
  it('mỗi chữ có dấu có đúng 1 chữ ASCII a-z; 8 dấu kết hợp đứng cuối, không có cặp (bị xoá)', () => {
    expect(VN_FOLD_FROM.length - VN_FOLD_TO.length).toBe(8);
    expect(VN_FOLD_TO).toMatch(/^[a-z]+$/);
    expect(new Set(VN_FOLD_FROM).size).toBe(VN_FOLD_FROM.length);
    expect(VN_FOLD_FROM.slice(-8)).toBe('̛̣̀́̃̉̂̆');
  });
});

describe('LIKE', () => {
  it('escape %, _ và chính ký tự escape', () => {
    expect(LIKE_ESCAPE).toBe('!');
    expect(escapeLike('50%_off!')).toBe('50!%!_off!!');
  });

  it('likeContainsPattern = %<gấp dấu + escape>%', () => {
    expect(likeContainsPattern('  Nước 50% ')).toBe('%nuoc 50!%%');
  });
});
