import { describe, expect, it } from 'vitest';
import type { ProductCard } from '../api/catalog';
import { fillCopy, FORBIDDEN_TERMS } from '../shop-copy';
import { homeQuizQuestions, pickKitProducts, type HomeQuizAnswers, type KitProduct } from './home-quiz';

const FAMILY = ['baby_pet', 'adult_only'] as const;
const WORRY = ['dry_skin', 'strong_scent', 'grease'] as const;
const FORMAT = ['bottle', 'refill'] as const;
const ALL: HomeQuizAnswers[] = FAMILY.flatMap((family) => WORRY.flatMap((worry) => FORMAT.map((format) => ({ family, worry, format }))));
const base: HomeQuizAnswers = { family: 'adult_only', worry: 'grease', format: 'bottle' };

const p = (id: string, name: string, extra: Partial<KitProduct> = {}): KitProduct => ({ id, name, ...extra });
const ids = (rows: KitProduct[]) => rows.map((r) => r.id);

describe('homeQuizQuestions', () => {
  it('3 câu theo thứ tự family, worry, format với đúng giá trị enum của API', () => {
    const q = homeQuizQuestions();
    expect(q.map((x) => x.id)).toEqual(['family', 'worry', 'format']);
    expect(q[0]!.options.map((o) => o.value)).toEqual([...FAMILY]);
    expect(q[1]!.options.map((o) => o.value)).toEqual([...WORRY]);
    expect(q[2]!.options.map((o) => o.value)).toEqual([...FORMAT]);
  });

  it('tiêu đề và nhãn lấy từ SHOP_COPY, có emoji, không rỗng, không trùng, sạch từ cấm', () => {
    const q = homeQuizQuestions();
    const labels: string[] = [];
    for (const question of q) {
      expect(question.title).toBe(fillCopy(`homeQuiz.${question.id}.title`));
      expect(question.title.endsWith('?')).toBe(true);
      for (const o of question.options) {
        expect(o.label).toBe(fillCopy(`homeQuiz.${question.id}.${o.value}`));
        expect(o.emoji.length).toBeGreaterThan(0);
        labels.push(o.label);
      }
    }
    expect(new Set(labels).size).toBe(labels.length);
    for (const text of [...labels, ...q.map((x) => x.title)]) {
      for (const { pattern } of FORBIDDEN_TERMS) expect(text, String(pattern)).not.toMatch(pattern);
    }
  });

  it('mỗi lần gọi trả bản mới, sửa bản này không ảnh hưởng bản sau', () => {
    const a = homeQuizQuestions();
    a[0]!.options.length = 0;
    expect(homeQuizQuestions()[0]!.options).toHaveLength(2);
  });
});

describe('pickKitProducts: lọc món bán được', () => {
  it('bỏ món ngừng bán, hết hàng, giá 0 hoặc âm', () => {
    const rows = [
      p('off', 'Nước rửa chén Bồ Hòn', { isActive: false }),
      p('out', 'Nước rửa chén Bồ Hòn', { inStock: false }),
      p('zero', 'Nước rửa chén Bồ Hòn', { basePrice: 0 }),
      p('neg', 'Nước rửa chén Bồ Hòn', { basePrice: -5 }),
      p('ok', 'Nước rửa chén Bồ Hòn', { basePrice: 59_000 }),
    ];
    expect(ids(pickKitProducts(base, rows))).toEqual(['ok']);
  });

  it('thiếu trường tuỳ chọn thì coi là còn bán', () => {
    expect(ids(pickKitProducts(base, [p('a', 'Nước rửa chén')]))).toEqual(['a']);
  });

  it('không có món nào bán được hoặc danh sách rỗng thì trả []', () => {
    expect(pickKitProducts(base, [])).toEqual([]);
    expect(pickKitProducts(base, [p('a', 'Nước rửa chén', { inStock: false }), p('b', 'Nước rửa chén', { isActive: false })])).toEqual([]);
  });

  it('chỉ một món bán được thì trả đúng một món, không bịa', () => {
    expect(ids(pickKitProducts(base, [p('a', 'Sản phẩm lạ'), p('b', 'X', { inStock: false })]))).toEqual(['a']);
  });
});

describe('pickKitProducts: xếp hạng', () => {
  it('khớp từ khoá của câu trả lời thắng món không khớp', () => {
    const rows = [p('lam', 'Lau kính'), p('chen', 'Nước rửa chén Bồ Hòn'), p('sa', 'Gel tắm')];
    expect(ids(pickKitProducts(base, rows))[0]).toBe('chen');
  });

  it('tên trọng số cao hơn danh mục/thẻ, danh mục cao hơn mô tả', () => {
    const rows = [
      p('desc', 'Sản phẩm A', { description: 'sạch dầu mỡ bám dai' }),
      p('meta', 'Sản phẩm B', { tags: ['dầu mỡ'] }),
      p('name', 'Sản phẩm dầu mỡ'),
    ];
    expect(ids(pickKitProducts({ ...base }, rows, 3))).toEqual(['name', 'meta', 'desc']);
  });

  it('chọn Refill thì món Refill/túi đứng trước món chai dù món chai khớp nỗi lo', () => {
    const rows = [p('chai', 'Nước rửa chén Bồ Hòn chai vòi'), p('refill', 'Nước rửa chén Bồ Hòn túi Refill')];
    expect(ids(pickKitProducts({ ...base, format: 'refill' }, rows))[0]).toBe('refill');
    expect(ids(pickKitProducts({ ...base, format: 'bottle' }, rows))[0]).toBe('chai');
  });

  it('bằng điểm thì món nổi bật, rồi bán chạy, rồi thứ tự đầu vào', () => {
    const rows = [
      p('c', 'Nước rửa chén', { sold: 5 }),
      p('d', 'Nước rửa chén', { sold: 50 }),
      p('b', 'Nước rửa chén', { isFeatured: true, sold: 1 }),
      p('a', 'Nước rửa chén', { sold: 50 }),
    ];
    expect(ids(pickKitProducts(base, rows, 4))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('hạng không đổi khi đảo thứ tự đầu vào của món khác điểm', () => {
    const rows = [p('lam', 'Lau kính'), p('chen', 'Nước rửa chén Bồ Hòn'), p('tay', 'Nước rửa tay Bồ Hòn')];
    expect(ids(pickKitProducts(base, rows))[0]).toBe(ids(pickKitProducts(base, [...rows].reverse()))[0]);
  });

  it('tôn trọng max và mặc định 3', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => p(id, 'Nước rửa chén'));
    expect(pickKitProducts(base, rows)).toHaveLength(3);
    expect(pickKitProducts(base, rows, 2)).toHaveLength(2);
    expect(pickKitProducts(base, rows, 1)).toHaveLength(1);
    expect(pickKitProducts(base, rows, 0)).toEqual([]);
  });
});

describe('pickKitProducts: bỏ dấu và nguyên từ', () => {
  it('khớp không phân biệt dấu và hoa thường', () => {
    expect(ids(pickKitProducts(base, [p('x', 'Lau kính'), p('y', 'TẨY DẦU MỠ bếp')]))[0]).toBe('y');
    expect(ids(pickKitProducts(base, [p('x', 'Lau kính'), p('y', 'tay dau mo bep')]))[0]).toBe('y');
    expect(ids(pickKitProducts({ ...base, worry: 'strong_scent' }, [p('x', 'Lau kính'), p('y', 'Tinh dầu Tràm')]))[0]).toBe('y');
  });

  it('khớp nguyên từ: "tui" không dính "tuyệt", "chai" không dính "chaitea"', () => {
    const r = { ...base, format: 'refill' } as const;
    expect(ids(pickKitProducts(r, [p('a', 'Tuyệt vời'), p('b', 'Túi Refill')]))[0]).toBe('b');
    const rows = [p('a', 'Chaitea set'), p('b', 'Chai vòi')];
    expect(ids(pickKitProducts(base, rows))[0]).toBe('b');
  });

  it('chữ đ xử lý đúng: "dầu mỡ" và "đầu mỡ" không bị nhầm', () => {
    const a = pickKitProducts(base, [p('dau', 'Tẩy dầu mỡ'), p('dau2', 'Đầu mỡ lạ')]);
    expect(ids(a)[0]).toBe('dau');
  });
});

describe('pickKitProducts: bổ sung đủ 2 món', () => {
  it('dưới 2 món khớp thì thêm món nổi bật, bán chạy còn hàng', () => {
    const rows = [
      p('hit', 'Nước rửa chén Bồ Hòn'),
      p('lam', 'Lau kính', { sold: 3 }),
      p('top', 'Gel tắm', { isFeatured: true }),
      p('bán chạy', 'Dầu gội', { sold: 99 }),
    ];
    expect(ids(pickKitProducts(base, rows))).toEqual(['hit', 'top']);
  });

  it('không món nào khớp thì lấy 2 món nổi bật hoặc bán chạy, không phải tất cả', () => {
    const rows = [p('a', 'X', { sold: 1 }), p('b', 'Y', { sold: 9 }), p('c', 'Z', { isFeatured: true }), p('d', 'W')];
    expect(ids(pickKitProducts(base, rows))).toEqual(['c', 'b']);
  });

  it('món bổ sung vẫn phải bán được', () => {
    const rows = [p('hit', 'Nước rửa chén'), p('off', 'X', { isFeatured: true, inStock: false }), p('ok', 'Y', { sold: 2 })];
    expect(ids(pickKitProducts(base, rows))).toEqual(['hit', 'ok']);
  });

  it('đã đủ 2 món khớp thì không bổ sung món nổi bật không khớp', () => {
    const rows = [p('a', 'Nước rửa chén'), p('b', 'Tẩy dầu mỡ'), p('top', 'Gel tắm', { isFeatured: true, sold: 999 })];
    expect(ids(pickKitProducts(base, rows))).toEqual(expect.arrayContaining(['a', 'b']));
    expect(ids(pickKitProducts(base, rows))).not.toContain('top');
  });

  it('max 1 chỉ bổ sung tới 1 món', () => {
    expect(pickKitProducts(base, [p('a', 'X'), p('b', 'Y')], 1)).toHaveLength(1);
  });
});

describe('pickKitProducts: tính chất chung', () => {
  const catalog: KitProduct[] = [
    p('chen', 'Nước rửa chén Bồ Hòn', { sold: 40, isFeatured: true }),
    p('refill', 'Nước rửa chén Bồ Hòn túi Refill', { sold: 20 }),
    p('tay', 'Nước rửa tay hữu cơ dịu nhẹ', { sold: 30 }),
    p('san', 'Nước lau sàn tinh dầu sả chanh'),
    p('kinh', 'Nước lau kính', { sold: 5 }),
    p('het', 'Nước rửa chén cũ', { inStock: false }),
  ];

  it('mọi tổ hợp 12 câu trả lời đều cho 2 đến 3 món, không trùng, đều bán được', () => {
    for (const a of ALL) {
      const out = pickKitProducts(a, catalog);
      expect(out.length, JSON.stringify(a)).toBeGreaterThanOrEqual(2);
      expect(out.length).toBeLessThanOrEqual(3);
      expect(new Set(ids(out)).size).toBe(out.length);
      expect(ids(out)).not.toContain('het');
    }
  });

  it('xác định được và không sửa mảng đầu vào hay món trong đó', () => {
    const frozen = catalog.map((x) => Object.freeze({ ...x }));
    const input = Object.freeze([...frozen]);
    const a = pickKitProducts(base, input);
    const b = pickKitProducts(base, input);
    expect(ids(a)).toEqual(ids(b));
    expect(input).toHaveLength(catalog.length);
    for (const row of a) expect(frozen).toContain(row);
  });

  it('trả đúng đối tượng gốc (giữ nguyên kiểu T) để nơi gọi dùng tiếp slug, ảnh, giá', () => {
    const cards: ProductCard[] = [
      { id: '1', slug: 'nuoc-rua-chen', brand: 'TubuTree', name: 'Nước rửa chén Bồ Hòn', thumbnail: null, basePrice: 59_000, salePrice: null, isFeatured: true, sold: 10, inStock: true },
      { id: '2', slug: 'lau-san', brand: 'TubuTree', name: 'Nước lau sàn', thumbnail: null, basePrice: 49_000, salePrice: null, isFeatured: false, inStock: true },
    ];
    const out: ProductCard[] = pickKitProducts(base, cards);
    expect(out.map((c) => c.slug)).toEqual(['nuoc-rua-chen', 'lau-san']);
    expect(out[0]).toBe(cards[0]);
  });

  it('category và tags null không làm hỏng', () => {
    expect(ids(pickKitProducts(base, [p('a', 'Nước rửa chén', { category: null, tags: null, shortDesc: null, description: null })]))).toEqual(['a']);
  });
});
