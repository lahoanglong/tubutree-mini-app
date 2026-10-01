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
    expect(VN_FOLD_FROM.slice(-8)).toBe('\u031B\u0323\u0300\u0301\u0303\u0309\u0302\u0306');
  });
});

describe('từng chữ cái tiếng Việt gấp về đúng chữ gốc (kỳ vọng tính độc lập với bảng)', () => {
  const TONES = new Set([0x300, 0x301, 0x303, 0x309, 0x323]); // huyền, sắc, ngã, hỏi, nặng
  const SHAPES = new Set([0x302, 0x306, 0x31b]); // mũ, trăng, móc
  /** Dấu hình dạng hợp lệ theo nguyên âm: â ê ô | ă | ơ ư. */
  const SHAPE_OF_BASE: Record<string, number[]> = { a: [0x302, 0x306], e: [0x302], o: [0x302, 0x31b], u: [0x31b] };

  /** Chữ Latin tiếng Việt có dấu, suy ra từ Unicode (NFD) chứ không từ bảng của code đang test. */
  function vietnameseLetters(): Array<{ ch: string; base: string }> {
    const out: Array<{ ch: string; base: string }> = [];
    for (let cp = 0xc0; cp <= 0x1ef9; cp++) {
      const ch = String.fromCodePoint(cp);
      if (ch === 'Đ' || ch === 'đ') { out.push({ ch, base: 'd' }); continue; }
      const nfd = ch.normalize('NFD');
      const marks = [...nfd.slice(1)].map((m) => m.codePointAt(0)!);
      const base = nfd[0].toLowerCase();
      if (nfd.length < 2 || !/^[aeiouy]$/.test(base)) continue;
      const tones = marks.filter((m) => TONES.has(m));
      const shapes = marks.filter((m) => SHAPES.has(m));
      if (tones.length + shapes.length !== marks.length || tones.length > 1 || shapes.length > 1) continue;
      if (shapes.length === 1 && !(SHAPE_OF_BASE[base] ?? []).includes(shapes[0])) continue;
      out.push({ ch, base });
    }
    return out;
  }

  it('đúng 134 chữ (67 thường + 67 HOA) và mỗi chữ gấp ra đúng chữ gốc ở cả TypeScript lẫn translate()', () => {
    const letters = vietnameseLetters();
    expect(letters).toHaveLength(134);
    const wrong: string[] = [];
    for (const { ch, base } of letters) {
      if (foldVietnamese(ch) !== base) wrong.push(`ts ${ch}`);
      if (pgTranslate(ch, VN_FOLD_FROM, VN_FOLD_TO).toLowerCase() !== base) wrong.push(`sql ${ch}`);
    }
    expect(wrong).toEqual([]);
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
