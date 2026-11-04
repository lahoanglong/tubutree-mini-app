import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { clampTake, PaginationQuery } from './pagination';

describe('clampTake', () => {
  it('thiếu hoặc không phải số → mặc định', () => {
    expect(clampTake(undefined, 100, 200)).toBe(100);
    expect(clampTake('abc', 100, 200)).toBe(100);
    expect(clampTake('', 100, 200)).toBe(100);
  });

  it('kẹp vào [1, max] và làm tròn xuống', () => {
    expect(clampTake('25', 100, 200)).toBe(25);
    expect(clampTake('0', 100, 200)).toBe(1);
    expect(clampTake('-5', 100, 200)).toBe(1);
    expect(clampTake('99999', 100, 200)).toBe(200);
    expect(clampTake('12.9', 100, 200)).toBe(12);
  });
});

describe('PaginationQuery.page', () => {
  const errs = async (plain: Record<string, unknown>) => (await validate(plainToInstance(PaginationQuery, plain))).map((e) => e.property);
  it('page vượt trần 10000 hoặc dạng khoa học → lỗi (trước đây 1e20 làm skip tràn → 500)', async () => {
    expect(await errs({ page: '1e20' })).toContain('page');
    expect(await errs({ page: '10001' })).toContain('page');
  });
  it('page hợp lệ', async () => {
    expect(await errs({ page: '10000' })).toEqual([]);
    expect(await errs({ page: '1' })).toEqual([]);
  });
});
