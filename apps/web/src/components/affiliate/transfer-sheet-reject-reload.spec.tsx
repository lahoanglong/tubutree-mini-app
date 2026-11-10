// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { affiliateCommissionsQuery, affiliateDashboardQuery } from '@tubutree/app-core/queries/affiliate';
import { walletQuery } from '@tubutree/app-core/queries/wallet';
import { ApiError, NetworkError } from '@/lib/client-api';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { coreHttp as http } from '@/lib/core-http';

// Chuyển hoa hồng vào Ví bị máy chủ từ chối vì số trên màn đã cũ (lệnh tự chuyển vừa chạy, hồ sơ thuế vừa đổi): tải lại đúng những gì đường thành công làm mới
// rồi mới nhả nút, dashboard SAU Ví, như apps/miniapp/src/pages/affiliate.tsx:1129 (isStaleStateError + settleWithin). Mạng/401/403/5xx nhả ngay.

type Gate = { promise: Promise<void>; release: () => void };
const newGate = (): Gate => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

const state = vi.hoisted(() => ({
  posts: [] as { path: string; headers?: Record<string, string> }[],
  gets: [] as string[],
  gates: {} as Record<string, Promise<void> | undefined>,
  payout: (() => ({ ok: true })) as () => unknown,
}));

vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.gets.push(path);
      await state.gates[path];
      if (path === '/config/public') return {};
      if (path === '/me/wallet') return { walletBalance: 0 };
      if (path === '/affiliate/dashboard') return {};
      return [];
    },
    post: async (path: string, _body?: unknown, opts?: { headers?: Record<string, string> }) => {
      state.posts.push({ path, headers: opts?.headers });
      return state.payout();
    },
  },
}));

import { TransferSheet } from './transfer-sheet';

let mounted: Rendered[] = [];
let client: QueryClient;
const done = vi.fn();

/** Giữ các truy vấn của trang CTV đang hiện phía sau sheet: chỉ truy vấn có người xem mới tải lại ngay khi bị đánh dấu cũ. */
function Page() {
  useQuery(affiliateDashboardQuery(http));
  useQuery({ queryKey: affiliateCommissionsQuery(http).queryKey, queryFn: () => http.get('/affiliate/commissions') });
  useQuery(walletQuery(http));
  return <TransferSheet open onClose={() => {}} max={80_000} knownMax taxIdOnFile="0123456789" onDone={done} />;
}
const mount = async () => {
  const r = render(<Page />, client);
  mounted.push(r);
  await flush(6);
};
const dialog = () => document.querySelector('[role="dialog"]')!;
const submitBtn = () => Array.from(dialog().querySelectorAll('button')).find((b) => /^(Nhận |Đang gửi)/.test(b.textContent ?? '')) as HTMLButtonElement;
const busy = () => submitBtn().getAttribute('aria-busy') === 'true';
const count = (path: string) => state.gets.filter((p) => p === path).length;
const hold = (...paths: string[]) => {
  const gate = newGate();
  for (const p of paths) state.gates[p] = gate.promise;
  return {
    release: () => {
      for (const p of paths) delete state.gates[p];
      gate.release();
    },
  };
};
const REJECTIONS = [400, 404, 409, 422] as const;

beforeEach(() => {
  state.posts = [];
  state.gets = [];
  state.gates = {};
  state.payout = () => ({ ok: true });
  done.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } } });
});
afterEach(() => {
  vi.useRealTimers();
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('TransferSheet — chuyển hoa hồng bị từ chối', () => {
  it.each(REJECTIONS)('%i: lời lỗi hiện ngay, tải lại hoa hồng, Ví và dashboard; nút giữ bận tới khi về, rồi gửi lại cùng Idempotency-Key', async (status) => {
    state.payout = () => {
      throw new ApiError('Số dư hoa hồng khả dụng không đủ.', status);
    };
    await mount();
    for (const key of [['affiliate-payouts'], ['affiliate-tax-statement'], ['affiliate-me']]) client.setQueryData(key, []);
    const before = { dash: count('/affiliate/dashboard'), comm: count('/affiliate/commissions'), wallet: count('/me/wallet') };
    const gate = hold('/affiliate/dashboard', '/affiliate/commissions', '/me/wallet');
    click(submitBtn());
    await flush();
    expect(dialog().textContent).toContain('Số dư hoa hồng khả dụng không đủ.');
    expect(count('/affiliate/commissions')).toBe(before.comm + 1);
    expect(count('/me/wallet')).toBe(before.wallet + 1);
    for (const key of [['affiliate-payouts'], ['affiliate-tax-statement'], ['affiliate-me']]) expect(client.getQueryState(key)?.isInvalidated, key[0]).toBe(true);
    expect(busy()).toBe(true);
    expect(submitBtn().disabled).toBe(false);
    await act(async () => {
      click(submitBtn());
      click(submitBtn());
    });
    expect(state.posts).toHaveLength(1);
    gate.release();
    await flush(8);
    expect(count('/affiliate/dashboard')).toBe(before.dash + 1);
    expect(busy()).toBe(false);
    state.payout = () => ({ ok: true });
    click(submitBtn());
    await flush();
    expect(state.posts).toHaveLength(2);
    expect(state.posts[1]!.headers?.['Idempotency-Key']).toBe(state.posts[0]!.headers?.['Idempotency-Key']);
  });

  it('dashboard tải lại SAU Ví: Ví còn treo thì dashboard chưa được hỏi (số to không nhảy hai lần)', async () => {
    state.payout = () => {
      throw new ApiError('Số dư hoa hồng khả dụng không đủ.', 409);
    };
    await mount();
    const dashBefore = count('/affiliate/dashboard');
    const gate = hold('/me/wallet');
    click(submitBtn());
    await flush();
    expect(count('/affiliate/dashboard')).toBe(dashBefore);
    gate.release();
    await flush(8);
    expect(count('/affiliate/dashboard')).toBe(dashBefore + 1);
  });

  it.each([401, 403, 500, 503])('%i: không tải lại gì, nhả nút ngay, giữ lời lỗi', async (status) => {
    state.payout = () => {
      throw new ApiError('Máy chủ bận.', status);
    };
    await mount();
    const before = state.gets.length;
    click(submitBtn());
    await flush();
    expect(state.gets).toHaveLength(before);
    expect(busy()).toBe(false);
    expect(dialog().querySelector('[role="alert"]')?.textContent).not.toBe('');
  });

  it('mất mạng: không tải lại, nhả ngay', async () => {
    state.payout = () => {
      throw new NetworkError(false);
    };
    await mount();
    const before = state.gets.length;
    click(submitBtn());
    await flush();
    expect(state.gets).toHaveLength(before);
    expect(busy()).toBe(false);
  });

  it('tải lại treo quá 4 giây thì nhả nút', async () => {
    state.payout = () => {
      throw new ApiError('Số dư hoa hồng khả dụng không đủ.', 400);
    };
    await mount();
    hold('/me/wallet');
    vi.useFakeTimers();
    click(submitBtn());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_900);
    });
    expect(busy()).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(busy()).toBe(false);
  });

  it('sheet không đóng được trong lúc tải lại, đóng được khi nút đã nhả', async () => {
    state.payout = () => {
      throw new ApiError('Số dư hoa hồng khả dụng không đủ.', 409);
    };
    await mount();
    const gate = hold('/me/wallet');
    click(submitBtn());
    await flush();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    gate.release();
    await flush(8);
    expect(busy()).toBe(false);
  });
});
