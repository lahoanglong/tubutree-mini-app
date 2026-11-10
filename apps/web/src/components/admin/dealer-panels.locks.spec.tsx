// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { DealerPaymentPanel } from './dealer-payment-panel';
import { DealerCreditPanel } from './dealer-credit-panel';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { apiFetch } from '@/lib/client-api';
import type { AdminOrder } from '@/lib/admin-client';

// W96B: xác nhận chuyển khoản đơn đại lý và ghi giảm công nợ (TIỀN) giữ khoá tới khi dữ liệu làm mới về (tối đa 4 giây): nhả sớm thì nút còn đó với
// số liệu cũ. Mỗi ca chạm lại TRONG khoá, hộp xác nhận không mở và API chỉ bị gọi một lần.

const order = (over: Partial<AdminOrder> = {}): AdminOrder => ({
  id: 'o1',
  code: 'TB-200',
  type: 'DEALER',
  dealerOnCredit: false,
  status: 'PENDING_PAYMENT',
  total: 12_500_000,
  paymentMethod: 'BANK_TRANSFER',
  paymentStatus: 'UNPAID',
  createdAt: '2026-09-27T00:00:00.000Z',
  user: { id: 'u-dealer-1', phone: '0900000000', fullName: 'Đại lý A' },
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let readGate: Promise<void> | undefined;
let reads = 0;
let writeStatus = 200;
const calls: { method: string; url: string }[] = [];
const writes = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).length;
const gets = (part: string) => calls.filter((c) => c.method === 'GET' && c.url.includes(part)).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  readGate = undefined;
  reads = 0;
  writeStatus = 200;
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST') {
        if (writeStatus !== 200) return json(writeStatus, { statusCode: writeStatus, message: `Lỗi ${writeStatus} từ máy chủ` });
        if (url.includes('/confirm-payment')) return json(200, { ok: true, alreadyPaid: false, message: 'Đã xác nhận thanh toán đơn TB-200.', order: {} });
        return json(200, { balance: 1_000_000 });
      }
      if (url.includes('/credit-ledger')) {
        reads += 1;
        if (reads > 1) await readGate;
        return json(200, { balance: 3_000_000, entries: [] });
      }
      await readGate;
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
describe('DealerPaymentPanel: Xác nhận đã nhận chuyển khoản', () => {
  function Page() {
    useQuery({ queryKey: ['admin-orders', 'probe'], queryFn: () => apiFetch('/admin/orders?probe=1') });
    return <DealerPaymentPanel order={order()} />;
  }
  const mount = async () => {
    mounted = render(<Page />);
    await flush();
    return mounted.container;
  };
  const btn = (c: HTMLElement) => byText(c, 'button', /^Xác nhận đã nhận chuyển khoản$|^Đang xác nhận/) as HTMLButtonElement;
  const pay = async (c: HTMLElement) => {
    click(btn(c));
    await flush(1);
    answerConfirm(true);
    await flush(4);
  };

  it('xong mà danh sách đơn chưa về: nút aria-busy/aria-disabled (không disabled), chạm lại không mở hộp hỏi, chỉ một POST; về rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    readGate = list.promise;
    await pay(c);
    expect(writes('/confirm-payment')).toBe(1);
    expect(gets('/admin/orders')).toBe(2);
    const b = btn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('/confirm-payment')).toBe(1);
    list.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
    expect(c.textContent).toContain('Đã xác nhận thanh toán đơn TB-200.');
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount();
    readGate = new Promise<void>(() => {});
    await pay(c);
    await advance(3_500);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('bị từ chối vì đơn đã đổi (409): hiện lỗi ngay, tải lại rồi mới nhả; lỗi 500: lệnh không tự tải lại, nhả khoá ngay (QueryClient trần, không có MutationCache như production)', async () => {
    writeStatus = 409;
    const c = await mount();
    const list = gate();
    readGate = list.promise;
    await pay(c);
    expect(gets('/admin/orders')).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 409');
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();

    readGate = undefined;
    writeStatus = 500;
    const before = gets('/admin/orders');
    await pay(c);
    expect(gets('/admin/orders')).toBe(before);
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('DealerPaymentPanel: lỗi không mất khi đơn tải lại thành "đã trả"', () => {
  let setOrderOnPage: (o: AdminOrder) => void = () => undefined;
  function Host() {
    const [o, setO] = useState(order());
    setOrderOnPage = setO;
    return <DealerPaymentPanel order={o} />;
  }

  it('bị từ chối 409 rồi đơn về PAID làm khối ẩn: câu lỗi vẫn còn, role=alert', async () => {
    writeStatus = 409;
    mounted = render(<Host />);
    await flush();
    const c = mounted.container;
    click(byText(c, 'button', 'Xác nhận đã nhận chuyển khoản'));
    await flush(1);
    answerConfirm(true);
    await flush(4);
    await act(async () => {
      setOrderOnPage(order({ paymentStatus: 'PAID', status: 'CONFIRMED' }));
    });
    expect(byText(c, 'button', /Xác nhận đã nhận chuyển khoản/)).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 409');
  });
});

describe('DealerCreditPanel: Xác nhận đã nhận, giảm nợ', () => {
  const mount = async () => {
    mounted = render(<DealerCreditPanel order={order({ status: 'CONFIRMED' })} />);
    click(byText(mounted.container, 'button', 'Công nợ đại lý'));
    await flush();
    return mounted.container;
  };
  const amountInput = (c: HTMLElement) => c.querySelector('input[aria-label="Số tiền đã nhận (đ)"]');
  const btn = (c: HTMLElement) => byText(c, 'button', /^Xác nhận đã nhận, giảm nợ$|^Đang xác nhận/) as HTMLButtonElement;
  const pay = async (c: HTMLElement) => {
    typeInto(amountInput(c), '2000000');
    click(btn(c));
    await flush(1);
    answerConfirm(true);
    await flush(4);
  };

  it('xong mà sổ công nợ chưa tải lại xong: nút aria-busy/aria-disabled (không disabled), nhập lại rồi chạm không mở hộp hỏi, chỉ một POST; về rồi mới nhả', async () => {
    const c = await mount();
    const ledger = gate();
    readGate = ledger.promise;
    await pay(c);
    expect(writes('/credit-payment')).toBe(1);
    expect(gets('/credit-ledger')).toBe(2);
    const b = btn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    typeInto(amountInput(c), '500000');
    await tap(btn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('/credit-payment')).toBe(1);
    ledger.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('sổ không bao giờ về: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    const c = await mount();
    readGate = new Promise<void>(() => {});
    await pay(c);
    await advance(3_500);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi (kể cả 500, máy chủ có thể đã ghi): hiện lỗi ngay, tải lại sổ và giữ khoá tới khi sổ về để kế toán thấy dư nợ thật trước khi bấm lại', async () => {
    writeStatus = 500;
    const c = await mount();
    const ledger = gate();
    readGate = ledger.promise;
    await pay(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Lỗi 500');
    expect(gets('/credit-ledger')).toBe(2);
    expect(btn(c).getAttribute('aria-disabled')).toBe('true');
    ledger.resolve();
    await flush();
    expect(btn(c).getAttribute('aria-disabled')).toBeNull();
  });
});
