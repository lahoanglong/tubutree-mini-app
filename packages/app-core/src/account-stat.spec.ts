import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STAT_NARROW_CELL_PX,
  STAT_VALUE_LINE_HEIGHT,
  STAT_VALUE_LOOKS,
  STAT_VALUE_SIZE_PX,
  statValueFits,
  statValueStart,
  statValueVariant,
} from './account-stat';

describe('statValueVariant: chưa đo được ô thì chọn theo ô 93px ở 320px (vừa một dòng, cách mép ô)', () => {
  it('tới 8 ký tự giữ price-md', () => {
    expect(statValueVariant('0đ')).toBe('price-md');
    expect(statValueVariant('50.000đ')).toBe('price-md');
    expect(statValueVariant('999.999đ')).toBe('price-md');
    expect(statValueVariant('999 điểm')).toBe('price-md');
    expect(statValueVariant('2 mã')).toBe('price-md');
    expect(statValueVariant('—')).toBe('price-md');
  });

  it('9–10 ký tự xuống price-sm: Điểm Xanh từ 1.000 điểm (trước đây gãy "điểm" xuống dòng), ví từ một triệu', () => {
    expect(statValueVariant('1.000 điểm')).toBe('price-sm');
    expect(statValueVariant('9.999 điểm')).toBe('price-sm');
    expect(statValueVariant('1.000.000đ')).toBe('price-sm');
    expect(statValueVariant('9.999.999đ')).toBe('price-sm');
  });

  it('từ 11 ký tự xuống label 12px: ví 10 triệu tới 100 triệu (trước đây tràn 4px ở 320px), điểm từ 10.000', () => {
    expect(statValueVariant('10.000.000đ')).toBe('label');
    expect(statValueVariant('99.999.999đ')).toBe('label');
    expect(statValueVariant('100.000.000đ')).toBe('label');
    expect(statValueVariant('12.345 điểm')).toBe('label');
    expect(statValueVariant('999.999 điểm')).toBe('label');
    expect(statValueVariant('1.234.567 điểm')).toBe('label');
  });

  it('đếm theo ký tự hiển thị, bỏ khoảng trắng hai đầu', () => {
    expect(statValueVariant(' 999.999đ ')).toBe('price-md');
    expect(statValueVariant('9.999 điểm')).toBe(statValueVariant('9.999 điểm'.normalize('NFC')));
  });

  it('bề ngang 0, âm hay thiếu (jsdom, máy chủ dựng trang) như ô 320px', () => {
    for (const w of [undefined, 0, -1, Number.NaN]) {
      expect(statValueVariant('1.000 điểm', w)).toBe('price-sm');
      expect(statValueVariant('10.000.000đ', w)).toBe('label');
    }
    expect(statValueVariant('1.000 điểm', STAT_NARROW_CELL_PX)).toBe('price-sm');
  });

  it('dãy cỡ từ lớn tới nhỏ: chỉ cỡ label khít chữ, bước cuối khít hơn', () => {
    expect(STAT_VALUE_LOOKS).toEqual([
      { variant: 'price-md' },
      { variant: 'price-sm' },
      { variant: 'label', letterSpacing: '-0.02em' },
      { variant: 'label', letterSpacing: '-0.04em' },
    ]);
  });

  it('statValueStart: bước đầu theo ước lượng (app đo chữ thật rồi lùi bước)', () => {
    expect(statValueStart('999.999đ')).toBe(0);
    expect(statValueStart('1.000 điểm')).toBe(1);
    expect(statValueStart('100.000.000đ')).toBe(2);
    expect(statValueStart('100.000.000đ', 124.67)).toBe(0);
  });

  it('statValueFits: chữ cách mép ô ít nhất 6px mỗi bên', () => {
    expect(statValueFits(81.33, 93.33)).toBe(true);
    expect(statValueFits(83.14, 93.33)).toBe(false);
    expect(statValueFits(119, 124.67)).toBe(false);
    expect(statValueFits(104, 124.67)).toBe(true);
  });

  it('chiều cao dòng cố định theo dòng price-md cho mọi cỡ', () => {
    expect(STAT_VALUE_LINE_HEIGHT).toBe('calc(var(--type-price-md-size) * var(--type-price-md-lh))');
  });
});

// Ô rộng hơn 320px thì giữ cỡ lớn khi còn chỗ: Mini/web 375px (ô ~112px), 414px (ô ~125px), web từ md (ô ~210px).
describe('statValueVariant: theo bề ngang thật của ô', () => {
  it('375px (ô 111,67px): tới 10 ký tự price-md, 11–12 ký tự price-sm', () => {
    expect(statValueVariant('1.000 điểm', 111.67)).toBe('price-md');
    expect(statValueVariant('9.999.999đ', 111.67)).toBe('price-md');
    expect(statValueVariant('10.000.000đ', 111.67)).toBe('price-sm');
    expect(statValueVariant('100.000.000đ', 111.67)).toBe('price-sm');
    expect(statValueVariant('999.999 điểm', 111.67)).toBe('price-sm');
    expect(statValueVariant('1.234.567 điểm', 111.67)).toBe('label');
  });

  it('414px (ô 124,67px): tới 12 ký tự price-md (10 triệu tới 100 triệu, 999.999 điểm)', () => {
    for (const v of ['10.000 điểm', '10.000.000đ', '100.000.000đ', '999.999 điểm']) expect(statValueVariant(v, 124.67), v).toBe('price-md');
    expect(statValueVariant('1.000.000.000', 124.67)).toBe('price-sm');
    expect(statValueVariant('1.234.567 điểm', 124.67)).toBe('label');
  });

  it('web từ md (ô ~210px): giữ price-md cho mọi số thường gặp', () => {
    for (const v of ['1.000 điểm', '1.234.567 điểm', '100.000.000đ', '1.000.000.000đ']) expect(statValueVariant(v, 210), v).toBe('price-md');
  });

  it('ô hẹp hơn 320px (280px, ô ~80px) thu cỡ sớm hơn', () => {
    expect(statValueVariant('999.999đ', 80)).toBe('price-sm');
    expect(statValueVariant('1.000 điểm', 80)).toBe('label');
  });

  it('cỡ chữ dùng để tính khớp token ở tokens.css', () => {
    const css = readFileSync(resolve(__dirname, '../../design-tokens/src/tokens.css'), 'utf8');
    const px = (name: string) => Number(css.match(new RegExp(`--type-${name}-size:\\s*(\\d+)px`))?.[1]);
    expect(STAT_VALUE_SIZE_PX).toEqual({ 'price-md': px('price-md'), 'price-sm': px('price-sm'), label: px('label') });
  });
});
