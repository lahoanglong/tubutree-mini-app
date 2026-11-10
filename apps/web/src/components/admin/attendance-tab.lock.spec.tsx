// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceTab } from './attendance-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';
import { captureUnhandledRejections } from '@/test-utils/unhandled';

// W96B: "Chốt ra ca" (lương ngày đó tính lại) khoá đồng bộ, giữ tới khi danh sách đang trong ca làm mới về nhưng tối đa 4 giây, tải lại khi bị
// từ chối vì phiên đã đóng (400/404), nút báo bận bằng aria-busy/aria-disabled (không disabled), "Thử lại" không huỷ-rồi-gửi-lại khi chạm đúp.
// Mini không có màn này (Mini chỉ có phía nhân viên tự Ra ca).

const staff = (id: string, name: string) => ({ id, fullName: name, phone: `09${id}00000` });
const live = (id: string, name: string) => ({
  id,
  staffId: `st${id}`,
  checkinAt: '2026-10-19T01:00:00.000Z',
  lastHeartbeatAt: '2026-10-19T02:00:00.000Z',
  outOfRangeCount: 0,
  isLate: false,
  shift: { id: `sh${id}`, workDate: '2026-10-19T00:00:00.000Z', startAt: '2026-10-19T01:00:00.000Z', endAt: '2026-10-19T05:00:00.000Z', approvedStart: null, approvedEnd: null, staff: staff(id, name) },
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = <T = void,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const never = () => new Promise<Response>(() => undefined);

type Route = () => Promise<Response> | Response;
let LIVE: unknown[] = [];
const routes: { list: Route; checkout: Route } = { list: () => json(200, LIVE), checkout: () => json(200, { checkedOut: true }) };
const calls: { method: string; url: string; body?: { sessionId?: string } }[] = [];
const listGets = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/attendance/live')).length;
const checkouts = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/admin/attendance/manual-checkout'));

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  LIVE = [live('1', 'Lan'), live('2', 'Mai')];
  routes.list = () => json(200, LIVE);
  routes.checkout = () => json(200, { checkedOut: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? (JSON.parse(String(init.body)) as { sessionId?: string }) : undefined });
      if (method === 'POST' && url.includes('/admin/attendance/manual-checkout')) return routes.checkout();
      if (url.includes('/admin/attendance/live')) return routes.list();
      throw new Error(`fetch chưa giả: ${method} ${url}`);
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mount = async (client?: QueryClient) => {
  mounted = render(<AttendanceTab />, client);
  await flush();
  return mounted.container;
};
const closeBtns = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('li button')).filter((b) => b.textContent === 'Chốt ra ca');
const row = (c: HTMLElement, i: number) => c.querySelectorAll('li')[i]!;
const btn = (c: HTMLElement, i: number) => row(c, i).querySelector<HTMLButtonElement>('button')!;
const isBusy = (b: HTMLElement | null | undefined) => b?.getAttribute('aria-busy') === 'true';
const alertText = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]')).map((a) => a.textContent).join(' | ');
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const tap = (...els: HTMLElement[]) =>
  act(async () => {
    for (const e of els) e.click();
  });
const holdList = () => {
  const g = gate();
  routes.list = () => g.promise.then(() => json(200, LIVE));
  return g;
};
const doCheckout = async (c: HTMLElement, i = 0) => {
  click(btn(c, i));
  await flush();
  answerConfirm(true);
  await flush(3);
};

describe('Chốt ra ca: khoá đồng bộ', () => {
  it('đang chốt: nút của dòng aria-busy, mọi nút aria-disabled, KHÔNG disabled; chạm lại không mở hộp và chỉ có một lần gọi API', async () => {
    const c = await mount();
    const held = gate();
    routes.checkout = () => held.promise.then(() => json(200, { checkedOut: true }));
    await doCheckout(c);
    expect(checkouts()).toHaveLength(1);
    expect(checkouts()[0]!.body).toEqual({ sessionId: '1' });
    expect(isBusy(btn(c, 0))).toBe(true);
    expect(isBusy(btn(c, 1))).toBe(false);
    for (const b of closeBtns(c)) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.disabled).toBe(false);
    }
    await tap(btn(c, 0), btn(c, 0), btn(c, 1));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(checkouts()).toHaveLength(1);
    held.resolve();
    await flush(3);
    expect(checkouts()).toHaveLength(1);
    expect(c.textContent).toContain('Đã chốt ra ca và tính lại lương ngày đó.');
  });

  it('hộp xác nhận bật hai lần sát nhau: chỉ gửi một lệnh', async () => {
    const c = await mount();
    click(btn(c, 0));
    await flush();
    await act(async () => {
      const accept = confirmDialog()!.querySelector<HTMLButtonElement>('[data-confirm="accept"]')!;
      accept.click();
      accept.click();
    });
    await flush(3);
    expect(checkouts()).toHaveLength(1);
  });

  it('chốt xong mà danh sách chưa làm mới thì nút vẫn bận, chạm lại không mở hộp; danh sách về rồi mới nhả (dòng đã chốt biến mất)', async () => {
    const c = await mount();
    const list = holdList();
    await doCheckout(c);
    expect(listGets()).toBe(2);
    expect(isBusy(btn(c, 0))).toBe(true);
    click(btn(c, 0));
    await flush();
    expect(confirmDialog()).toBeNull();
    LIVE = [live('2', 'Mai')];
    list.resolve();
    await flush();
    expect(closeBtns(c)).toHaveLength(1);
    expect(isBusy(btn(c, 0))).toBe(false);
    expect(btn(c, 0).hasAttribute('aria-disabled')).toBe(false);
  });

  it('danh sách không bao giờ về: còn bận ở 3,5 giây, nhả sau hạn 4 giây và chốt lại được', async () => {
    const c = await mount();
    useHangTimers();
    routes.list = never;
    await doCheckout(c);
    await advance(3_500);
    expect(isBusy(btn(c, 0))).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(btn(c, 0))).toBe(false);
    await doCheckout(c);
    expect(checkouts()).toHaveLength(2);
  });

  it('danh sách tải lại hỏng 500: không unhandled rejection, khoá nhả, lệnh vẫn báo xong', async () => {
    const c = await mount();
    const seen = await captureUnhandledRejections(async () => {
      routes.list = () => json(500, { message: 'x' });
      await doCheckout(c);
    });
    expect(seen).toEqual([]);
    expect(c.textContent).toContain('Đã chốt ra ca');
  });
});

describe('Chốt ra ca bị từ chối vì phiên đã đóng (400/404): tải lại rồi mới nhả', () => {
  it.each([[400], [404]])('bị %i: hiện lỗi trước, tải lại danh sách, nhả khi danh sách về', async (status) => {
    const c = await mount();
    routes.checkout = () => json(status, { message: 'Phiên đã đóng.' });
    const list = holdList();
    await doCheckout(c);
    expect(alertText(c)).toContain('Phiên đã đóng.');
    expect(listGets()).toBe(2);
    expect(isBusy(btn(c, 0))).toBe(true);
    click(btn(c, 0));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(checkouts()).toHaveLength(1);
    LIVE = [live('2', 'Mai')];
    list.resolve();
    await flush();
    expect(closeBtns(c)).toHaveLength(1);
    expect(alertText(c)).toContain('Phiên đã đóng.');
    expect(isBusy(btn(c, 0))).toBe(false);
  });

  it('bị từ chối mà danh sách tải lại treo: nhả khoá sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    routes.checkout = () => json(400, { message: 'Phiên đã đóng.' });
    routes.list = never;
    await doCheckout(c);
    await advance(3_500);
    expect(isBusy(btn(c, 0))).toBe(true);
    await advance(1_000);
    await flush();
    expect(isBusy(btn(c, 0))).toBe(false);
  });

  it.each([
    ['máy chủ 500', () => json(500, { message: 'x' })],
    ['quyền 403', () => json(403, { message: 'Không đủ quyền.' })],
    ['mất mạng', () => Promise.reject(new TypeError('Failed to fetch'))],
  ] as const)('lỗi %s: hiện lỗi, nhả khoá ngay để thử lại (lệnh không tự tải lại danh sách; trên production MutationCache vẫn làm cũ khoá admin-attendance-live)', async (_name, reply) => {
    const c = await mount();
    routes.checkout = reply as Route;
    await doCheckout(c);
    expect(alertText(c)).not.toBe('');
    expect(listGets()).toBe(1);
    expect(isBusy(btn(c, 0))).toBe(false);
    routes.checkout = () => json(200, { checkedOut: true });
    await doCheckout(c);
    expect(checkouts()).toHaveLength(2);
  });
});

describe('"Thử lại" tải danh sách', () => {
  // Đã có dữ liệu cũ (lần làm mới sau lỗi): refetch mặc định HUỶ lượt đang bay rồi gửi lại, nên chạm đúp tốn hai lượt; cancelRefetch: false thì gộp một.
  it('chạm đúp cùng khung hình chỉ tải lại một lần, xong thì hết khối lỗi', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const c = await mount(client);
    routes.list = () => json(500, { message: 'x' });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['admin-attendance-live'] });
    });
    await flush();
    const retry = byText(c, 'button', 'Thử lại') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    const g = gate();
    routes.list = () => g.promise.then(() => json(200, LIVE));
    const before = listGets();
    await tap(retry, retry);
    await flush(1);
    expect(listGets() - before).toBe(1);
    g.resolve();
    await flush();
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
    expect(closeBtns(c)).toHaveLength(2);
  });
});
