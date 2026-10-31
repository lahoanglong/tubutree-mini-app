import { describe, expect, it } from 'vitest';
import { tileBodyHeight } from './tile-metrics';

describe('tileBodyHeight', () => {
  it('grid: đệm 8 + nhãn hiệu 16 + tên 44 + 4 + giá 20 + 2 + meta 16 + đệm 8', () => {
    expect(tileBodyHeight('grid', { brand: true })).toBe(118);
    expect(tileBodyHeight('grid', { brand: false })).toBe(102);
  });
  it('rail-md như grid có nhãn hiệu, thêm dòng giá gạch xếp chồng', () => {
    expect(tileBodyHeight('rail-md', { brand: true })).toBe(134);
  });
  it('rank không nhãn hiệu, rail-sm tên caption', () => {
    expect(tileBodyHeight('rank')).toBe(118);
    expect(tileBodyHeight('rail-sm')).toBe(96);
  });
  it('flash thêm 16 khi có note và cộng chiều cao footer', () => {
    expect(tileBodyHeight('flash')).toBe(96);
    expect(tileBodyHeight('flash', { note: true, footer: 28 })).toBe(140);
  });
  it('line cố định 80 (ảnh 64 + 2 x 8)', () => {
    expect(tileBodyHeight('line')).toBe(80);
  });
  it('brand mặc định theo biến thể: grid và rail-md có, còn lại không', () => {
    expect(tileBodyHeight('grid')).toBe(118);
    expect(tileBodyHeight('rail-md')).toBe(134);
  });
});
