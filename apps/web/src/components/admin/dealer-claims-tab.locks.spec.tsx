// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DealerClaimsTab } from './dealer-claims-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminDealerRewardClaim } from '@/lib/admin-client';

// W96B: duyệt / từ chối / đã trao thưởng / mở lại yêu cầu nhận thưởng đại lý giữ khoá tới khi danh sách làm mới về (tối đa 4 giây), nút báo bận
// bằng aria-busy/aria-disabled (không disabled), lời lỗi ở cấp danh sách để không mất khi dòng rời bộ lọc sau khi tải lại.

const claim = (over: Partial<AdminDealerRewardClaim> = {}): AdminDealerRewardClaim => ({
  id: 'c1',
  userId: 'd1',
  rewardId: 'r1',
  periodKey: 'Q3/2026',
  rewardTitle: 'Tour Đà Lạt',
  rewardType: 'TOUR',
  rewardPeriod: 'QUARTER',
  threshold: 100_000_000,
  volumeAtClaim: 120_000_000,
  note: null,
  status: 'PENDING',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  paidBy: null,
  paidAt: null,
  adminNote: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

let rows: AdminDealerRewardClaim[] = [];
let listLoads = 0;
let listGate: Promise<void> | undefined;
let afterReload: (() => AdminDealerRewardClaim[]) | undefined;
let writeStatus = 200;
let writeBody: unknown = {};
const calls: { method: string; url: string }[] = [];
const writes = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).length;
const lists = () => calls.filter((c) => c.method === 'GET' && c.url.includes('/admin/dealer-reward-claims?')).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  rows = [claim()];
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
      if (method === 'POST') return json(writeStatus, writeStatus === 200 ? claim({ status: 'APPROVED' }) : writeBody);
      if (url.includes('/admin/dealer-reward-claims')) {
        listLoads += 1;
        if (listLoads > 1) await listGate;
        const data = listLoads > 1 && afterReload ? afterReload() : rows;
        return json(200, { data, meta: { page: 1, limit: 20, total: data.length } });
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
  mounted = render(<DealerClaimsTab />);
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
const approveBtn = (c: HTMLElement) => byText(c, 'button', /^Duyệt$/) as HTMLButtonElement;
const rejectBtn = (c: HTMLElement) => byText(c, 'button', /^Từ chối$/) as HTMLButtonElement;

describe('DealerClaimsTab: Duyệt yêu cầu (không có hộp xác nhận)', () => {
  it('chạm đúp cùng một khung hình: chỉ một POST approve', async () => {
    const c = await mount();
    await tap(approveBtn(c), approveBtn(c));
    await flush(3);
    expect(writes('/c1/approve')).toBe(1);
  });

  it('duyệt xong mà danh sách chưa về: nút aria-busy/aria-disabled (không disabled), chạm lại không gửi lệnh; về rồi mới nhả', async () => {
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(approveBtn(c));
    await flush(4);
    expect(writes('/c1/approve')).toBe(1);
    expect(lists()).toBe(2);
    const b = approveBtn(c);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.disabled).toBe(false);
    expect(rejectBtn(c).getAttribute('aria-disabled')).toBe('true');
    expect(rejectBtn(c).getAttribute('aria-busy')).toBeNull();
    await tap(b);
    await flush(2);
    expect(writes('/c1/approve')).toBe(1);
    list.resolve();
    await flush();
    expect(approveBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('danh sách không bao giờ về: còn khoá ở 3,5 giây, nhả sau hạn 4 giây', async () => {
    const c = await mount();
    useHangTimers();
    listGate = new Promise(() => {});
    click(approveBtn(c));
    await flush(4);
    await advance(3_500);
    expect(approveBtn(c).getAttribute('aria-disabled')).toBe('true');
    await advance(700);
    expect(approveBtn(c).getAttribute('aria-disabled')).toBeNull();
  });
});

describe('DealerClaimsTab: Từ chối / Đã trao thưởng / Mở lại giữ khoá', () => {
  it('"Từ chối" có lý do: xong mà danh sách chưa về thì chạm lại không mở hộp hỏi, đúng một POST reject', async () => {
    const c = await mount();
    const note = c.querySelector<HTMLInputElement>('input[aria-label="Ghi chú / lý do"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(note, 'Chưa đủ doanh số');
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const list = gate();
    listGate = list.promise;
    click(rejectBtn(c));
    await flush(1);
    answerConfirm(true);
    await flush(4);
    expect(writes('/c1/reject')).toBe(1);
    expect(rejectBtn(c).getAttribute('aria-busy')).toBe('true');
    expect(rejectBtn(c).disabled).toBe(false);
    await tap(rejectBtn(c));
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('/c1/reject')).toBe(1);
    list.resolve();
    await flush();
  });

  it('"Đã trao thưởng" (APPROVED): xong mà danh sách chưa về thì chạm lại không mở hộp hỏi, đúng một POST mark-paid', async () => {
    rows = [claim({ status: 'APPROVED' })];
    const c = await mount();
    click(byText(c, 'button', /^Đã duyệt, chờ trao thưởng$/));
    await flush();
    const paid = () => Array.from(c.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Đã trao thưởng' && b.getAttribute('role') !== 'tab')!;
    const list = gate();
    listGate = list.promise;
    click(paid());
    await flush(1);
    answerConfirm(true);
    await flush(4);
    expect(writes('/c1/mark-paid')).toBe(1);
    expect(paid().getAttribute('aria-busy')).toBe('true');
    expect(paid().disabled).toBe(false);
    await tap(paid());
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('/c1/mark-paid')).toBe(1);
    list.resolve();
    await flush();
  });

  it('"Mở lại yêu cầu": xong mà danh sách chưa về thì không mở hộp hỏi lần hai, đúng một POST reopen', async () => {
    rows = [claim({ status: 'REJECTED', rejectionReason: 'Thiếu mốc' })];
    const c = await mount();
    click(byText(c, 'button', /^Bị từ chối$/));
    await flush();
    const reopen = () => byText(c, 'button', /^Mở lại yêu cầu$/) as HTMLButtonElement;
    const list = gate();
    listGate = list.promise;
    click(reopen());
    await flush(1);
    answerConfirm(true);
    await flush(4);
    expect(writes('/c1/reopen')).toBe(1);
    expect(reopen().getAttribute('aria-busy')).toBe('true');
    await tap(reopen());
    await flush(2);
    expect(confirmDialog()).toBeNull();
    expect(writes('/c1/reopen')).toBe(1);
    list.resolve();
    await flush();
  });
});

describe('DealerClaimsTab: lời lỗi ở cấp danh sách', () => {
  it('máy chủ từ chối vì yêu cầu đã đổi trạng thái, tải lại làm dòng rời bộ lọc: dòng mất nhưng lời lỗi vẫn còn', async () => {
    writeStatus = 400;
    writeBody = { statusCode: 400, message: 'Yêu cầu này không còn ở trạng thái chờ duyệt.' };
    afterReload = () => [];
    const c = await mount();
    click(approveBtn(c));
    await flush(4);
    expect(lists()).toBe(2);
    // dòng đã rời bộ lọc (lời lỗi nêu tên phần thưởng của yêu cầu nên không dò theo chữ trên cả trang)
    expect(c.querySelector('.tabular-nums.rounded-card')).toBeNull();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Yêu cầu này không còn ở trạng thái chờ duyệt.');
  });

  it('lỗi 500: lời lỗi hiện ngay, danh sách vẫn tải lại, khoá nhả sau khi danh sách về', async () => {
    writeStatus = 500;
    writeBody = { statusCode: 500, message: 'Internal server error' };
    const c = await mount();
    const list = gate();
    listGate = list.promise;
    click(approveBtn(c));
    await flush(4);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(lists()).toBe(2);
    expect(approveBtn(c).getAttribute('aria-disabled')).toBe('true');
    list.resolve();
    await flush();
    expect(approveBtn(c).getAttribute('aria-disabled')).toBeNull();
  });

  it('lời lỗi cũ biến mất khi bấm lần sau thành công', async () => {
    writeStatus = 400;
    writeBody = { statusCode: 400, message: 'Yêu cầu này không còn ở trạng thái chờ duyệt.' };
    const c = await mount();
    click(approveBtn(c));
    await flush(4);
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    writeStatus = 200;
    click(approveBtn(c));
    await flush(4);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('thiếu lý do từ chối: báo ngay trên dòng, không mở hộp hỏi, không gọi API', async () => {
    const c = await mount();
    click(rejectBtn(c));
    await flush();
    expect(confirmDialog()).toBeNull();
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(writes('/reject')).toBe(0);
  });
});

describe('số dùng tabular-nums', () => {
  it('mốc doanh số và doanh số đã chốt trên dòng yêu cầu', async () => {
    const c = await mount();
    const row = Array.from(c.querySelectorAll<HTMLElement>('.rounded-card')).find((e) => e.textContent?.includes('Tour Đà Lạt'))!;
    expect(row.className).toContain('tabular-nums');
  });
});
