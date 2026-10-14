import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { invalidateBalances } from './balances';

describe('invalidateBalances (R2-BUYERWEB-3)', () => {
  it('làm mới hồ sơ, ví, sao kê ví và sổ điểm', () => {
    const invalidateQueries = vi.fn();
    invalidateBalances({ invalidateQueries } as unknown as QueryClient);
    expect(invalidateQueries.mock.calls.map((c) => c[0])).toEqual([
      { queryKey: ['me'] },
      { queryKey: ['wallet'] },
      { queryKey: ['wallet-txn'] },
      { queryKey: ['points-txn'] },
    ]);
  });
});
