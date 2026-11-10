// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletionPanel, type AdminDeletionRequest } from './account-deletion-panel';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';

// W96B: "Xử lý (ẩn danh)" và "Xoá dù còn tiền Ví" (không hoàn tác, trừ tiền Ví) giữ khoá tới khi danh sách làm mới về (tối đa 4 giây), nút báo bận
// bằng aria-busy/aria-disabled (không disabled), lời lỗi ở cấp danh sách để không mất khi dòng rời hàng chờ sau khi tải lại.

const req = (over: Partial<AdminDeletionRequest> = {}): AdminDeletionRequest => ({
  id: 'r1',
  userId: 'u1',
  reason: 'Không dùng nữa',
  status: 'PENDING',
  adminNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  user: {
    id: 'u1',
    fullName: 'Nguyễn Văn A',
    phone: '0912345678',
    role: 'CUSTOMER',
    walletBalance: 0,
    pointsConvertedBalance: 0,
    cashbackPending: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  blockers: [],
  ...over,
});
const walletBlocked = () =>
  req({
    user: { ...req().user!, walletBalance: 50_000 },
    blockers: [{ code: 'WALLET_BALANCE', message: 'Ví Tubu còn 50.000đ.' }],
  });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let rows: AdminDeletionRequest[] = [];
let listLoads = 0;
let listGate: Promise<void> | undefined;
let afterReload: (() => AdminDeletionRequest[]) | undefined;
let writeStatus = 200;
let writeBody: unknown = { alreadyProcessed: false };
const calls: { method: string; url: string }[] = [];
const writes = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/process')).length;
const lists = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/account-deletion-requests?')).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  rows = [req()];
  listLoads = 0;
  listGate = undefined;
  afterReload = undefined;
  writeStatus = 200;
  writeBody = { alreadyProcessed: false };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST') return json(writeStatus, writeBody);
      if (url.includes('/admin/account-deletion-requests')) {
        listLoads += 1;
        if (listLoads > 1) await listGate;
        return json(200, listLoads > 1 && afterReload ? afterReload() : rows);
      }
      return json(200, {});
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
  mounted = render(<AccountDeletionPanel />);
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
const processBtn = (c: HTMLElement) => byText(c, 'button', /^Xử lý \(ẩn danh\)$/) as HTMLButtonElement;
const overrideBtn = (c: HTMLElement) => byText(c, 'button', /^Xoá dù còn tiền Ví$/) as HTMLButtonElement;
const process = async (c: HTMLElement) => {
  click(processBtn(c));
  await flush(1);
  answerConfirm(true);
  await flush(4);
};

describe('AccountDeletionPanel: Xử lý (ẩn danh) giữ khoá tới khi danh sách làm mới về', () => {
  it('xử lý xong mà danh sách chưa về: nút aria-busy/aria-disabled (không disabled), chạm lại không mở hộp hỏi và chỉ một POST; về rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await process(c);
    expect(writes()).toBe(1);
    expect(lists()).toBe(2);
    const b = processBtn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    await tap(b);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes()).toBe(1);
    list.resolve();
    await flush();
    expect(processBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    listGate = new Promise(() => {});
    await process(c);
    await advance(3_500);
    expect(processBtn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(processBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('còn vướng mắc hoặc ghi chú có SĐT: nút vẫn disabled thật (khác với bận)', async () => {
    rows = [req({ blockers: [{ code: 'OPEN_ORDERS', message: 'Còn 1 đơn chưa hoàn tất.' }] })];
    const c = await mount();
    expect(processBtn(c).disabled).toBe(true);
  });
});

describe('AccountDeletionPanel: Xoá dù còn tiền Ví (trừ tiền Ví) giữ khoá', () => {
  it('xong mà danh sách chưa về: chạm lại không mở hộp hỏi, đúng một POST overrideWalletBalance', async () => {
    rows = [walletBlocked()];
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(overrideBtn(c));
    await flush(1);
    answerAsk('khách đã thu hồi đồng ý trên Zalo');
    await flush(4);
    expect(writes()).toBe(1);
    expect(overrideBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(overrideBtn(c).getAttribute('aria-disabled')).toBe('true');
    expect(overrideBtn(c).disabled).toBe(false);
    await tap(overrideBtn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes()).toBe(1);
    list.resolve();
    await flush();
    expect(overrideBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('Ví + vướng mắc khác: nút vẫn disabled thật', async () => {
    rows = [
      req({
        user: { ...req().user!, walletBalance: 50_000 },
        blockers: [
          { code: 'WALLET_BALANCE', message: 'Ví Tubu còn 50.000đ.' },
          { code: 'OPEN_ORDERS', message: 'Còn 1 đơn chưa hoàn tất.' },
        ],
      }),
    ];
    const c = await mount();
    expect(overrideBtn(c).disabled).toBe(true);
  });
});

describe('AccountDeletionPanel: lời lỗi ở cấp danh sách', () => {
  it('máy chủ từ chối vì yêu cầu đã được xử lý ở máy khác, tải lại làm dòng rời hàng chờ: dòng mất nhưng lời lỗi vẫn còn', async () => {
    writeStatus = 400;
    writeBody = { statusCode: 400, message: 'Yêu cầu này đã được xử lý.' };
    afterReload = () => [];
    const c = await mount();
    await process(c);
    expect(lists()).toBe(2);
    expect(c.textContent).not.toContain('Nguyễn Văn A');
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Yêu cầu này đã được xử lý.');
  });

  it('lỗi 500: lời lỗi hiện ngay, danh sách vẫn tải lại, khoá nhả sau khi danh sách về', async () => {
    writeStatus = 500;
    writeBody = { statusCode: 500, message: 'Internal server error' };
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await process(c);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(lists()).toBe(2);
    expect(processBtn(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(processBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lời lỗi cũ biến mất khi bấm lần sau thành công', async () => {
    writeStatus = 400;
    writeBody = { statusCode: 400, message: 'Yêu cầu này đã được xử lý.' };
    const c = await mount();
    await process(c);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    writeStatus = 200;
    writeBody = { alreadyProcessed: false };
    await process(c);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('số dùng tabular-nums', () => {
  it('số dư Ví và Điểm Xanh trên dòng yêu cầu', async () => {
    const c = await mount();
    const row = Array.from(c.querySelectorAll<HTMLElement>('.rounded-card')).find((e) => e.textContent?.includes('Nguyễn Văn A'))!;
    expect(row.className).toContain('tabular-nums');
  });
});
