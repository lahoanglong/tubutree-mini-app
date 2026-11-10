// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PayoutAdminTab } from './payout-admin-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';
import type { AdminPayout } from '@/lib/admin-client';

// Review W96B (A4): lời lỗi của lệnh ghi nằm ở danh sách (dòng có thể rời bộ lọc sau khi tải lại), mỗi lệnh rút giữ lời lỗi riêng, nêu đúng lệnh nào,
// và chỉ mất khi lệnh MỚI bắt đầu ở chính dòng đó. Lệnh của dòng khác (thành công hay lỗi) không được xoá hay thay lời của dòng này.

const payout = (over: Partial<AdminPayout> = {}): AdminPayout => ({
  id: 'p1',
  userId: 'u1',
  amount: 1_500_000,
  fee: 0,
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
// Hàng A đã duyệt chờ chi (nút "Đã chuyển khoản"), hàng B đang chờ duyệt (nút "Duyệt"), người nhận và số tiền khác nhau.
const rowA = () => payout({ id: 'pa-111111', amount: 2_000_000, status: 'APPROVED', user: { id: 'ua', fullName: 'Trần Thị A', phone: '0900000011', referralCode: 'TTA' } });
const rowB = () => payout({ id: 'pb-222222', amount: 700_000, status: 'REQUESTED', user: { id: 'ub', fullName: 'Lê Văn B', phone: '0900000022', referralCode: 'LVB' } });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let rows: AdminPayout[] = [];
/** Trạng thái trả về của lệnh ghi theo đoạn URL; không khai thì 200. */
let writeBy: Record<string, { status: number; message?: string }> = {};
const calls: { method: string; url: string }[] = [];
const writes = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  rows = [rowA(), rowB()];
  writeBy = {};
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST') {
        const key = Object.keys(writeBy).find((k) => url.includes(k));
        const w = key ? writeBy[key]! : { status: 200 };
        return w.status === 200 ? json(200, payout({ status: 'PAID' })) : json(w.status, { statusCode: w.status, message: w.message ?? 'Lỗi' });
      }
      if (url.includes('/pit-report')) return json(200, { month: '2026-10', rows: [], totals: { recipients: 0, withheldRecipients: 0, grossAmount: 0, taxWithheld: 0, netAmount: 0 } });
      return json(200, { data: rows, meta: { page: 1, limit: 20, total: rows.length } });
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const mount = async () => {
  mounted = render(<PayoutAdminTab />);
  await flush();
  return mounted.container;
};
const rowOf = (c: HTMLElement, who: string) => Array.from(c.querySelectorAll<HTMLElement>('.tabular-nums.rounded-card')).find((e) => e.textContent?.includes(who))!;
const btnIn = (row: HTMLElement, label: RegExp) => Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find((b) => label.test(b.textContent ?? ''))!;
const alerts = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="alert"]')).map((a) => a.textContent ?? '');
const markPaidA = async (c: HTMLElement) => {
  click(btnIn(rowOf(c, 'Trần Thị A'), /^Đã chuyển khoản$/));
  await flush(1);
  answerConfirm(true);
  await flush(4);
};
const approveB = async (c: HTMLElement) => {
  click(btnIn(rowOf(c, 'Lê Văn B'), /^Duyệt$/));
  await flush(1);
  answerConfirm(true);
  await flush(4);
};

describe('PayoutAdminTab: lời lỗi theo từng lệnh rút (review A4)', () => {
  it('chi lệnh A gặp 502 rồi duyệt lệnh B thành công: lời nhắc tải lại của A vẫn còn', async () => {
    writeBy['/pa-111111/mark-paid'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await markPaidA(c);
    expect(alerts(c)).toHaveLength(1);
    expect(alerts(c)[0]).toContain('trước khi chi lần nữa');
    await approveB(c);
    expect(writes('/pb-222222/approve')).toBe(1);
    const after = alerts(c);
    expect(after).toHaveLength(1);
    expect(after[0]).toContain('trước khi chi lần nữa');
  });

  it('lời lỗi nêu đúng lệnh nào: số tiền, người nhận và mã lệnh', async () => {
    writeBy['/pa-111111/mark-paid'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await markPaidA(c);
    const text = alerts(c)[0]!;
    expect(text).toContain('2.000.000');
    expect(text).toContain('Trần Thị A');
    expect(text).toContain('111111');
    expect(text).not.toContain('Lê Văn B');
  });

  it('lời lỗi của A mất khi lệnh MỚI bắt đầu ở chính dòng A (ngay khi bấm, trước cả hộp hỏi)', async () => {
    writeBy['/pa-111111/mark-paid'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await markPaidA(c);
    expect(alerts(c)).toHaveLength(1);
    click(btnIn(rowOf(c, 'Trần Thị A'), /^Đã chuyển khoản$/));
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    expect(alerts(c)).toHaveLength(0);
    answerConfirm(false);
    await flush(2);
  });

  it('bấm nút ở dòng B (mở hộp hỏi rồi huỷ) không xoá lời lỗi của A', async () => {
    writeBy['/pa-111111/mark-paid'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await markPaidA(c);
    click(btnIn(rowOf(c, 'Lê Văn B'), /^Duyệt$/));
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush(2);
    expect(alerts(c)).toHaveLength(1);
    expect(alerts(c)[0]).toContain('Trần Thị A');
  });

  it('hai lệnh ở hai dòng cùng lỗi: cả hai lời lỗi đều hiện, mỗi lời nêu đúng người nhận của mình', async () => {
    writeBy['/pa-111111/mark-paid'] = { status: 502, message: 'Bad Gateway' };
    writeBy['/pb-222222/approve'] = { status: 503, message: 'Unavailable' };
    const c = await mount();
    await markPaidA(c);
    await approveB(c);
    const list = alerts(c);
    expect(list).toHaveLength(2);
    expect(list.filter((t) => t.includes('Trần Thị A'))).toHaveLength(1);
    expect(list.filter((t) => t.includes('Lê Văn B'))).toHaveLength(1);
  });

  it('lệnh B lỗi lần hai ở chính dòng B thay lời cũ của B, không nhân đôi và không đụng lời của A', async () => {
    writeBy['/pa-111111/mark-paid'] = { status: 502, message: 'Bad Gateway' };
    writeBy['/pb-222222/approve'] = { status: 503, message: 'Unavailable' };
    const c = await mount();
    await markPaidA(c);
    await approveB(c);
    await approveB(c);
    expect(writes('/pb-222222/approve')).toBe(2);
    const list = alerts(c);
    expect(list).toHaveLength(2);
    expect(list.filter((t) => t.includes('Lê Văn B'))).toHaveLength(1);
    expect(list.filter((t) => t.includes('Trần Thị A'))).toHaveLength(1);
  });

  it('đổi bộ lọc trạng thái: các lời lỗi cũ được dọn', async () => {
    writeBy['/pa-111111/mark-paid'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await markPaidA(c);
    expect(alerts(c)).toHaveLength(1);
    click(byText(c, 'button', /^Đã duyệt, chờ chuyển khoản$/));
    await flush();
    expect(alerts(c)).toHaveLength(0);
  });
});
