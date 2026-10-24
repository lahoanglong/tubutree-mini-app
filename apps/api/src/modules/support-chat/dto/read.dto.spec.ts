import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReadDto } from './read.dto';

const errs = (o: object) => validateSync(plainToInstance(ReadDto, o));

describe('ReadDto', () => {
  it('rỗng, chỉ upToId, chỉ ids, hoặc cả hai đều hợp lệ', () => {
    expect(errs({})).toHaveLength(0);
    expect(errs({ upToId: 'm1' })).toHaveLength(0);
    expect(errs({ ids: ['m1', 'm2'] })).toHaveLength(0);
    expect(errs({ ids: ['m1'], upToId: 'm1' })).toHaveLength(0);
  });
  it('ids tối đa 100 phần tử, mỗi phần tử chuỗi không rỗng tối đa 64 ký tự', () => {
    expect(errs({ ids: Array.from({ length: 100 }, (_, i) => `m${i}`) })).toHaveLength(0);
    expect(errs({ ids: Array.from({ length: 101 }, (_, i) => `m${i}`) })).not.toHaveLength(0);
    expect(errs({ ids: [''] })).not.toHaveLength(0);
    expect(errs({ ids: ['a'.repeat(65)] })).not.toHaveLength(0);
    expect(errs({ ids: [1] })).not.toHaveLength(0);
    expect(errs({ ids: 'm1' })).not.toHaveLength(0);
  });
  it('upToId tối đa 64 ký tự', () => {
    expect(errs({ upToId: 'a'.repeat(65) })).not.toHaveLength(0);
  });
});
