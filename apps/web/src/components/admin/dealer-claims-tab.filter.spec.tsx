// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flush, render, type Rendered } from '@/test-utils/dom';

const list = vi.hoisted(() => vi.fn());
vi.mock('@/lib/admin-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listDealerRewardClaims: list,
}));

import { DealerClaimsTab, seedDealerClaimFilter } from './dealer-claims-tab';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  list.mockReset();
});

async function openTab(canReview?: boolean) {
  list.mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20 } });
  const r = render(
    <QueryClientProvider client={new QueryClient()}>
      <DealerClaimsTab canReview={canReview} />
    </QueryClientProvider>,
  );
  mounted.push(r);
  await flush();
  return list.mock.calls[0]?.[0];
}

describe('DealerClaimsTab — hàng mở mặc định', () => {
  it('ADMIN mặc định đứng ở hàng chờ duyệt', async () => {
    expect(await openTab(true)).toBe('PENDING');
  });

  it('kế toán (canReview=false) mặc định đứng ở hàng đã duyệt chờ chi', async () => {
    expect(await openTab(false)).toBe('APPROVED');
  });

  it('thẻ "Thưởng đại lý chờ chi" mở hàng đã duyệt cả với ADMIN, chỉ cho lần mở kế tiếp', async () => {
    seedDealerClaimFilter('APPROVED');
    expect(await openTab(true)).toBe('APPROVED');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    list.mockReset();
    expect(await openTab(true)).toBe('PENDING');
  });
});
