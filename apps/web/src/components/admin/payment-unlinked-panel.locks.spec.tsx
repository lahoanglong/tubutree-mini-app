// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentUnlinkedPanel } from './payment-unlinked-panel';
import { answerAsk, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

// W96B: "Đã đối chiếu" (gỡ cờ Pancake báo đã thanh toán, ghi tiền về muộn) giữ khoá tới khi lịch sử đơn làm mới về (tối đa 4 giây), nút báo bận bằng
// aria-busy/aria-disabled (không disabled), chạm lại trong khoá không mở hộp ghi chú và không gửi lệnh thứ hai.

const order = (): AdminOrder =>
  ({
    id: 'o1',
    code: 'TB-100',
    status: 'CANCELLED',
    total: 300000,
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'UNPAID',
    createdAt: '2026-11-04T00:00:00.000Z',
    paymentUnlinkedAt: '2026-11-04T01:00:00.000Z',
    paymentUnlinkedFirstAt: '2026-11-04T01:00:00.000Z',
    hasRecyclingPickup: false,
    gomdonStatus: null,
    gomdonOrderId: null,
    gomdonPartnerCode: null,
    gomdonCancelStatus: null,
  }) as AdminOrder;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let historyLoads = 0;
let historyGate: Promise<void> | undefined;
let postGate: Promise<void> | undefined;
let postStatus = 200;
const posts: string[] = [];

let mounted: Rendered | null = null;
beforeEach(() => {
  historyLoads = 0;
  historyGate = undefined;
  postGate = undefined;
  postStatus = 200;
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(url);
        await postGate;
        if (postStatus !== 200) return json(postStatus, { statusCode: postStatus, message: 'Có khoản Pancake mới tới, tải lại rồi đối chiếu lại.' });
        return json(200, { ok: true, message: 'Đã đối chiếu khoản Pancake báo đã thanh toán của đơn TB-100.' });
      }
      if (url.includes('/status-history')) {
        historyLoads += 1;
        if (historyLoads > 1) await historyGate;
        return json(200, { orderCode: 'TB-100', history: [] });
      }
      return json(404, { message: 'không có' });
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async () => {
  mounted = render(<PaymentUnlinkedPanel order={order()} isAdmin />);
  await flush();
  return mounted.container;
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const tap = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};
const btn = (c: HTMLElement) => byText(c, 'button', /^Đã đối chiếu$|^Đang lưu…$/) as HTMLButtonElement;
const resolveIt = async (c: HTMLElement) => {
  click(btn(c));
  await flush(1);
  answerAsk('đã ghi tiền về muộn theo sao kê');
  await flush(4);
};

describe('PaymentUnlinkedPanel: Đã đối chiếu giữ khoá', () => {
  it('lệnh còn bay: nút aria-busy/aria-disabled (không disabled), chạm lại không mở hộp ghi chú, đúng một POST', async () => {
    const c = await mount();
    const post = gate();
    postGate = post.promise;
    await resolveIt(c);
    expect(posts).toHaveLength(1);
    expect(btn(c).getAttribute('aria-busy')).toBe('true');
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    expect(btn(c).disabled).toBe(false);
    await tap(btn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(posts).toHaveLength(1);
    post.resolve();
    await flush();
  });

  it('xong mà lịch sử đơn chưa về: chạm lại không mở hộp ghi chú, đúng một POST; về rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    historyGate = list.promise;
    await resolveIt(c);
    expect(posts).toHaveLength(1);
    expect(historyLoads).toBe(2);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(btn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(posts).toHaveLength(1);
    list.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lịch sử đơn không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    historyGate = new Promise<void>(() => {});
    await resolveIt(c);
    await advance(3_500);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối (409, có khoản Pancake mới): lời lỗi hiện, lịch sử đơn tải lại, khoá giữ tới khi lịch sử về', async () => {
    postStatus = 409;
    const c = await mount();
    const list = gate();
    historyGate = list.promise;
    await resolveIt(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Có khoản Pancake mới tới');
    expect(historyLoads).toBe(2);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(btn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(posts).toHaveLength(1);
    list.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });
});
