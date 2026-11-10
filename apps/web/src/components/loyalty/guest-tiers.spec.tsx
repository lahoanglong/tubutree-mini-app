// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactQuery from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), refetch: vi.fn() }));
// Đếm số lần màn gọi `refetch` chứ không đếm lời gọi API: truy vấn chưa có dữ liệu tự gộp các lần tải chồng, nên đếm API không phân biệt được có khoá hay không.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const orig = await importOriginal<typeof ReactQuery>();
  return {
    ...orig,
    useQuery: ((...args: unknown[]) => {
      const result = (orig.useQuery as (...a: unknown[]) => UseQueryResult)(...args);
      return {
        ...result,
        refetch: (...a: Parameters<UseQueryResult['refetch']>) => {
          mocks.refetch();
          return result.refetch(...a);
        },
      };
    }) as typeof orig.useQuery,
  };
});
// ErrorState bản trang còn tự gọi API hotline qua cùng `coreHttp.get`, nên chỉ lời gọi hạng mới được đếm.
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: (path: string) => (path === '/loyalty/preview' ? mocks.preview() : Promise.resolve({ hotline: null })) } }));

import { GuestTiers } from './guest-tiers';

const PREVIEW = {
  rewards: [],
  giftClaimDays: 60,
  claimPoint: null,
  rates: {},
  pointExpireMonths: 12,
  tiers: [{ id: 'MAM_XANH', name: 'Mầm Xanh', minPoints: 0, minSpending: null, multiplier: 1, perks: [] }],
};

let mounted: Rendered | null = null;
beforeEach(() => {
  mocks.preview.mockReset();
  mocks.refetch.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('GuestTiers — "Thử lại" khi tải hạng lỗi', () => {
  it('trả Promise tải lại: hai cú bấm cùng khung hình chỉ tải lại một lần, tải xong thì hiện hạng', async () => {
    let finish!: (v: unknown) => void;
    mocks.preview.mockRejectedValueOnce(new Error('Mất mạng'));
    mocks.preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mounted = render(<GuestTiers returnTo="/tai-khoan/diem-xanh" />);
    await flush(4);
    const retry = mounted.container.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    expect(retry.textContent).toBe('Thử lại');
    await act(async () => {
      click(retry);
      click(retry);
    });
    expect(mocks.refetch).toHaveBeenCalledTimes(1);

    await act(async () => finish(PREVIEW));
    await flush(2);
    expect(mounted.container.textContent).toContain('Mầm Xanh');
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('tải lại lỗi tiếp: nút Thử lại hiện lại và bấm tiếp tải lại được', async () => {
    mocks.preview.mockRejectedValue(new Error('Mất mạng'));
    mounted = render(<GuestTiers returnTo="/tai-khoan/diem-xanh" />);
    await flush(4);
    const retry = () => mounted!.container.querySelector<HTMLButtonElement>('[role="alert"] button')!;
    await act(async () => {
      click(retry());
    });
    await flush(4);
    click(retry());
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
  });
});
