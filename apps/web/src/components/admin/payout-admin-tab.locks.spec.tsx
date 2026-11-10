// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutAdminTab } from './payout-admin-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminPayout } from '@/lib/admin-client';

// W96B: duyệt / từ chối / chi lệnh rút (TIỀN) giữ khoá tới khi danh sách làm mới về (tối đa 4 giây), nút báo bận bằng aria-busy/aria-disabled
// (không disabled), lời lỗi ở cấp danh sách để không mất khi dòng rời bộ lọc sau khi tải lại.

const payout = (over: Partial<AdminPayout> = {}): AdminPayout => ({
  id: 'p1',
  userId: 'u1',
  amount: 1_500_000,
  fee: 3_000,
  method: 'BANK',
  bankInfo: { bankName: 'VCB', accountNumber: '0123456789', accountName: 'NGUYEN A' },
  status: 'REQUESTED',
  requestedAt: '2026-10-01T00:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  paidBy: null,
  paidAt: null,
  bankRef: null,
  adminNote: null,
  user: { id: 'u1', fullName: 'Nguyễn A', phone: '0900000001', referralCode: 'AAAA1111' },
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let rows: AdminPayout[] = [];
let listLoads = 0;
let listGate: Promise<void> | undefined;
/** Từ lần tải danh sách thứ hai trở đi trả dòng này (mô phỏng dòng đã rời bộ lọc). */
let afterReload: (() => AdminPayout[]) | undefined;
let writeStatus = 200;
let writeBody: unknown = {};
const calls: { method: string; url: string }[] = [];
const writes = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).length;
const lists = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/payouts?')).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  rows = [payout()];
  listLoads = 0;
  listGate = undefined;
  afterReload = undefined;
  writeStatus = 200;
  writeBody = {};
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST') return json(writeStatus, writeStatus === 200 ? payout({ status: 'APPROVED' }) : writeBody);
      if (url.includes('/pit-report')) return json(200, { month: '2026-10', rows: [], totals: { recipients: 0, withheldRecipients: 0, grossAmount: 0, taxWithheld: 0, netAmount: 0 } });
      listLoads += 1;
      if (listLoads > 1) await listGate;
      const data = listLoads > 1 && afterReload ? afterReload() : rows;
      return json(200, { data, meta: { page: 1, limit: 20, total: data.length } });
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
  mounted = render(<PayoutAdminTab />);
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
const approveBtn = (c: HTMLElement) => byText(c, 'button', /^Duyệt$/) as HTMLButtonElement;
const rejectBtn = (c: HTMLElement) => byText(c, 'button', /^Từ chối \(hoàn tiền\)$/) as HTMLButtonElement;
const paidBtn = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Đã chuyển khoản' && b.getAttribute('role') !== 'tab')!;
const approve = async (c: HTMLElement) => {
  click(approveBtn(c));
  await flush(1);
  answerConfirm(true);
  await flush(4);
};

describe('PayoutAdminTab: Duyệt lệnh rút giữ khoá tới khi danh sách làm mới về', () => {
  it('duyệt xong mà danh sách chưa về: nút báo bận bằng aria-busy/aria-disabled (không disabled), chạm lại không mở hộp hỏi và chỉ một POST; về rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await approve(c);
    expect(writes('/p1/approve')).toBe(1);
    expect(lists()).toBe(2);
    const b = approveBtn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    // chỉ nút vừa bấm báo bận; nút Từ chối chỉ aria-disabled
    expect(rejectBtn(c).getAttribute('aria-busy')).toBeNull();
    expect(rejectBtn(c).getAttribute('aria-disabled')).toBe('true');
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('/p1/approve')).toBe(1);
    list.resolve();
    await flush();
    expect(approveBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lệnh còn bay: nút Duyệt, Từ chối đều aria-busy/aria-disabled, không disabled', async () => {
    const c = await mount();
    const post = gate();
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') await post.promise;
        return real(url, init);
      }),
    );
    click(approveBtn(c));
    await flush(1);
    answerConfirm(true);
    await flush(2);
    for (const b of [approveBtn(c), rejectBtn(c)]) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.disabled).toBe(false);
    }
    expect(approveBtn(c).getAttribute('aria-busy')).toBe('true');
    post.resolve();
    await flush();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    listGate = new Promise(() => {});
    await approve(c);
    await advance(3_500);
    expect(approveBtn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(approveBtn(c).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('PayoutAdminTab: Đã chuyển khoản (chi tiền) giữ khoá tới khi danh sách làm mới về', () => {
  it('chi xong mà danh sách chưa về: chạm lại không mở hộp hỏi, đúng một POST mark-paid', async () => {
    rows = [payout({ status: 'APPROVED' })];
    const c = await mount();
    // mặc định lọc REQUESTED: chuyển sang "Đã duyệt"
    click(byText(c, 'button', /^Đã duyệt, chờ chuyển khoản$/));
    await flush();
    const list = gate();
    listGate = list.promise;
    click(paidBtn(c));
    await flush(1);
    answerConfirm(true);
    await flush(4);
    expect(writes('/p1/mark-paid')).toBe(1);
    expect(paidBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(paidBtn(c).disabled).toBe(false);
    await tap(paidBtn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('/p1/mark-paid')).toBe(1);
    list.resolve();
    await flush();
  });
});

describe('PayoutAdminTab: lời lỗi ở cấp danh sách', () => {
  it('máy chủ từ chối 400 vì lệnh đã được duyệt ở máy khác, danh sách tải lại làm dòng rời bộ lọc: dòng mất nhưng lời lỗi vẫn còn', async () => {
    writeStatus = 400;
    writeBody = { statusCode: 400, message: 'Lệnh rút này đã được duyệt trước đó.' };
    afterReload = () => [];
    const c = await mount();
    await approve(c);
    expect(lists()).toBe(2);
    // dòng đã rời bộ lọc (lời lỗi nêu số tiền của lệnh nên không dò theo chữ trên cả trang)
    expect(c.querySelector('.tabular-nums.rounded-card')).toBeNull();
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Lệnh rút này đã được duyệt trước đó.');
  });

  it('lỗi 500: lời lỗi hiện ngay kèm nhắc tải lại, danh sách vẫn được tải lại, nút nhả sau khi danh sách về', async () => {
    writeStatus = 500;
    writeBody = { statusCode: 500, message: 'Internal server error' };
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await approve(c);
    expect(c.querySelector('[role="alert"]')?.textContent).toMatch(/Tải lại danh sách/);
    expect(lists()).toBe(2);
    expect(approveBtn(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(approveBtn(c).getAttribute('aria-disabled')).toBeNull();
    expect(writes('/p1/approve')).toBe(1);
  });

  it('thiếu lý do từ chối: báo tại chỗ trên dòng, không mở hộp hỏi, không gọi API', async () => {
    const c = await mount();
    click(rejectBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toMatch(/lý do/i);
    expect(writes('/reject')).toBe(0);
  });

  it('lời lỗi cũ biến mất khi bấm lần sau', async () => {
    writeStatus = 400;
    writeBody = { statusCode: 400, message: 'Lệnh rút này đã được duyệt trước đó.' };
    const c = await mount();
    await approve(c);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    writeStatus = 200;
    await approve(c);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('PayoutAdminTab: Từ chối (hoàn tiền) giữ khoá', () => {
  it('từ chối xong mà danh sách chưa về: chạm lại không mở hộp hỏi, đúng một POST reject', async () => {
    const c = await mount();
    typeInto(c.querySelector('input'), 'Sai số tài khoản');
    const list = gate();
    listGate = list.promise;
    click(rejectBtn(c));
    await flush(1);
    answerConfirm(true);
    await flush(4);
    expect(writes('/p1/reject')).toBe(1);
    expect(rejectBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(rejectBtn(c).disabled).toBe(false);
    await tap(rejectBtn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('/p1/reject')).toBe(1);
    list.resolve();
    await flush();
  });
});

describe('số dùng tabular-nums', () => {
  it('số tiền, phí và thuế trên dòng lệnh rút', async () => {
    const c = await mount();
    const row = Array.from(c.querySelectorAll<HTMLElement>('.rounded-card')).find((e) => e.textContent?.includes('Nguyễn A'))!;
    expect(row.className).toContain('tabular-nums');
  });
});
