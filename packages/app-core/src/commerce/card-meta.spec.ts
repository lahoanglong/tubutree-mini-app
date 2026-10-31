import { describe, expect, it } from 'vitest';
import { cardMetaLine, formatRating, formatSoldShort, soldCountText } from './card-meta';

describe('formatRating', () => {
  it('dấu phẩy thập phân, một chữ số lẻ', () => {
    expect(formatRating(4.8)).toBe('4,8');
    expect(formatRating(5)).toBe('5,0');
  });
  it('kẹp trần 5 sao', () => {
    expect(formatRating(5.7)).toBe('5,0');
  });
  it('số rác hoặc không dương thì rỗng', () => {
    expect(formatRating(Number.NaN)).toBe('');
    expect(formatRating(0)).toBe('');
    expect(formatRating(-1)).toBe('');
  });
});

describe('formatSoldShort — kiểu Shopee (cùng bảng ca với formatSold cũ ở Mini App và web)', () => {
  it('thiếu hoặc không dương thì null', () => {
    for (const v of [null, undefined, 0, -5, Number.NaN]) expect(formatSoldShort(v)).toBeNull();
  });
  it('dưới 1000 hiện nguyên số', () => {
    expect(formatSoldShort(1)).toBe('Đã bán 1');
    expect(formatSoldShort(12)).toBe('Đã bán 12');
    expect(formatSoldShort(999)).toBe('Đã bán 999');
  });
  it('từ 1000 rút gọn k+', () => {
    expect(formatSoldShort(1000)).toBe('Đã bán 1k+');
    expect(formatSoldShort(1200)).toBe('Đã bán 1,2k+');
    expect(formatSoldShort(1234)).toBe('Đã bán 1,2k+');
    expect(formatSoldShort(999_999)).toBe('Đã bán 1000k+');
  });
  it('từ 1 triệu rút gọn tr+', () => {
    expect(formatSoldShort(1_000_000)).toBe('Đã bán 1tr+');
    expect(formatSoldShort(1_500_000)).toBe('Đã bán 1,5tr+');
    expect(formatSoldShort(2_500_000)).toBe('Đã bán 2,5tr+');
  });
});

describe('soldCountText', () => {
  it('chỉ phần số, không tiền tố', () => {
    expect(soldCountText(12)).toBe('12');
    expect(soldCountText(1234)).toBe('1,2k+');
    expect(soldCountText(2_500_000)).toBe('2,5tr+');
    expect(soldCountText(0)).toBeNull();
  });
});

describe('cardMetaLine', () => {
  it('sao và đã bán trên một dòng', () => {
    expect(cardMetaLine({ ratingAvg: 4.8, sold: 1234 })).toBe('★ 4,8 · Đã bán 1,2k+');
  });
  it('chỉ có một nửa thì chỉ hiện nửa đó', () => {
    expect(cardMetaLine({ ratingAvg: 4.8 })).toBe('★ 4,8');
    expect(cardMetaLine({ sold: 12 })).toBe('Đã bán 12');
  });
  it('không có gì thì null để thẻ giữ chỗ chứ không in dòng rỗng', () => {
    expect(cardMetaLine({})).toBeNull();
    expect(cardMetaLine({ ratingAvg: 0, sold: 0 })).toBeNull();
  });
  it('số rác không in "★ NaN" hay "Đã bán 0"', () => {
    expect(cardMetaLine({ ratingAvg: Number.NaN, sold: 5 })).toBe('Đã bán 5');
    expect(cardMetaLine({ ratingAvg: 4.5, sold: Number.NaN })).toBe('★ 4,5');
  });
  it('trường hợp dài nhất thực tế vẫn trong 22 ký tự (ux-copy ước 20, đo thật 21)', () => {
    expect(cardMetaLine({ ratingAvg: 5, sold: 99_900 })!.length).toBeLessThanOrEqual(22);
  });
});
