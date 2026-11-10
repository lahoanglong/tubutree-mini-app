// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';

// Thông báo web ↔ Mini (Wave 92B ↔ 85A/68A/78A): lệnh đọc giữ khoá tới khi số chưa đọc mới về nhưng có hạn 4 giây; "Đọc tất cả" lỗi thì báo tại
// chỗ (role=alert) kèm "Thử lại" như Mini, lời lỗi hiện ngay kể cả khi lần tải lại danh sách còn treo; danh sách và chi tiết dùng chữ số đều.

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as Record<string, unknown> | null, status: 'authenticated' as string, initialized: true, sessionUnavailable: false, retrySession: vi.fn() },
  get: vi.fn(),
  post: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => mocks.auth }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null] }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));

import NotificationsPage from './page';
import { TubuQueryClient } from '@/lib/query-client';

const SENT_AT = new Date(Date.now() - 5 * 60_000).toISOString();
const UNREAD = {
  id: 'n1',
  templateCode: 'ORDER_CONFIRMED',
  payload: { body: 'Đơn TT001 đã được xác nhận', data: { order_code: 'TT001' } },
  status: 'SENT',
  sentAt: SENT_AT,
};
const READ = { id: 'n2', templateCode: 'POINTS_EARNED', payload: { body: 'Bạn nhận thêm 50 điểm Xanh' }, status: 'READ', sentAt: SENT_AT };
const summaryOf = (unreadNotifications: number) => ({
  orders: { pending_payment: 0, processing: 0, shipping: 0, delivered: 0, closed: 0, active: 0 },
  unreadNotifications,
  activeSubscriptions: 0,
});
const READ_ALL = '/me/notifications/read-all';
const RETRY_LABEL = 'Thử lại đánh dấu đã đọc';

const gate = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const never = () => new Promise<never>(() => undefined);

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<NotificationsPage />, new TubuQueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }));
  mounted.push(r);
  await flush(6);
  return r;
};
const posts = (path: string) => mocks.post.mock.calls.filter(([p]) => p === path);
const listCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/me/notifications');
const summaryCalls = () => mocks.get.mock.calls.filter(([p]) => p === '/me/summary');
const readAllBtn = (c: HTMLElement) => byText(c, 'button', 'Đọc tất cả') as HTMLButtonElement | null;
const retryBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(`button[aria-label="${RETRY_LABEL}"]`);
const alerts = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="alert"]')).map((n) => n.textContent ?? '');
const twice = (el: HTMLElement) =>
  act(() => {
    el.click();
    el.click();
  });

beforeEach(() => {
  mocks.auth.user = { id: 'u1' };
  mocks.auth.status = 'authenticated';
  mocks.auth.initialized = true;
  mocks.auth.sessionUnavailable = false;
  mocks.get.mockReset().mockImplementation(async (path: string) => (path === '/me/summary' ? summaryOf(1) : [UNREAD, READ]));
  mocks.post.mockReset().mockResolvedValue({ ok: true, count: 1 });
  mocks.push.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/tai-khoan/thong-bao: khoá giữ tới khi số chưa đọc về, có hạn 4 giây (W92B)', () => {
  beforeEach(() => {
    // shouldAdvanceTime để `flush` (setTimeout 0) và bộ đếm giờ của react-query vẫn chạy; chỉ giả setTimeout để tua tới hạn.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  it('"Đọc tất cả" thành công mà số chưa đọc không về: còn khoá ở 3 giây, nhả sau 4 giây, rồi bấm lại gửi được', async () => {
    const { container } = await mount();
    mocks.get.mockImplementation(async (path: string) => (path === '/me/summary' ? never() : [UNREAD, READ]));
    const all = readAllBtn(container)!;
    click(all);
    await flush(6);
    expect(posts(READ_ALL)).toHaveLength(1);
    expect(summaryCalls()).toHaveLength(2);
    await advance(3_000);
    expect(all.getAttribute('aria-busy')).toBe('true');
    click(all);
    await flush(3);
    expect(posts(READ_ALL)).toHaveLength(1);
    await advance(1_500);
    await flush(4);
    expect(all.hasAttribute('aria-busy')).toBe(false);
    click(all);
    await flush(6);
    expect(posts(READ_ALL)).toHaveLength(2);
  });

  it('"Đọc tất cả" lỗi mà lần tải lại danh sách không về: lời lỗi hiện ngay, khoá nhả sau 4 giây', async () => {
    mocks.post.mockRejectedValue(new ApiError('Chưa đánh dấu được, bạn thử lại nhé.', 400));
    const { container } = await mount();
    mocks.get.mockImplementation(async (path: string) => (path === '/me/summary' ? summaryOf(1) : never()));
    const all = readAllBtn(container)!;
    click(all);
    await flush(6);
    expect(alerts(container).join(' ')).toContain('Chưa đánh dấu được, bạn thử lại nhé.');
    await advance(3_000);
    expect(all.getAttribute('aria-busy')).toBe('true');
    expect(retryBtn(container)!.getAttribute('aria-busy')).toBe('true');
    await advance(1_500);
    await flush(4);
    expect(all.hasAttribute('aria-busy')).toBe(false);
    expect(retryBtn(container)!.hasAttribute('aria-busy')).toBe(false);
    click(retryBtn(container));
    await flush(6);
    expect(posts(READ_ALL)).toHaveLength(2);
  });
});

describe('/tai-khoan/thong-bao: "Đọc tất cả" lỗi báo tại chỗ có "Thử lại" như Mini (W92B ↔ W68A)', () => {
  it('lỗi: role=alert đúng lời máy chủ kèm nút "Thử lại" có tên riêng; chưa lỗi thì không có khối', async () => {
    mocks.post.mockRejectedValue(new ApiError('Chưa đánh dấu được, bạn thử lại nhé.', 400));
    const { container } = await mount();
    expect(alerts(container).join(' ')).not.toContain('Chưa đánh dấu');
    expect(retryBtn(container)).toBeNull();
    click(readAllBtn(container));
    await flush(8);
    expect(alerts(container).join(' ')).toContain('Chưa đánh dấu được, bạn thử lại nhé.');
    expect(retryBtn(container)!.textContent).toContain('Thử lại');
  });

  it('"Thử lại": chạm đúp cùng khung hình chỉ một lệnh, nút giữ focus (aria-busy + aria-disabled, không disabled); thành công thì khối biến mất', async () => {
    const retry = gate<unknown>();
    mocks.post.mockRejectedValueOnce(new ApiError('Chưa đánh dấu được, bạn thử lại nhé.', 400)).mockReturnValueOnce(retry.promise);
    const { container } = await mount();
    click(readAllBtn(container));
    await flush(8);
    const btn = retryBtn(container)!;
    btn.focus();
    twice(btn);
    await flush(3);
    expect(posts(READ_ALL)).toHaveLength(2);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
    // Lỗi cũ còn nguyên lúc đang thử lại (khối không biến mất rồi hiện lại).
    expect(alerts(container).join(' ')).toContain('Chưa đánh dấu được');
    mocks.get.mockImplementation(async (path: string) => (path === '/me/summary' ? summaryOf(0) : [{ ...UNREAD, status: 'READ' }, READ]));
    retry.resolve({ ok: true, count: 1 });
    await flush(8);
    expect(retryBtn(container)).toBeNull();
    expect(alerts(container).join(' ')).not.toContain('Chưa đánh dấu');
    expect(posts(READ_ALL)).toHaveLength(2);
  });

  it('"Thử lại" thành công: khối lỗi biến mất ngay dù số chưa đọc của máy chủ chưa kịp về 0', async () => {
    mocks.post.mockRejectedValueOnce(new ApiError('Chưa đánh dấu được, bạn thử lại nhé.', 400)).mockResolvedValueOnce({ ok: true, count: 1 });
    const { container } = await mount();
    click(readAllBtn(container));
    await flush(8);
    expect(retryBtn(container)).not.toBeNull();
    click(retryBtn(container));
    await flush(8);
    expect(posts(READ_ALL)).toHaveLength(2);
    expect(readAllBtn(container)).not.toBeNull();
    expect(retryBtn(container)).toBeNull();
    expect(alerts(container).join(' ')).not.toContain('Chưa đánh dấu');
  });

  it('lỗi lặp lại cùng một câu vẫn được dựng lại để trình đọc màn hình đọc lại', async () => {
    mocks.post.mockRejectedValue(new ApiError('Chưa đánh dấu được, bạn thử lại nhé.', 400));
    const { container } = await mount();
    click(readAllBtn(container));
    await flush(8);
    const first = container.querySelector('[role="alert"] p, [role="alert"] span');
    expect(first?.textContent).toContain('Chưa đánh dấu được');
    click(retryBtn(container));
    await flush(8);
    const second = container.querySelector('[role="alert"] p, [role="alert"] span');
    expect(second?.textContent).toContain('Chưa đánh dấu được');
    expect(second).not.toBe(first);
  });

  it('hết tin chưa đọc (đọc lẻ từng tin) thì khối lỗi ẩn: không còn gì để thử lại', async () => {
    mocks.post.mockImplementation(async (path: string) => {
      if (path === READ_ALL) throw new ApiError('Chưa đánh dấu được, bạn thử lại nhé.', 400);
      return { ok: true, count: 1 };
    });
    const { container } = await mount();
    click(readAllBtn(container));
    await flush(8);
    expect(retryBtn(container)).not.toBeNull();
    mocks.get.mockImplementation(async (path: string) => (path === '/me/summary' ? summaryOf(0) : [{ ...UNREAD, status: 'READ' }, READ]));
    click(byText(container, 'button', 'Đơn TT001 đã được xác nhận'));
    await flush(8);
    expect(retryBtn(container)).toBeNull();
    expect(alerts(container).join(' ')).not.toContain('Chưa đánh dấu');
  });

  it('lệnh đọc một tin hỏng không hiện khối lỗi của "Đọc tất cả" (thao tác nền, như Mini)', async () => {
    mocks.post.mockRejectedValue(new ApiError('Lỗi đọc tin.', 400));
    const { container } = await mount();
    click(byText(container, 'button', 'Đơn TT001 đã được xác nhận'));
    await flush(8);
    expect(retryBtn(container)).toBeNull();
    expect(alerts(container).join(' ')).not.toContain('Lỗi đọc tin');
  });
});

describe('/tai-khoan/thong-bao: số đều như Mini (W92B ↔ W68A)', () => {
  it('danh sách và chi tiết dùng chữ số đều (tabular-nums)', async () => {
    const { container } = await mount();
    expect(container.querySelector('ul')!.className).toContain('tabular-nums');
    click(byText(container, 'button', 'Đơn TT001 đã được xác nhận'));
    await flush(4);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.querySelector('.tabular-nums')).not.toBeNull();
    expect(listCalls().length).toBeGreaterThan(0);
  });
});
