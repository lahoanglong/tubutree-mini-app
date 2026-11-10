// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DealerClaimsTab } from './dealer-claims-tab';
import { answerConfirm, byText, click, confirmDialog, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import type { AdminDealerRewardClaim } from '@/lib/admin-client';

// Review W96B (A4): lời lỗi của lệnh ghi nằm ở danh sách (dòng có thể rời bộ lọc sau khi tải lại), mỗi yêu cầu giữ lời lỗi riêng, nêu đúng yêu cầu nào,
// và chỉ mất khi lệnh MỚI bắt đầu ở chính dòng đó. Lệnh của dòng khác (thành công hay lỗi) không được xoá hay thay lời của dòng này.

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
const rowA = () => claim({ id: 'ca-111111', userId: 'da', rewardTitle: 'Tour Đà Lạt', dealer: { id: 'da', fullName: null, phone: '0900000011', businessName: 'Đại lý Hoa A' } });
const rowB = () => claim({ id: 'cb-222222', userId: 'db', rewardTitle: 'Quà Phú Quốc', dealer: { id: 'db', fullName: null, phone: '0900000022', businessName: 'Đại lý Sen B' } });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let rows: AdminDealerRewardClaim[] = [];
/** Trạng thái trả về của lệnh ghi theo đoạn URL; không khai thì 200. */
let writeBy: Record<string, { status: number; message?: string }> = {};
/** Giữ lệnh ghi lại tới khi mở cổng (để quan sát lúc lệnh còn bay). */
let postGate: Promise<void> | undefined;
const calls: { method: string; url: string }[] = [];
const writes = (part: string) => calls.filter((c) => c.method === 'POST' && c.url.includes(part)).length;

let mounted: Rendered | null = null;
beforeEach(() => {
  calls.length = 0;
  rows = [rowA(), rowB()];
  writeBy = {};
  postGate = undefined;
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (method === 'POST') {
        if (postGate) await postGate;
        const key = Object.keys(writeBy).find((k) => url.includes(k));
        const w = key ? writeBy[key]! : { status: 200 };
        return w.status === 200 ? json(200, claim({ status: 'APPROVED' })) : json(w.status, { statusCode: w.status, message: w.message ?? 'Lỗi' });
      }
      if (url.includes('/admin/dealer-reward-claims')) return json(200, { data: rows, meta: { page: 1, limit: 20, total: rows.length } });
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
  mounted = render(<DealerClaimsTab />);
  await flush();
  return mounted.container;
};
const rowOf = (c: HTMLElement, who: string) => Array.from(c.querySelectorAll<HTMLElement>('.tabular-nums.rounded-card')).find((e) => e.textContent?.includes(who))!;
const btnIn = (row: HTMLElement, label: RegExp) => Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find((b) => label.test(b.textContent ?? ''))!;
const alerts = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[role="alert"]')).map((a) => a.textContent ?? '');
const approveRow = async (c: HTMLElement, who: string) => {
  click(btnIn(rowOf(c, who), /^Duyệt$/));
  await flush(4);
};

describe('DealerClaimsTab: lời lỗi theo từng yêu cầu (review A4)', () => {
  it('duyệt yêu cầu A gặp 502 rồi duyệt yêu cầu B thành công: lời lỗi của A vẫn còn', async () => {
    writeBy['/ca-111111/approve'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await approveRow(c, 'Đại lý Hoa A');
    expect(alerts(c)).toHaveLength(1);
    await approveRow(c, 'Đại lý Sen B');
    expect(writes('/cb-222222/approve')).toBe(1);
    const after = alerts(c);
    expect(after).toHaveLength(1);
    expect(after[0]).toContain('Đại lý Hoa A');
  });

  it('lời lỗi nêu đúng yêu cầu nào: phần thưởng, đại lý, kỳ và mã yêu cầu', async () => {
    writeBy['/ca-111111/approve'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await approveRow(c, 'Đại lý Hoa A');
    const text = alerts(c)[0]!;
    expect(text).toContain('Tour Đà Lạt');
    expect(text).toContain('Đại lý Hoa A');
    expect(text).toContain('Q3/2026');
    expect(text).toContain('111111');
    expect(text).not.toContain('Đại lý Sen B');
  });

  it('lời lỗi của A mất ngay khi lệnh MỚI bắt đầu ở chính dòng A (lúc lệnh còn bay, không đợi kết quả)', async () => {
    writeBy['/ca-111111/approve'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await approveRow(c, 'Đại lý Hoa A');
    expect(alerts(c)).toHaveLength(1);
    writeBy = {};
    let open!: () => void;
    postGate = new Promise<void>((r) => (open = r));
    click(btnIn(rowOf(c, 'Đại lý Hoa A'), /^Duyệt$/));
    await flush(2);
    expect(writes('/ca-111111/approve')).toBe(2);
    expect(alerts(c)).toHaveLength(0);
    open();
    await flush(3);
    expect(alerts(c)).toHaveLength(0);
  });

  it('bấm Từ chối ở dòng B (mở hộp hỏi rồi huỷ) không xoá lời lỗi của A', async () => {
    writeBy['/ca-111111/approve'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await approveRow(c, 'Đại lý Hoa A');
    const rowB_ = rowOf(c, 'Đại lý Sen B');
    typeInto(rowB_.querySelector('input'), 'Chưa đủ doanh số');
    click(btnIn(rowB_, /^Từ chối$/));
    await flush(1);
    expect(confirmDialog()).not.toBeNull();
    answerConfirm(false);
    await flush(2);
    expect(alerts(c)).toHaveLength(1);
    expect(alerts(c)[0]).toContain('Đại lý Hoa A');
  });

  it('hai yêu cầu cùng lỗi: cả hai lời lỗi đều hiện, mỗi lời nêu đúng đại lý của mình', async () => {
    writeBy['/ca-111111/approve'] = { status: 502, message: 'Bad Gateway' };
    writeBy['/cb-222222/approve'] = { status: 503, message: 'Unavailable' };
    const c = await mount();
    await approveRow(c, 'Đại lý Hoa A');
    await approveRow(c, 'Đại lý Sen B');
    const list = alerts(c);
    expect(list).toHaveLength(2);
    expect(list.filter((t) => t.includes('Đại lý Hoa A'))).toHaveLength(1);
    expect(list.filter((t) => t.includes('Đại lý Sen B'))).toHaveLength(1);
  });

  it('đổi bộ lọc trạng thái: các lời lỗi cũ được dọn', async () => {
    writeBy['/ca-111111/approve'] = { status: 502, message: 'Bad Gateway' };
    const c = await mount();
    await approveRow(c, 'Đại lý Hoa A');
    expect(alerts(c)).toHaveLength(1);
    click(byText(c, 'button', /^Tất cả$/));
    await flush();
    expect(alerts(c)).toHaveLength(0);
  });
});
