import { describe, expect, it } from 'vitest';
import { cardMetaCompact, cardMetaLine, cardMetaSpoken, formatRating, formatSoldShort, soldCountText } from './card-meta';

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
    expect(formatSoldShort(999_999)).toBe('Đã bán 1tr+');
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

describe('soldCountText: ngưỡng làm tròn', () => {
  it('không in 1000k+ hay 1000tr+', () => {
    expect(soldCountText(999_949)).toBe('999,9k+');
    expect(soldCountText(999_950)).toBe('1tr+');
    expect(soldCountText(999_999)).toBe('1tr+');
    expect(soldCountText(1_000_000)).toBe('1tr+');
    expect(soldCountText(999_949_999)).toBe('999,9tr+');
    expect(soldCountText(999_950_000)).toBe('1 tỷ+');
    expect(soldCountText(1e9)).toBe('1 tỷ+');
  });
});

describe('cardMetaSpoken', () => {
  it('đọc sao và lượt bán thành chữ, làm tròn xuống theo đơn vị đang hiện', () => {
    expect(cardMetaSpoken({ ratingAvg: 4.8, sold: 1234 })).toBe('4,8 sao, đã bán hơn 1.200');
    expect(cardMetaSpoken({ ratingAvg: 4.8, sold: 52 })).toBe('4,8 sao, đã bán 52');
    expect(cardMetaSpoken({ sold: 2_500_000 })).toBe('đã bán hơn 2.500.000');
  });
  it('thiếu nửa nào bỏ nửa đó, thiếu cả hai là null', () => {
    expect(cardMetaSpoken({ ratingAvg: 4.5 })).toBe('4,5 sao');
    expect(cardMetaSpoken({ sold: 7 })).toBe('đã bán 7');
    expect(cardMetaSpoken({ ratingAvg: Number.NaN, sold: 0 })).toBeNull();
  });
  it('khớp dòng nhìn thấy: có dòng meta thì có bản đọc, và ngược lại', () => {
    for (const p of [{}, { sold: 1 }, { ratingAvg: 3 }, { ratingAvg: 4.2, sold: 999_999 }]) {
      expect(cardMetaSpoken(p) === null).toBe(cardMetaLine(p) === null);
    }
  });
});

describe('cardMetaCompact — bản gọn cho thẻ hẹp (kệ hạng 128px không đủ chỗ cho "★ 4,7 · Đã bán 8,2k+")', () => {
  it('có lượt bán thì chỉ nói lượt bán (kệ hạng nói về doanh số), nguyên chữ "Đã bán" để không mất nghĩa', () => {
    expect(cardMetaCompact({ ratingAvg: 4.7, sold: 8200 })).toBe('Đã bán 8,2k+');
    expect(cardMetaCompact({ ratingAvg: 4.7, sold: 12 })).toBe('Đã bán 12');
    expect(cardMetaCompact({ sold: 2_500_000 })).toBe('Đã bán 2,5tr+');
  });
  it('chưa có lượt bán thì còn sao; không có gì thì null (thẻ giữ chỗ chứ không in dòng rỗng)', () => {
    expect(cardMetaCompact({ ratingAvg: 4.7 })).toBe('★ 4,7');
    expect(cardMetaCompact({ ratingAvg: 4.7, sold: 0 })).toBe('★ 4,7');
    expect(cardMetaCompact({})).toBeNull();
    expect(cardMetaCompact({ ratingAvg: 0, sold: 0 })).toBeNull();
    expect(cardMetaCompact({ ratingAvg: Number.NaN, sold: Number.NaN })).toBeNull();
  });
  it('có bản gọn khi và chỉ khi có bản đầy đủ (khớp cardMetaLine)', () => {
    for (const p of [{}, { sold: 1 }, { ratingAvg: 3 }, { ratingAvg: 4.2, sold: 999_999 }, { ratingAvg: Number.NaN, sold: 5 }]) {
      expect(cardMetaCompact(p) === null).toBe(cardMetaLine(p) === null);
    }
  });
  it('luôn ngắn hơn bản đầy đủ khi có đủ cả hai nửa, và ≤ 14 ký tự với lượt bán dưới 1 triệu (vừa 112px)', () => {
    for (const sold of [1, 9, 12, 999, 1000, 1234, 8200, 99_900, 999_949]) {
      const compact = cardMetaCompact({ ratingAvg: 5, sold })!;
      expect(compact.length, `sold ${sold}`).toBeLessThanOrEqual(14);
      expect(compact.length).toBeLessThan(cardMetaLine({ ratingAvg: 5, sold })!.length);
      expect(compact).toMatch(/^Đã bán \d[\d,]*(k\+|tr\+)?$/);
    }
  });
});
