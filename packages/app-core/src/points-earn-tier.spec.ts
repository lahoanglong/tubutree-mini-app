import { describe, expect, it } from 'vitest';
import { multiplierVi, tierEarnNote, tierEarnOf } from './points-earn-tier';

const LOY = { tierMultipliers: { t1: 1, t2: 1.2, t3: 1.25 }, tierNames: { t1: 'Mầm Xanh', t2: 'Lộc Biếc', t3: 'Đại Thụ' } };

describe('multiplierVi', () => {
  it('hệ số: dấu phẩy, tối đa 2 số lẻ, bỏ số 0 thừa', () => {
    expect([1, 1.2, 1.25, 2, 1.5].map(multiplierVi)).toEqual(['1', '1,2', '1,25', '2', '1,5']);
  });
});

describe('tierEarnOf', () => {
  it('có hạng trong bảng: hệ số và tên', () => {
    expect(tierEarnOf(LOY, 't2')).toEqual({ multiplier: 1.2, tierName: 'Lộc Biếc' });
  });
  it('tierId null (chưa có hạng): hệ số 1, kể cả khi chưa có bảng', () => {
    expect(tierEarnOf(undefined, null)).toEqual({ multiplier: 1, tierName: null });
  });
  it('chưa biết: tierId thiếu, bảng thiếu, hạng lạ, hệ số hỏng', () => {
    expect(tierEarnOf(LOY, undefined)).toBeNull();
    expect(tierEarnOf({}, 't2')).toBeNull();
    expect(tierEarnOf(LOY, 'xx')).toBeNull();
    expect(tierEarnOf({ tierMultipliers: { t2: 0 } }, 't2')).toBeNull();
  });
});

describe('tierEarnNote', () => {
  it('hạng có hệ số khác 1: nêu hạng và hệ số', () => {
    expect(tierEarnNote(tierEarnOf(LOY, 't2'))).toBe('hạng Lộc Biếc ×1,2');
    expect(tierEarnNote(tierEarnOf(LOY, 't3'))).toBe('hạng Đại Thụ ×1,25');
  });
  it('hệ số 1 hoặc chưa biết: không giải thích', () => {
    expect(tierEarnNote(tierEarnOf(LOY, 't1'))).toBeNull();
    expect(tierEarnNote(null)).toBeNull();
    expect(tierEarnNote({ multiplier: 1.2, tierName: null })).toBeNull();
  });
});
