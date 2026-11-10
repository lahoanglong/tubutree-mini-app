// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { OrderStatusActions } from './order-status-actions';
import { apiFetch } from '@/lib/client-api';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminOrder } from '@/lib/admin-client';

// W96B: đổi trạng thái đơn / ghi nhận tiền / chạy lại việc sau giao giữ khoá tới khi danh sách đơn làm mới về (tối đa 4 giây), lệnh bị từ chối vì
// đơn đã đổi (400/404/409) thì tải lại rồi mới nhả khoá; lỗi khác nhả khoá ngay, không chờ tải lại. Spec dựng QueryClient trần, không có MutationCache như production
// (ở đó khoá admin-* vẫn bị làm cũ ở nền sau mỗi lệnh, kể cả lỗi 5xx), nên "không tải lại" ở đây là lệnh không tự gọi tải lại. Lời lỗi nằm ngoài khối nút (khối nút đổi/biến mất theo trạng thái đơn mới).

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-300',
  type: 'RETAIL',
  status: 'PENDING_PAYMENT',
  total: 450_000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-10-01T00:00:00.000Z',
  allowedTransitions: ['CONFIRMED', 'PACKED', 'CANCELLED'],
  canConfirmPayment: true,
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

type Kind = 'status' | 'pay' | 'resync';
let ordersGate: Promise<void> | undefined;
let writeRoute: (kind: Kind) => Response | Promise<Response> = () => json(200, {});
const calls: { method: string; url: string }[] = [];
const count = (kind: Kind) =>
  calls.filter((c) => (kind === 'status' ? c.method === 'PUT' && c.url.includes('/status') : c.method === 'POST' && c.url.includes(kind === 'pay' ? '/confirm-payment' : '/resync-delivered-effects'))).length;
const ordersGets = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/orders')).length;

let mounted: Rendered | null = null;
let setOrderOnPage: (o: AdminOrder) => void = () => {};

beforeEach(() => {
  calls.length = 0;
  ordersGate = undefined;
  writeRoute = (kind) => (kind === 'pay' ? json(200, { ok: true, alreadyPaid: false, message: 'Đã ghi nhận', order: {} }) : kind === 'resync' ? json(200, { orderId: 'o1', code: 'TB-300', outcome: 'DONE' }) : json(200, {}));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'PUT' && url.includes('/status')) return writeRoute('status');
      if (method === 'POST' && url.includes('/confirm-payment')) return writeRoute('pay');
      if (method === 'POST' && url.includes('/resync-delivered-effects')) return writeRoute('resync');
      await ordersGate;
      return json(200, { data: [], meta: { page: 1, limit: 20, total: 0 } });
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Trang cha: có một truy vấn admin-orders đang mount để `invalidateQueries` thật sự gọi mạng, và giữ đơn trong state để test đổi được đơn. */
function Page({ initial, props }: { initial: AdminOrder; props: Partial<Parameters<typeof OrderStatusActions>[0]> }): ReactNode {
  const [o, setO] = useState(initial);
  setOrderOnPage = setO;
  useQuery({ queryKey: ['admin-orders', 'probe'], queryFn: () => apiFetch('/admin/orders?probe=1') });
  return <OrderStatusActions order={o} {...props} />;
}
const mount = async (o: AdminOrder, props: Partial<Parameters<typeof OrderStatusActions>[0]> = {}) => {
  mounted = render(<Page initial={o} props={props} />);
  await flush();
  return mounted.container;
};
const useHangTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const tap = async (...els: HTMLElement[]) => {
  await act(async () => {
    for (const el of els) el.click();
  });
};
const btn = (c: HTMLElement, text: string) => byText(c, 'button', text) as HTMLButtonElement;
const busyAttrs = (b: HTMLElement) => ({ busy: b.getAttribute('aria-busy'), disabled: b.getAttribute('aria-disabled') });

describe('Chuyển trạng thái (không hỏi xác nhận)', () => {
  it('chạm đúp "Đã đóng gói" cùng một khung hình chỉ gửi một lệnh', async () => {
    const c = await mount(order());
    await tap(btn(c, 'Đã đóng gói'), btn(c, 'Đã đóng gói'));
    await flush(3);
    expect(count('status')).toBe(1);
  });

  it('lệnh xong mà danh sách đơn chưa về: các nút aria-busy/aria-disabled (không disabled), chạm tiếp không gửi lệnh; về rồi mới nhả', async () => {
    const c = await mount(order());
    const list = gate();
    ordersGate = list.promise;
    click(btn(c, 'Đã đóng gói'));
    await flush(4);
    expect(count('status')).toBe(1);
    expect(ordersGets()).toBe(2);
    const b = btn(c, 'Đã đóng gói');
    expect(busyAttrs(b)).toEqual({ busy: 'true', disabled: 'true' });
    expect(b.disabled).toBe(false);
    expect(btn(c, 'Xác nhận').getAttribute('aria-disabled')).toBe('true');
    await tap(b, btn(c, 'Xác nhận'));
    await flush(3);
    expect(count('status')).toBe(1);
    list.resolve();
    await flush();
    expect(busyAttrs(btn(c, 'Đã đóng gói'))).toEqual({ busy: null, disabled: null });
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount(order());
    ordersGate = new Promise<void>(() => {});
    click(btn(c, 'Đã đóng gói'));
    await flush(4);
    await advance(3_500);
    expect(btn(c, 'Đã đóng gói').getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(btn(c, 'Đã đóng gói').getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối vì đơn đã đổi (400): hiện lỗi ngay, tải lại rồi mới nhả khoá; lỗi nằm ngoài khối nút nên không mất khi khối nút biến mất', async () => {
    writeRoute = (kind) => (kind === 'status' ? json(400, { statusCode: 400, message: 'Đơn vừa chuyển sang «Đang giao».' }) : json(200, {}));
    const c = await mount(order());
    const list = gate();
    ordersGate = list.promise;
    click(btn(c, 'Đã đóng gói'));
    await flush(4);
    expect(ordersGets()).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Đơn vừa chuyển sang');
    expect(btn(c, 'Đã đóng gói').getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(c, 'Đã đóng gói').getAttribute('aria-disabled')).toBeNull();
  });

  it('lời lỗi còn đó khi đơn mới về làm hết nút trạng thái', async () => {
    writeRoute = (kind) => (kind === 'status' ? json(409, { statusCode: 409, message: 'Đơn đã được huỷ ở nơi khác.' }) : json(200, {}));
    const c = await mount(order());
    click(btn(c, 'Đã đóng gói'));
    await flush(4);
    act(() => setOrderOnPage(order({ status: 'CANCELLED', allowedTransitions: [], canConfirmPayment: false })));
    await flush();
    expect(byText(c, 'button', 'Đã đóng gói')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('đã được huỷ ở nơi khác');
  });

  it('lỗi 500: hiện lỗi, lệnh không tự tải lại (QueryClient trần, không có MutationCache như production), nhả khoá ngay', async () => {
    writeRoute = (kind) => (kind === 'status' ? json(500, { statusCode: 500, message: 'Máy chủ lỗi' }) : json(200, {}));
    const c = await mount(order());
    click(btn(c, 'Đã đóng gói'));
    await flush(4);
    expect(ordersGets()).toBe(1);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(btn(c, 'Đã đóng gói').getAttribute('aria-disabled')).toBeNull();
    click(btn(c, 'Đã đóng gói'));
    await flush(4);
    expect(count('status')).toBe(2);
  });
});

describe('Huỷ đơn (hỏi xác nhận, có tiền hoàn)', () => {
  it('đang chạy mà danh sách chưa về: chạm "Huỷ đơn" không mở hộp hỏi và không gửi lệnh thứ hai', async () => {
    const c = await mount(order({ paymentStatus: 'PAID' }));
    const list = gate();
    ordersGate = list.promise;
    click(btn(c, 'Huỷ đơn'));
    await flush(1);
    answerAsk('Hết hàng');
    await flush(4);
    expect(count('status')).toBe(1);
    expect(btn(c, 'Huỷ đơn').getAttribute('aria-busy')).toBe('true');
    expect(btn(c, 'Huỷ đơn').disabled).toBe(false);
    await tap(btn(c, 'Huỷ đơn'));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('status')).toBe(1);
    list.resolve();
    await flush();
  });
});

describe('Đã nhận tiền (ghi nhận chuyển khoản)', () => {
  const pay = async (c: HTMLElement) => {
    click(btn(c, 'Đã nhận tiền'));
    await flush(1);
    answerConfirm(true);
    await flush(4);
  };

  it('xong mà danh sách chưa về: nút aria-busy/aria-disabled (không disabled); chạm lại + xác nhận không gửi lần hai; về rồi mới nhả', async () => {
    const onPaid = vi.fn();
    const c = await mount(order(), { onPaid });
    const list = gate();
    ordersGate = list.promise;
    await pay(c);
    expect(count('pay')).toBe(1);
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(ordersGets()).toBe(2);
    const b = btn(c, 'Đã nhận tiền');
    expect(busyAttrs(b)).toEqual({ busy: 'true', disabled: 'true' });
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('pay')).toBe(1);
    list.resolve();
    await flush();
    expect(busyAttrs(btn(c, 'Đã nhận tiền'))).toEqual({ busy: null, disabled: null });
  });

  it('danh sách không bao giờ về: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount(order());
    ordersGate = new Promise<void>(() => {});
    await pay(c);
    await advance(3_500);
    expect(btn(c, 'Đã nhận tiền').getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(btn(c, 'Đã nhận tiền').getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối vì đơn đã đổi (400): hiện lỗi, tải lại rồi mới nhả khoá; lỗi 500: lệnh không tự tải lại, nhả khoá ngay (QueryClient trần)', async () => {
    writeRoute = (kind) => (kind === 'pay' ? json(400, { statusCode: 400, message: 'Đơn đã được xác nhận thanh toán.' }) : json(200, {}));
    const c = await mount(order());
    const list = gate();
    ordersGate = list.promise;
    await pay(c);
    expect(ordersGets()).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('đã được xác nhận');
    expect(btn(c, 'Đã nhận tiền').getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(c, 'Đã nhận tiền').getAttribute('aria-disabled')).toBeNull();

    ordersGate = undefined;
    writeRoute = (kind) => (kind === 'pay' ? json(500, { statusCode: 500, message: 'Máy chủ lỗi' }) : json(200, {}));
    const before = ordersGets();
    await pay(c);
    expect(ordersGets()).toBe(before);
    expect(btn(c, 'Đã nhận tiền').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Chạy lại việc sau giao', () => {
  const delivered = () => order({ status: 'DELIVERED', paymentStatus: 'PAID', allowedTransitions: [], canConfirmPayment: false, deliveredEffectsAt: null });

  it('xong mà danh sách chưa về: nút aria-busy/aria-disabled (không disabled), chạm lại không mở hộp hỏi; về rồi mới nhả', async () => {
    const c = await mount(delivered(), { canResync: true });
    const list = gate();
    ordersGate = list.promise;
    click(btn(c, 'Chạy lại việc sau giao'));
    await flush(1);
    answerConfirm(true);
    await flush(4);
    expect(count('resync')).toBe(1);
    const b = btn(c, 'Chạy lại việc sau giao');
    expect(busyAttrs(b)).toEqual({ busy: 'true', disabled: 'true' });
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(count('resync')).toBe(1);
    list.resolve();
    await flush();
    expect(btn(c, 'Chạy lại việc sau giao').getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount(delivered(), { canResync: true });
    ordersGate = new Promise<void>(() => {});
    click(btn(c, 'Chạy lại việc sau giao'));
    await flush(1);
    answerConfirm(true);
    await flush(4);
    await advance(3_500);
    expect(btn(c, 'Chạy lại việc sau giao').getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(btn(c, 'Chạy lại việc sau giao').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('số dùng tabular-nums', () => {
  it('ô số tiền thực nhận của tiền về muộn', async () => {
    const c = await mount(order({ status: 'CANCELLED', paymentStatus: 'UNPAID', allowedTransitions: [], canConfirmPayment: false, canRecordLatePayment: true }));
    const input = c.querySelector('input[name="receivedAmount"]') as HTMLInputElement;
    expect(input.classList.contains('tabular-nums')).toBe(true);
  });
});
