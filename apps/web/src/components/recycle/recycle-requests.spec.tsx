// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { makeRequestSummary } from './recycle-fixtures';

// Chép ý recycle-requests.spec.tsx (Mini App, §4.6, §16.1): hai tab có số đếm, điều hướng theo trạng thái, ngày giờ VN, rỗng.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  rows: [] as unknown[],
  fail: false,
  calls: [] as string[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (state.fail) {
        state.fail = false;
        throw new Error('mất mạng');
      }
      if (path === '/waste/requests') return state.rows;
      throw new Error(`chưa mock ${path}`);
    },
    post: async () => {
      throw new Error('trang này không ghi dữ liệu');
    },
  },
}));

import { RecycleRequests } from './recycle-requests';

const ROWS = [
  makeRequestSummary({ id: 'r-open', code: 'TR-AAAAA', status: 'OPEN' }),
  makeRequestSummary({ id: 'r-ship', code: 'TR-BBBBB', method: 'MAIL_IN', status: 'IN_TRANSIT', pointName: 'Kho Tubu TP.HCM' }),
  makeRequestSummary({ id: 'r-done', code: 'TR-CCCCC', status: 'COMPLETED', pointsAwarded: 4000 }),
  makeRequestSummary({ id: 'r-exp', code: 'TR-DDDDD', status: 'EXPIRED', closeReason: 'HOLD_EXPIRED' }),
];

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<RecycleRequests />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const link = (c: HTMLElement, href: string) => c.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
const tab = (c: HTMLElement, label: string) => byText(c, '[role="tab"]', label);

beforeEach(() => {
  state.phase = 'authenticated';
  state.rows = ROWS;
  state.fail = false;
  state.calls = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/doi-rac/yeu-cau (§4.6, §16.1)', () => {
  it('hai tab có số đếm; mặc định Đang xử lý chỉ hiện yêu cầu chưa đóng', async () => {
    const c = await mount();
    expect(tab(c, 'Đang xử lý')?.getAttribute('aria-selected')).toBe('true');
    expect(tab(c, 'Đang xử lý')?.textContent).toContain('2');
    expect(tab(c, 'Đã đóng')?.textContent).toContain('2');
    expect(link(c, '/doi-rac/yeu-cau/r-open')).not.toBeNull();
    expect(link(c, '/doi-rac/xong/r-done')).toBeNull();
  });

  it('yêu cầu đang xử lý → /doi-rac/yeu-cau/:id, ghi trạng thái và cách giao', async () => {
    const c = await mount();
    const row = link(c, '/doi-rac/yeu-cau/r-ship')!;
    expect(row.textContent).toContain('TR-BBBBB · Gửi về kho Tubu HCM');
    expect(row.textContent).toContain('Đang vận chuyển');
  });

  it('tab Đã đóng: COMPLETED → /doi-rac/xong/:id, trạng thái khác → /doi-rac/yeu-cau/:id', async () => {
    const c = await mount();
    click(tab(c, 'Đã đóng'));
    await flush(2);
    expect(link(c, '/doi-rac/xong/r-done')?.textContent).toContain('Đã cộng 4.000 điểm');
    expect(link(c, '/doi-rac/yeu-cau/r-exp')?.textContent).toContain('Hết hạn giữ chỗ');
    expect(link(c, '/doi-rac/yeu-cau/r-open')).toBeNull();
  });

  it('ngày tạo theo giờ VN', async () => {
    const c = await mount();
    expect(c.textContent).toContain('17/10/2026');
  });

  it('rỗng → trạng thái rỗng với link "Đổi rác ngay" tới /doi-rac/tao', async () => {
    state.rows = [];
    const c = await mount();
    expect(c.textContent).toContain('Chưa có yêu cầu nào');
    expect(link(c, '/doi-rac/tao')?.textContent).toContain('Đổi rác ngay');
  });

  it('không có liên kết "Xem kết quả mẫu" của mockup (§19)', async () => {
    const c = await mount();
    expect(c.textContent).not.toContain('Xem kết quả mẫu');
  });

  it('lỗi tải → "Thử lại" tải lại được', async () => {
    state.fail = true;
    const c = await mount();
    expect(c.textContent).toContain('mất mạng');
    click(byText(c, 'button', 'Thử lại'));
    await flush(6);
    expect(link(c, '/doi-rac/yeu-cau/r-open')).not.toBeNull();
  });

  it('khách chưa đăng nhập: mời đăng nhập, quay lại đúng trang, không gọi API', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/doi-rac/yeu-cau'));
    expect(state.calls).toEqual([]);
  });

  it('phiên lỗi mạng → SessionUnavailable; đang khôi phục → "Đang tải…"', async () => {
    state.phase = 'unavailable';
    let c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    mounted.pop()!.unmount();
    state.phase = 'loading';
    c = await mount();
    expect(c.textContent).toContain('Đang tải…');
  });

  it('một h1, điều khiển có tên, vùng chạm đủ 44px', async () => {
    const c = await mount();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});
