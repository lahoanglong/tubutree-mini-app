import { describe, expect, it } from 'vitest';
import { nextPageParam, uniqueByKey } from './keyset-paging';

const meta = (over: Record<string, unknown>) => ({ meta: { page: 1, limit: 20, total: 50, ...over } });

describe('nextPageParam', () => {
  it('API cũ không có nextCursor: theo offset', () => {
    expect(nextPageParam(meta({}))).toEqual({ page: 2 });
    expect(nextPageParam(meta({ total: 20 }))).toBeUndefined();
  });
  it('có nextCursor: đi theo con trỏ, bất kể tổng', () => {
    expect(nextPageParam(meta({ total: 5, nextCursor: 'C' }))).toEqual({ page: 2, cursor: 'C' });
  });
  it('nextCursor null: hết dữ liệu', () => {
    expect(nextPageParam(meta({ nextCursor: null }))).toBeUndefined();
  });
});

describe('uniqueByKey', () => {
  it('giữ lần đầu của mỗi khoá', () => {
    expect(uniqueByKey([{ c: 'a', n: 1 }, { c: 'b', n: 2 }, { c: 'a', n: 3 }], (r) => r.c)).toEqual([{ c: 'a', n: 1 }, { c: 'b', n: 2 }]);
  });
});
