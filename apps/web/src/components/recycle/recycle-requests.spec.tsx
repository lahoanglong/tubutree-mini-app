// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';
import { markSubmitted, takeSubmitted } from '@/lib/recycle-wizard';
import { makeRequestSummary, makeWasteMe } from './recycle-fixtures';

// Chép ý recycle-requests.spec.tsx (Mini App, §4.6, §16.1): hai tab có số đếm, điều hướng theo trạng thái, ngày giờ VN, rỗng.

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  rows: [] as unknown[],
  me: null as unknown,
  failMe: false,
  config: { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } } as Record<string, unknown>,
  fail: false,
  reqError: null as Error | null,
  calls: [] as string[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-public-config', () => ({ usePublicConfig: () => state.config }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push(path);
      if (state.fail) {
        state.fail = false;
        throw new Error('mất mạng');
      }
      if (path === '/waste/requests') {
        if (state.reqError) throw state.reqError;
        return state.rows;
      }
      if (path === '/waste/me') {
        if (state.failMe) throw new Error('me hỏng');
        return state.me;
      }
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
  state.me = makeWasteMe();
  state.failMe = false;
  state.config = { isLoaded: true, waste: { enabled: true, dropoff: true, mailin: true, pickup: true } };
  state.fail = false;
  state.reqError = null;
  state.calls = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/doi-rac/yeu-cau (§4.6, §16.1)', () => {
  it('cờ "vừa gửi yêu cầu" bị xoá khi vào trang, để "Đổi thêm rác" vào bước 1', async () => {
    markSubmitted();
    state.me = makeWasteMe();
    await mount();
    expect(takeSubmitted()).toBe(false);
  });

  it.each(['GUEST', 'NEED_PHONE'] as const)('eligibility %s: MiniAppOnlyNotice như ba trang đổi rác khác, không gọi /waste/requests (Q2)', async (eligibility) => {
    state.me = makeWasteMe({ eligibility, balance: null, monthUsage: null });
    const c = await mount();
    expect(c.textContent).toContain('Tính năng này cần mở Tubu Tree trên Zalo.');
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
    expect(state.calls).not.toContain('/waste/requests');
  });

  it('API trả 403 Forbidden: câu tiếng Việt, không chữ thô, không Thử lại', async () => {
    state.reqError = new ApiError('Forbidden', 403);
    const c = await mount();
    expect(c.textContent).toContain('không có quyền');
    expect(c.textContent).not.toContain('Forbidden');
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
  });

  it('không có yêu cầu đang xử lý mà có yêu cầu đã đóng: mở thẳng tab Đã đóng; tab trống có chữ và nút sang tab kia', async () => {
    state.rows = [ROWS[2]!];
    const c = await mount();
    expect(tab(c, 'Đã đóng')?.getAttribute('aria-selected')).toBe('true');
    expect(link(c, '/doi-rac/xong/r-done')).not.toBeNull();
    click(tab(c, 'Đang xử lý')!);
    await flush(2);
    expect(c.textContent).toContain('Không có yêu cầu đang xử lý');
    click(byText(c, 'button', 'Xem yêu cầu đã đóng')!);
    await flush(2);
    expect(link(c, '/doi-rac/xong/r-done')).not.toBeNull();
  });

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

  it('tab Đang xử lý: trạng thái theo cách giao, không còn "Đang mở"', async () => {
    const c = await mount();
    expect(link(c, '/doi-rac/yeu-cau/r-open')?.textContent).toContain('Chờ bạn mang tới');
    expect(link(c, '/doi-rac/yeu-cau/r-ship')?.textContent).toContain('Đang vận chuyển');
    expect(c.textContent).not.toContain('Đang mở');
  });

  it('khách bị khoá: dòng RECEIVED đọc "Đang chờ Tubu xem lại"', async () => {
    state.me = makeWasteMe({ blocked: true });
    state.rows = [makeRequestSummary({ id: 'r-rec', code: 'TR-RECVD', method: 'MAIL_IN', status: 'RECEIVED' })];
    const c = await mount();
    expect(link(c, '/doi-rac/yeu-cau/r-rec')?.textContent).toContain('Đang chờ Tubu xem lại');
  });

  it('chương trình tạm dừng: Mang tới đang mở và Thu kèm đơn chưa gắn đọc "Đang tạm dừng"', async () => {
    state.me = makeWasteMe({ programmeEnabled: false });
    state.rows = [...ROWS, makeRequestSummary({ id: 'r-pick', code: 'TR-PICKA', method: 'PICKUP' })];
    const c = await mount();
    expect(link(c, '/doi-rac/yeu-cau/r-open')?.textContent).toContain('Đang tạm dừng');
    expect(link(c, '/doi-rac/yeu-cau/r-pick')?.textContent).toContain('Đang tạm dừng');
    expect(link(c, '/doi-rac/yeu-cau/r-ship')?.textContent).toContain('Đang vận chuyển');
  });

  it('/waste/me lỗi: dòng giữ chữ thường, không có trạng thái lỗi', async () => {
    state.failMe = true;
    const c = await mount();
    expect(link(c, '/doi-rac/yeu-cau/r-open')?.textContent).toContain('Chờ bạn mang tới');
    expect(c.textContent).not.toContain('me hỏng');
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
  });

  it('COMPLETED 0 điểm: "Chưa đủ để cộng điểm", không "Đã cộng"', async () => {
    state.rows = [makeRequestSummary({ id: 'r-zero', code: 'TR-ZZZZZ', status: 'COMPLETED', pointsAwarded: 0 })];
    const c = await mount();
    click(tab(c, 'Đã đóng'));
    await flush(2);
    const row = link(c, '/doi-rac/xong/r-zero')!;
    expect(row.textContent).toContain('Chưa đủ để cộng điểm');
    expect(row.textContent).not.toContain('Đã cộng');
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

  it('rỗng + chương trình tắt: không mời tạo yêu cầu mới', async () => {
    state.rows = [];
    state.config = { isLoaded: true, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } };
    const c = await mount();
    expect(c.textContent).toContain('Chưa có yêu cầu nào');
    expect(link(c, '/doi-rac/tao')).toBeNull();
  });

  it('không có liên kết "Xem kết quả mẫu" của mockup (§19)', async () => {
    const c = await mount();
    expect(c.textContent).not.toContain('Xem kết quả mẫu');
  });

  it('lỗi tải → "Thử lại" tải lại được', async () => {
    state.reqError = new Error('mất mạng');
    const c = await mount();
    expect(c.textContent).toContain('mất mạng');
    state.reqError = null;
    click(byText(c, 'button', 'Thử lại'));
    await flush(6);
    expect(link(c, '/doi-rac/yeu-cau/r-open')).not.toBeNull();
  });

  it('khách chưa đăng nhập: mời đăng nhập, quay lại đúng trang, không gọi API', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href*="/dang-nhap"]')?.getAttribute('href')).toContain(encodeURIComponent('/doi-rac/yeu-cau'));
    expect(c.textContent).toContain('Đăng nhập để xem các yêu cầu đổi rác của bạn');
    expect(c.textContent).toContain('Cần số điện thoại để cộng Điểm Xanh');
    expect(c.textContent).not.toContain('Lỗi');
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

describe('/doi-rac/yeu-cau — diện mạo Mini App ở điện thoại', () => {
  it('hàng yêu cầu trơn trên nền trang, không thẻ viền', async () => {
    const c = await mount();
    const list = link(c, '/doi-rac/yeu-cau/r-open')!.closest('div[class*="divide-y"]')!;
    expect(list.className).toContain('max-md:bg-transparent');
    expect(list.className).toContain('max-md:border-transparent');
    expect(list.className).toContain('max-md:shadow-none');
    expect(list.className).not.toContain('box-shadow:var(--elevation');
  });
});
