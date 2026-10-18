// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClaimRow } from './dealer-claims-tab';
import { flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminDealerRewardClaim } from '@/lib/admin-client';

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.restoreAllMocks();
});

const claim = (status: AdminDealerRewardClaim['status']): AdminDealerRewardClaim => ({
  id: 'c1',
  userId: 'd1',
  rewardId: 'r1',
  periodKey: 'Q3/2026',
  rewardTitle: 'Tour Đà Lạt',
  rewardType: 'TOUR',
  rewardPeriod: 'QUARTER',
  threshold: 100_000_000,
  volumeAtClaim: 120_000_000,
  note: null,
  status,
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  paidBy: null,
  paidAt: null,
  adminNote: null,
  createdAt: '2026-10-01T00:00:00.000Z',
});

async function labels(status: AdminDealerRewardClaim['status'], canReview?: boolean) {
  const r = render(
    <QueryClientProvider client={new QueryClient()}>
      <ClaimRow claim={claim(status)} canReview={canReview} />
    </QueryClientProvider>,
  );
  mounted.push(r);
  await flush();
  return [...r.container.querySelectorAll('button')].map((b) => b.textContent ?? '');
}

describe('ClaimRow — nút theo quyền (B18)', () => {
  it('ADMIN: duyệt, từ chối, đã trao, mở lại như cũ', async () => {
    expect(await labels('PENDING')).toEqual(['Duyệt', 'Từ chối']);
    expect(await labels('APPROVED')).toEqual(['Đã trao thưởng']);
    expect(await labels('REJECTED')).toEqual(['Mở lại yêu cầu']);
  });

  it('KE_TOAN (canReview=false): chỉ có "Đã trao thưởng" trên yêu cầu đã duyệt; không duyệt, từ chối, mở lại', async () => {
    expect(await labels('PENDING', false)).toEqual([]);
    expect(await labels('APPROVED', false)).toEqual(['Đã trao thưởng']);
    expect(await labels('REJECTED', false)).toEqual([]);
    expect(await labels('PAID', false)).toEqual([]);
  });
});
