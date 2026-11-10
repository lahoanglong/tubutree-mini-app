// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerRefundsTab } from './customer-refunds-tab';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminCustomerRefund } from '@/lib/admin-client';

// W96B: Trả về hàng chờ / Xác nhận tiền dư / Không phải tiền dư giữ khoá tới khi danh sách làm mới về (tối đa 4 giây), lệnh bị từ chối
// vì trạng thái đã đổi thì tải lại, lỗi khác không tải lại. Đây là đường TIỀN: mỗi ca chạm lại TRONG lúc khoá và đếm số lần gọi API.

const refund = (over: Partial<AdminCustomerRefund> = {}): AdminCustomerRefund => ({
  id: 'r1',
  orderId: 'o1',
  orderCode: 'TT-20261001-0001',
  amount: 1_250_000,
  phone: '0912345678',
  recipientName: 'Trần Thị B',
  customerUserId: null,
  method: 'MANUAL_TRANSFER',
  status: 'PROCESSING',
  claimedBy: 'a1',
  claimedAt: '2026-10-14T03:00:00.000Z',
  reason: 'CANCELLED',
  completedAt: null,
  completedBy: null,
  bankRef: null,
  adminNote: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  kind: 'END_CUSTOMER',
  userId: null,
  bankName: null,
  bankAccountNo: null,
  bankAccountName: null,
  ...over,
});
const processing = () => refund();
const unverified = () => refund({ kind: 'OVERPAYMENT', status: 'UNVERIFIED', userId: 'u1', reason: 'CONFIRMED', amount: 114_000, recipientName: null, phone: null });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let rows: AdminCustomerRefund[] = [];
let listGate: Promise<void> | undefined;
let listLoads = 0;
let writeRoute: (kind: 'release' | 'verify' | 'dismiss') => Response | Promise<Response> = () => json(200, { id: 'r1', status: 'PENDING' });
const calls: { method: string; url: string }[] = [];
const writes = (kind: 'release' | 'verify' | 'dismiss') => calls.filter((c) => c.method === 'POST' && c.url.includes(`/${kind}`)).length;
const lists = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/customer-refunds')).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  listLoads = 0;
  listGate = undefined;
  rows = [];
  writeRoute = () => json(200, { id: 'r1', status: 'PENDING' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      const kind = (['release', 'verify', 'dismiss'] as const).find((k) => method === 'POST' && url.includes(`/${k}`));
      if (kind) return writeRoute(kind);
      listLoads += 1;
      if (listLoads > 1) await listGate;
      return json(200, { data: rows, meta: { page: 1, limit: 20, total: rows.length } });
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
  mounted = render(<CustomerRefundsTab meId="a1" />);
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
const card = (c: HTMLElement) => c.querySelector('[data-refund-id="r1"]') as HTMLElement;
const releaseBtn = (c: HTMLElement) => byText(card(c), 'button', /^Trả về hàng chờ|^Đang trả/) as HTMLButtonElement;
const verifyBtn = (c: HTMLElement) => byText(card(c), 'button', 'Xác nhận tiền dư') as HTMLButtonElement;
const dismissBtn = (c: HTMLElement) => byText(card(c), 'button', 'Không phải tiền dư') as HTMLButtonElement;

const doVerify = async (c: HTMLElement) => {
  click(verifyBtn(c));
  await flush(1);
  answerConfirm(true);
  await flush(2);
};
const doDismiss = async (c: HTMLElement) => {
  click(dismissBtn(c));
  await flush(1);
  answerAsk('Cùng một lần chuyển khoản');
  await flush(2);
};

describe('Trả về hàng chờ', () => {
  it('một khoản đang trả: nút "Trả về hàng chờ" của khoản khác aria-disabled (không busy) và chạm vào không gửi lệnh thứ hai', async () => {
    rows = [processing(), refund({ id: 'r2', orderCode: 'TT-20261001-0002' })];
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(releaseBtn(c));
    await flush(4);
    expect(writes('release')).toBe(1);
    const other = byText(c.querySelector('[data-refund-id="r2"]') as HTMLElement, 'button', /^Trả về hàng chờ/) as HTMLButtonElement;
    expect(other.getAttribute('aria-disabled')).toBe('true');
    expect(other.getAttribute('aria-busy')).toBeNull();
    await tap(other);
    await flush(3);
    expect(writes('release')).toBe(1);
    list.resolve();
    await flush();
  });

  it('chạm đúp cùng một khung hình chỉ gửi một lệnh', async () => {
    rows = [processing()];
    const c = await mount();
    await tap(releaseBtn(c), releaseBtn(c));
    await flush(3);
    expect(writes('release')).toBe(1);
  });

  it('lệnh xong mà danh sách chưa về: nút báo bận bằng aria-busy/aria-disabled (không disabled), chạm tiếp không gửi lệnh thứ hai; về rồi mới nhả', async () => {
    rows = [processing()];
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(releaseBtn(c));
    await flush(4);
    expect(writes('release')).toBe(1);
    expect(lists()).toBe(2);
    const b = releaseBtn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(3);
    expect(writes('release')).toBe(1);
    list.resolve();
    await flush();
    expect(releaseBtn(c).getAttribute('aria-busy')).toBeNull();
    expect(releaseBtn(c).getAttribute('aria-disabled')).toBeNull();
    await tap(releaseBtn(c));
    await flush(3);
    expect(writes('release')).toBe(2);
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    useHangTimers();
    rows = [processing()];
    const c = await mount();
    listGate = new Promise<void>(() => {});
    click(releaseBtn(c));
    await flush(4);
    await advance(3_500);
    expect(releaseBtn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(releaseBtn(c));
    await flush(3);
    expect(writes('release')).toBe(1);
    await advance(600);
    expect(releaseBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('API từ chối vì khoản đã đổi (409): hiện lỗi ngay, tải lại danh sách rồi mới nhả khoá', async () => {
    rows = [processing()];
    writeRoute = () => json(409, { statusCode: 409, message: 'Khoản vừa được xử lý.' });
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(releaseBtn(c));
    await flush(4);
    expect(lists()).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Khoản');
    expect(releaseBtn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(releaseBtn(c));
    await flush(3);
    expect(writes('release')).toBe(1);
    list.resolve();
    await flush();
    expect(releaseBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi 500: hiện lỗi, KHÔNG tải lại danh sách, nhả khoá ngay để thử lại', async () => {
    rows = [processing()];
    writeRoute = () => json(500, { statusCode: 500, message: 'Máy chủ lỗi' });
    const c = await mount();
    click(releaseBtn(c));
    await flush(4);
    expect(lists()).toBe(1);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(releaseBtn(c).getAttribute('aria-disabled')).toBeNull();
    click(releaseBtn(c));
    await flush(4);
    expect(writes('release')).toBe(2);
  });
});

describe('Xác nhận tiền dư', () => {
  it('xong mà danh sách chưa về: nút aria-busy/aria-disabled (không disabled); chạm tiếp không mở hộp hỏi và không gửi lệnh thứ hai; về rồi mới nhả', async () => {
    rows = [unverified()];
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await doVerify(c);
    expect(writes('verify')).toBe(1);
    expect(lists()).toBe(2);
    const b = verifyBtn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    expect(dismissBtn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    await tap(dismissBtn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('verify')).toBe(1);
    expect(writes('dismiss')).toBe(0);
    list.resolve();
    await flush();
    expect(verifyBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    rows = [unverified()];
    const c = await mount();
    listGate = new Promise<void>(() => {});
    await doVerify(c);
    await advance(3_500);
    expect(verifyBtn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(verifyBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('API từ chối vì khoản không còn chờ đối soát (400): tải lại rồi mới nhả khoá', async () => {
    rows = [unverified()];
    writeRoute = () => json(400, { statusCode: 400, message: 'Khoản này không còn chờ đối soát — admin khác vừa xử lý, vui lòng tải lại.' });
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await doVerify(c);
    expect(lists()).toBe(2);
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('không còn chờ đối soát');
    expect(verifyBtn(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(verifyBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lỗi 500: không tải lại danh sách, nhả khoá ngay', async () => {
    rows = [unverified()];
    writeRoute = () => json(500, { statusCode: 500, message: 'Máy chủ lỗi' });
    const c = await mount();
    await doVerify(c);
    expect(lists()).toBe(1);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(verifyBtn(c).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('Không phải tiền dư', () => {
  it('xong mà danh sách chưa về: nút aria-busy/aria-disabled (không disabled), chạm tiếp không mở hộp hỏi; về rồi mới nhả', async () => {
    rows = [unverified()];
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await doDismiss(c);
    expect(writes('dismiss')).toBe(1);
    expect(lists()).toBe(2);
    const b = dismissBtn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    await tap(verifyBtn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('dismiss')).toBe(1);
    list.resolve();
    await flush();
    expect(dismissBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: nhả sau hạn 4 giây', async () => {
    useHangTimers();
    rows = [unverified()];
    const c = await mount();
    listGate = new Promise<void>(() => {});
    await doDismiss(c);
    await advance(3_500);
    expect(dismissBtn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(600);
    expect(dismissBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('API từ chối (404): tải lại rồi mới nhả khoá; lỗi 403 thì không tải lại', async () => {
    rows = [unverified()];
    writeRoute = () => json(404, { statusCode: 404, message: 'Không tìm thấy khoản.' });
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await doDismiss(c);
    expect(lists()).toBe(2);
    expect(dismissBtn(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(dismissBtn(c).getAttribute('aria-disabled')).toBeNull();

    listGate = undefined;
    writeRoute = () => json(403, { statusCode: 403, message: 'Forbidden resource' });
    const before = lists();
    await doDismiss(c);
    expect(lists()).toBe(before);
    expect(dismissBtn(c).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('số dùng tabular-nums', () => {
  it('số tiền của dòng, ngày tạo và tổng số khoản', async () => {
    rows = [unverified()];
    const c = await mount();
    const amount = byText(card(c), 'span', '114.000đ');
    expect(amount?.classList.contains('tabular-nums')).toBe(true);
    const created = byText(card(c), 'span', /^Tạo lúc:/);
    expect(created?.classList.contains('tabular-nums')).toBe(true);
    const total = c.querySelector('b');
    expect(total?.classList.contains('tabular-nums')).toBe(true);
  });
});

