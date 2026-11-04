import { describe, expect, it } from 'vitest';
import { nextPageParam } from './keyset-paging';

const meta = (over: Record<string, unknown>) => ({ meta: { page: 1, limit: 20, total: 50, ...over } }) as Parameters<typeof nextPageParam>[0];

describe('nextPageParam', () => {
  it('có nextCursor → đi theo con trỏ', () => {
    expect(nextPageParam(meta({ nextCursor: 'abc' }))).toEqual({ page: 2, cursor: 'abc' });
  });
  it('nextCursor null → hết', () => {
    expect(nextPageParam(meta({ nextCursor: null }))).toBeUndefined();
  });
  it('API cũ không có nextCursor → offset theo total', () => {
    expect(nextPageParam(meta({}))).toEqual({ page: 2 });
    expect(nextPageParam(meta({ page: 3 }))).toBeUndefined();
  });
});
