import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { clampTake, PAGE_TOO_DEEP_MSG, PaginationQuery } from './pagination';
import { createValidationPipe } from './validation-pipe';

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
  it('page vượt trần 1000 hoặc dạng khoa học → lỗi (trước đây 1e20 làm skip tràn → 500; OFFSET sâu quét và bỏ cả chục nghìn dòng)', async () => {
    expect(await errs({ page: '1e20' })).toContain('page');
    expect(await errs({ page: '1001' })).toContain('page');
    expect(await errs({ page: '10000' })).toContain('page');
  });
  it('page hợp lệ', async () => {
    expect(await errs({ page: '1000' })).toEqual([]);
    expect(await errs({ page: '1' })).toEqual([]);
  });
  it('vượt trần thì 400 kèm câu tiếng Việt chỉ cách đi tiếp, không phải câu tiếng Anh của class-validator', async () => {
    const pipe = createValidationPipe();
    const err = await pipe.transform({ page: '1001' }, { type: 'query', metatype: PaginationQuery }).catch((e: BadRequestException) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    const message = (err as BadRequestException).getResponse() as { message: string[] };
    expect(message.message[0]).toBe(PAGE_TOO_DEEP_MSG);
    expect(PAGE_TOO_DEEP_MSG).toMatch(/1000/);
    expect(PAGE_TOO_DEEP_MSG).not.toMatch(/vui lòng|chúng tôi/i);
  });
});
