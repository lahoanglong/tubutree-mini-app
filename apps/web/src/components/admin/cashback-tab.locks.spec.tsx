// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashbackTab } from './cashback-tab';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';

// W96B: duyệt / từ chối hoàn tiền sàn ngoài (TIỀN vào Ví khách) giữ khoá tới khi danh sách làm mới về (tối đa 4 giây), CHỜ tải lại khi máy chủ từ chối vì
// giao dịch đã đổi (400/404/409), nút báo bận bằng aria-busy/aria-disabled (không disabled). Spec dựng QueryClient trần (không có MutationCache như
// createQueryClient trên production, nơi mọi mutation settle đều làm cũ khoá admin-*): chỉ kiểm việc chờ và nhả khoá, không kiểm có tải lại nền hay không.

const txn = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  provider: 'accesstrade',
  merchantOrderId: `SP-${id}`,
  orderAmount: 500_000,
  commission: 25_000,
  userReward: 12_000,
  status: 'PENDING',
  confirmedAt: null,
  paidAt: null,
  user: { id: 'u1', fullName: 'Nguyễn An', phone: '0900000001' },
  merchant: { name: 'Shopee', slug: 'shopee' },
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let rows: ReturnType<typeof txn>[] = [];
let listLoads = 0;
let listGate: Promise<void> | undefined;
let afterReload: (() => ReturnType<typeof txn>[]) | undefined;
let writeStatus = 200;
let writeBody: unknown = {};
const calls: { method: string; url: string }[] = [];
const reviews = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/review')).length;
const lists = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/cashback/transactions')).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  rows = [txn('t1'), txn('t2')];
  listLoads = 0;
  listGate = undefined;
  afterReload = undefined;
  writeStatus = 200;
  writeBody = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST') return json(writeStatus, writeStatus === 200 ? txn('t1', { status: 'CONFIRMED' }) : writeBody);
      listLoads += 1;
      if (listLoads > 1) await listGate;
      return json(200, listLoads > 1 && afterReload ? afterReload() : rows);
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
  mounted = render(<CashbackTab />);
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
const approveBtns = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Duyệt hoàn tiền');
const rejectBtns = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Từ chối');
const approveFirst = async (c: HTMLElement) => {
  click(approveBtns(c)[0]!);
  await flush(1);
  answerConfirm(true);
  await flush(4);
};

describe('CashbackTab: Duyệt hoàn tiền giữ khoá tới khi danh sách làm mới về', () => {
  it('duyệt xong mà danh sách chưa về: mọi nút aria-disabled (không disabled), nút vừa bấm aria-busy, chạm lại không mở hộp hỏi và chỉ một POST; về rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await approveFirst(c);
    expect(reviews()).toBe(1);
    expect(lists()).toBe(2);
    for (const b of [...approveBtns(c), ...rejectBtns(c)]) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.disabled).toBe(false);
    }
    expect(approveBtns(c)[0]!.getAttribute('aria-busy')).toBe('true');
    expect(approveBtns(c)[1]!.getAttribute('aria-busy')).toBeNull();
    // chạm lại đúng nút vừa bấm và cả nút của giao dịch khác: không mở hộp hỏi, không gửi thêm
    await tap(approveBtns(c)[0]!);
    await tap(approveBtns(c)[1]!);
    await tap(rejectBtns(c)[1]!);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(reviews()).toBe(1);
    list.resolve();
    await flush();
    expect(approveBtns(c)[0]!.getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    listGate = new Promise(() => {});
    await approveFirst(c);
    await advance(3_500);
    expect(approveBtns(c)[0]!.getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(approveBtns(c)[0]!.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('CashbackTab: Từ chối hoàn tiền giữ khoá', () => {
  it('từ chối xong mà danh sách chưa về: chạm lại không mở hộp hỏi, đúng một POST', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(rejectBtns(c)[0]!);
    await flush(1);
    answerAsk('Sàn báo huỷ đơn');
    await flush(4);
    expect(reviews()).toBe(1);
    expect(rejectBtns(c)[0]!.getAttribute('aria-busy')).toBe('true');
    expect(rejectBtns(c)[0]!.disabled).toBe(false);
    await tap(rejectBtns(c)[0]!);
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(reviews()).toBe(1);
    list.resolve();
    await flush();
  });
});

describe('CashbackTab: lệnh bị từ chối vì giao dịch đã đổi', () => {
  it.each([400, 404, 409])('%i: hiện lỗi ngay rồi tải lại danh sách, giữ khoá tới khi danh sách về', async (status) => {
    writeStatus = status;
    writeBody = { statusCode: status, message: 'Giao dịch này đã được duyệt trước đó.' };
    afterReload = () => [txn('t2')];
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    await approveFirst(c);
    expect(c.textContent).toContain('Giao dịch này đã được duyệt trước đó.');
    expect(lists()).toBe(2);
    expect(approveBtns(c)[0]!.getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(approveBtns(c)).toHaveLength(1);
    expect(approveBtns(c)[0]!.getAttribute('aria-disabled')).toBeNull();
    expect(c.textContent).toContain('Giao dịch này đã được duyệt trước đó.');
  });

  it.each([500, 403])('%i: hiện lỗi, không chờ tải lại (không gọi tải lại từ chính lệnh này), nhả khoá ngay', async (status) => {
    writeStatus = status;
    writeBody = { statusCode: status, message: 'Máy chủ đang bận' };
    const c = await mount();
    await approveFirst(c);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(lists()).toBe(1);
    expect(approveBtns(c)[0]!.getAttribute('aria-disabled')).toBeNull();
    expect(approveBtns(c)[0]!.getAttribute('aria-busy')).toBeNull();
  });

  it('lời lỗi cũ biến mất sau lần duyệt thành công kế tiếp', async () => {
    writeStatus = 409;
    writeBody = { statusCode: 409, message: 'Giao dịch này đã được duyệt trước đó.' };
    const c = await mount();
    await approveFirst(c);
    expect(c.textContent).toContain('đã được duyệt trước đó');
    writeStatus = 200;
    await approveFirst(c);
    expect(c.textContent).not.toContain('đã được duyệt trước đó');
  });
});

describe('số dùng tabular-nums', () => {
  it('số tiền đơn, hoa hồng và tiền khách nhận trên thẻ giao dịch', async () => {
    const c = await mount();
    const card = Array.from(c.querySelectorAll<HTMLElement>('.rounded-card')).find((e) => e.textContent?.includes('SP-t1'))!;
    expect(card.className).toContain('tabular-nums');
  });
});
