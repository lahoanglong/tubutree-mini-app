import { describe, expect, it } from 'vitest';
import { cartSaving, lineCompareAt, lineSaving, pdpShelves, pickQuickReviews } from './pdp-view';

describe('lineSaving / lineCompareAt', () => {
  it('niêm yết cao hơn giá bán: tiết kiệm = chênh × số lượng, gạch giá niêm yết', () => {
    const line = { unitPrice: 33_000, listUnitPrice: 50_000, quantity: 2 };
    expect(lineSaving(line)).toBe(34_000);
    expect(lineCompareAt(line)).toBe(50_000);
  });

  it.each([
    ['API cũ chưa trả listUnitPrice', undefined],
    ['listUnitPrice null', null],
    ['bằng giá bán', 33_000],
    ['thấp hơn giá bán (giá niêm yết hạ sau khi thêm)', 20_000],
  ])('%s: không gạch, không tiết kiệm', (_name, list) => {
    const line = { unitPrice: 33_000, listUnitPrice: list, quantity: 3 };
    expect(lineSaving(line)).toBe(0);
    expect(lineCompareAt(line)).toBeNull();
  });

  it('cartSaving cộng các dòng đang giảm, bỏ qua dòng không giảm', () => {
    expect(
      cartSaving([
        { unitPrice: 33_000, listUnitPrice: 50_000, quantity: 1 },
        { unitPrice: 10_000, listUnitPrice: 10_000, quantity: 5 },
        { unitPrice: 90_000, listUnitPrice: 100_000, quantity: 2 },
      ]),
    ).toBe(37_000);
    expect(cartSaving([])).toBe(0);
  });
});

const review = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  rating: 5,
  comment: `Chữ ${id}`,
  images: [] as string[],
  videoUrl: null as string | null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('pickQuickReviews', () => {
  it('bỏ đánh giá không chữ, đánh giá có ảnh lên trước, cắt 2', () => {
    const picked = pickQuickReviews([
      review('a', { createdAt: '2026-10-05T00:00:00.000Z' }),
      review('b', { comment: null, images: ['x.jpg'] }),
      review('c', { images: ['y.jpg'], createdAt: '2026-09-01T00:00:00.000Z' }),
      review('d', { comment: '   ' }),
      review('e', { videoUrl: 'v.mp4', createdAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(picked.map((r) => r.id)).toEqual(['c', 'e']);
  });

  it('không có ảnh thì lấy mới nhất; ít hơn 2 thì trả đúng số có; rỗng thì rỗng', () => {
    expect(pickQuickReviews([review('a'), review('b', { createdAt: '2026-10-09T00:00:00.000Z' }), review('c')]).map((r) => r.id)).toEqual(['b', 'a']);
    expect(pickQuickReviews([review('a')]).map((r) => r.id)).toEqual(['a']);
    expect(pickQuickReviews([])).toEqual([]);
  });
});

const p = (id: string) => ({ id });
const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => p(`${prefix}${i}`));

describe('pdpShelves', () => {
  it('loại món đang xem khỏi mọi dải', () => {
    const out = pdpShelves({ currentId: 'cur', boughtTogether: [p('cur'), ...many('b', 3)], brand: [p('cur'), p('x')], feed: [p('cur'), ...many('f', 5)] });
    for (const list of [out.boughtTogether, out.brand, out.feed]) expect(list.map((x) => x.id)).not.toContain('cur');
  });

  it('khách thường mua cùng dưới 3 món thì ẩn; feed dưới 4 món thì ẩn', () => {
    const out = pdpShelves({ currentId: 'cur', boughtTogether: many('b', 2), brand: [], feed: many('f', 3) });
    expect(out.boughtTogether).toEqual([]);
    expect(out.feed).toEqual([]);
  });

  it('feed bỏ món đã ở dải trên và ở "Cùng nhà", cắt 20; "Cùng nhà" cắt 8', () => {
    const together = many('b', 4);
    const brand = [...many('n', 10), together[0]!];
    const feed = [together[1]!, brand[0]!, ...many('f', 30)];
    const out = pdpShelves({ currentId: 'cur', boughtTogether: together, brand, feed });
    expect(out.brand).toHaveLength(8);
    expect(out.brand.map((x) => x.id)).not.toContain('b0');
    expect(out.feed).toHaveLength(20);
    const ids = out.feed.map((x) => x.id);
    expect(ids).not.toContain('b1');
    expect(ids).not.toContain('n0');
  });

  it('API trả sai dạng (không phải mảng): dải đó rỗng, không ném lỗi, dải còn lại vẫn đủ', () => {
    const bad = { error: 'x' } as unknown as { id: string }[];
    const out = pdpShelves({ currentId: 'cur', boughtTogether: bad, brand: null as unknown as { id: string }[], feed: many('f', 5) });
    expect(out.boughtTogether).toEqual([]);
    expect(out.brand).toEqual([]);
    expect(out.feed).toHaveLength(5);
  });
});
