import { describe, expect, it } from 'vitest';
import type { GreenCornerItem } from '@tubutree/shared-types';
import { ECO_TAG_OPTIONS, ecoTagLabel, ecoTagLine, ecoTagLocked, greenCornerCards, toggleEcoTag } from './green-corner';

const item = (id: string, over: Partial<GreenCornerItem> = {}): GreenCornerItem => ({
  id,
  rating: 5,
  comment: 'Khăn mềm',
  image: `/reviews/${id}/images/0?v=0123456789`,
  author: 'Lan N.',
  ecoTags: ['soft'],
  product: { slug: `sp-${id}`, name: `Sản phẩm ${id}` },
  ...over,
});

describe('thẻ cảm nhận', () => {
  it('đủ sáu thẻ chủ duyệt, có chữ cho từng khoá', () => {
    expect(ECO_TAG_OPTIONS.map(ecoTagLabel)).toEqual(['Mềm mịn', 'Không bụi', 'Tiết kiệm', 'An toàn cho bé', 'Mùi dịu nhẹ', 'Ít nhựa']);
  });

  it('dòng chữ dưới đánh giá: bỏ khoá lạ và trùng, tối đa 3, null khi trống', () => {
    expect(ecoTagLine(['baby_safe', 'x', 'baby_safe', 'saving'])).toBe('An toàn cho bé · Tiết kiệm');
    expect(ecoTagLine(['soft', 'dust_free', 'saving', 'less_plastic'])).toBe('Mềm mịn · Không bụi · Tiết kiệm');
    expect(ecoTagLine([])).toBeNull();
    expect(ecoTagLine(undefined)).toBeNull();
  });

  it('bấm thẻ: thêm, bỏ; đủ 3 thì thẻ khác bị khoá và bấm không ăn', () => {
    let sel = toggleEcoTag([], 'soft');
    sel = toggleEcoTag(sel, 'saving');
    sel = toggleEcoTag(sel, 'baby_safe');
    expect(sel).toEqual(['soft', 'saving', 'baby_safe']);
    expect(ecoTagLocked(sel, 'less_plastic')).toBe(true);
    expect(ecoTagLocked(sel, 'soft')).toBe(false);
    expect(toggleEcoTag(sel, 'less_plastic')).toEqual(sel);
    expect(toggleEcoTag(sel, 'saving')).toEqual(['soft', 'baby_safe']);
  });
});

describe('greenCornerCards', () => {
  it('cờ tắt, API cũ, lỗi → không vẽ', () => {
    expect(greenCornerCards({ enabled: false, items: [item('a'), item('b'), item('c')] })).toEqual([]);
    expect(greenCornerCards(undefined)).toEqual([]);
    expect(greenCornerCards({ enabled: true } as never)).toEqual([]);
  });

  it('dưới 3 đánh giá ảnh đã duyệt → không vẽ (tránh góc bỏ hoang)', () => {
    expect(greenCornerCards({ enabled: true, items: [item('a'), item('b')] })).toEqual([]);
  });

  it('đủ 3: thẻ mang ảnh, dòng thẻ cảm nhận, sản phẩm và nhãn đọc; bỏ mục thiếu ảnh', () => {
    const cards = greenCornerCards({ enabled: true, items: [item('a', { ecoTags: ['baby_safe', 'nope'] as never }), item('b'), item('c'), item('d', { image: '' })] });
    expect(cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(cards[0]).toMatchObject({
      image: '/reviews/a/images/0?v=0123456789',
      tagLine: 'An toàn cho bé',
      productSlug: 'sp-a',
      productName: 'Sản phẩm a',
      label: 'Sản phẩm a, Lan N. đánh giá 5 sao',
    });
  });
});
