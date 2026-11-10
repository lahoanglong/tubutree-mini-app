// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletionPanel, type AdminDeletionRequest } from './account-deletion-panel';
import { answerAsk, answerConfirm, byText, click, confirmDialog, flush, render, type Rendered } from '@/test-utils/dom';

// Review W96B (A4): lời lỗi của lệnh ghi nằm ở danh sách (dòng có thể rời hàng chờ sau khi tải lại), mỗi yêu cầu giữ lời lỗi riêng, nêu đúng yêu cầu của ai,
// và chỉ mất khi lệnh MỚI bắt đầu ở chính dòng đó. Lệnh của dòng khác (thành công hay lỗi) không được xoá hay thay lời của dòng này.

const req = (over: Partial<AdminDeletionRequest> = {}): AdminDeletionRequest => ({
  id: 'r1',
  userId: 'u1',
  reason: 'Không dùng nữa',
  status: 'PENDING',
  adminNote: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-01T03:00:00.000Z',
  user: { id: 'u1', fullName: 'Nguyễn Văn A', phone: '0912345678', role: 'CUSTOMER', walletBalance: 0, pointsConvertedBalance: 0, cashbackPending: 0, createdAt: '2026-01-01T00:00:00.000Z' },
  blockers: [],
  ...over,
});
const rowA = () => req({ id: 'ra-111111', userId: 'ua', user: { ...req().user!, id: 'ua', fullName: 'Trần Thị A', phone: '0900000011' } });
const rowB = () => req({ id: 'rb-222222', userId: 'ub', user: { ...req().user!, id: 'ub', fullName: 'Lê Văn B', phone: '0900000022' } });
const rowAWallet = () =>
  req({
    id: 'ra-111111',
    userId: 'ua',
    user: { ...req().user!, id: 'ua', fullName: 'Trần Thị A', phone: '0900000011', walletBalance: 50_000 },
    blockers: [{ code: 'WALLET_BALANCE', message: 'Ví Tubu còn 50.000đ.' }],
  });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let rows: AdminDeletionRequest[] = [];
/** Trạng thái trả về của lệnh ghi theo đoạn URL; không khai thì 200. */
let writeBy: Record<string, { status: number; message?: string }> = {};
const calls: { method: string; url: string }[] = [];
const writes = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  rows = [rowA(), rowB()];
  writeBy = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST') {
        const key = Object.keys(writeBy).find((k) => url.includes(k));
        const w = key ? writeBy[key]! : { status: 200 };
        return w.status === 200 ? json(200, { alreadyProcessed: false }) : json(w.status, { statusCode: w.status, message: w.message ?? 'Lỗi' });
      }
      if (url.includes('/admin/account-deletion-requests')) return json(200, rows);
      return json(200, {});
    }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const mount = async () => {
  mounted = render(<AccountDeletionPanel />);
  await flush();
  return mounted.container;
};
const rowOf = (c: HTMLElement, who: string) => Array.from(c.querySelectorAll<HTMLElement>('.tabular-nums.rounded-card')).find((e) => e.textContent?.includes(who))!;
const btnIn = (row: HTMLElement, label: RegExp) => Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find((b) => label.test(b.textContent ?? ''))!;
const alerts = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="alert"]')).map((a) => a.textContent ?? '');
const processRow = async (c: HTMLElement, who: string) => {
  click(btnIn(rowOf(c, who), /^Xử lý \(ẩn danh\)$/));
  await flush(1);
  answerConfirm(true);
  await flush(4);
};

describe('AccountDeletionPanel: lời lỗi theo từng yêu cầu (review A4)', () => {
  it('xử lý yêu cầu A gặp 502 rồi xử lý yêu cầu B thành công: lời lỗi của A vẫn còn', async () => {
    writeBy['/ra-111111/process'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await processRow(c, 'Trần Thị A');
    expect(alerts(c)).toHaveLength(1);
    await processRow(c, 'Lê Văn B');
    expect(writes('/rb-222222/process')).toBe(1);
    const after = alerts(c);
    expect(after).toHaveLength(1);
    expect(after[0]).toContain('Trần Thị A');
  });

  it('lời lỗi nêu đúng yêu cầu của ai: tên khách và mã yêu cầu', async () => {
    writeBy['/ra-111111/process'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await processRow(c, 'Trần Thị A');
    const text = alerts(c)[0]!;
    expect(text).toContain('Trần Thị A');
    expect(text).toContain('111111');
    expect(text).not.toContain('Lê Văn B');
  });

  it('lời lỗi của A mất khi lệnh MỚI bắt đầu ở chính dòng A (ngay khi bấm, trước cả hộp hỏi)', async () => {
    writeBy['/ra-111111/process'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await processRow(c, 'Trần Thị A');
    expect(alerts(c)).toHaveLength(1);
    click(btnIn(rowOf(c, 'Trần Thị A'), /^Xử lý \(ẩn danh\)$/));
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    expect(alerts(c)).toHaveLength(0);
    answerConfirm(false);
    await flush(2);
  });

  it('bấm nút ở dòng B (mở hộp hỏi rồi huỷ) không xoá lời lỗi của A', async () => {
    writeBy['/ra-111111/process'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await processRow(c, 'Trần Thị A');
    click(btnIn(rowOf(c, 'Lê Văn B'), /^Xử lý \(ẩn danh\)$/));
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush(2);
    expect(alerts(c)).toHaveLength(1);
    expect(alerts(c)[0]).toContain('Trần Thị A');
  });

  it('hai yêu cầu cùng lỗi: cả hai lời lỗi đều hiện, mỗi lời nêu đúng khách của mình', async () => {
    writeBy['/ra-111111/process'] = { status: 502, message: 'Bad Gateway' };
    writeBy['/rb-222222/process'] = { status: 503, message: 'Unavailable' };
    const c = await mount();
    await processRow(c, 'Trần Thị A');
    await processRow(c, 'Lê Văn B');
    const list = alerts(c);
    expect(list).toHaveLength(2);
    expect(list.filter((t) => t.includes('Trần Thị A'))).toHaveLength(1);
    expect(list.filter((t) => t.includes('Lê Văn B'))).toHaveLength(1);
  });

  it('"Xoá dù còn tiền Ví" của A lỗi rồi xử lý B thành công: lời lỗi của A (trừ tiền Ví) vẫn còn', async () => {
    rows = [rowAWallet(), rowB()];
    writeBy['/ra-111111/process'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    click(btnIn(rowOf(c, 'Trần Thị A'), /^Xoá dù còn tiền Ví$/));
    await flush(1);
    answerAsk('khách đã thu hồi đồng ý trên Zalo');
    await flush(4);
    expect(writes('/ra-111111/process')).toBe(1);
    expect(alerts(c)).toHaveLength(1);
    await processRow(c, 'Lê Văn B');
    expect(writes('/rb-222222/process')).toBe(1);
    expect(alerts(c)).toHaveLength(1);
    expect(alerts(c)[0]).toContain('Trần Thị A');
  });

  it('lời lỗi của "Xoá dù còn tiền Ví" ở A mất khi lệnh MỚI bắt đầu ở chính dòng A (ngay khi bấm, trước hộp nhập lý do)', async () => {
    rows = [rowAWallet(), rowB()];
    writeBy['/ra-111111/process'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    click(btnIn(rowOf(c, 'Trần Thị A'), /^Xoá dù còn tiền Ví$/));
    await flush(1);
    answerAsk('khách đã thu hồi đồng ý trên Zalo');
    await flush(4);
    expect(alerts(c)).toHaveLength(1);
    click(btnIn(rowOf(c, 'Trần Thị A'), /^Xoá dù còn tiền Ví$/));
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    expect(alerts(c)).toHaveLength(0);
    answerConfirm(false);
    await flush(2);
  });

  it('đổi bộ lọc: các lời lỗi cũ được dọn', async () => {
    writeBy['/ra-111111/process'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await processRow(c, 'Trần Thị A');
    expect(alerts(c)).toHaveLength(1);
    click(byText(c, 'button', /^Tất cả$/));
    await flush();
    expect(alerts(c)).toHaveLength(0);
  });
});
