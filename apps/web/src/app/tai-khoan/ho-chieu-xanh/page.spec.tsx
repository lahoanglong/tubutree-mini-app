// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, unnamedControls } from '@/test-utils/a11y';

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  passport: null as unknown,
  error: null as Error | null,
  pending: false,
  calls: [] as string[],
  track: vi.fn(),
  share: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), usePathname: () => '/tai-khoan/ho-chieu-xanh' }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/analytics', async (orig) => ({ ...(await orig<Record<string, unknown>>()), trackWebEvent: (...a: unknown[]) => state.track(...a) }));
vi.mock('@/lib/platform-bridge', () => ({ platformBridge: { share: (...a: unknown[]) => state.share(...a) } }));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      // Khung lỗi cả trang có dòng hotline tự đọc cấu hình công khai: không đếm vào lượt hỏi hộ chiếu.
      if (path !== '/me/eco-passport') return {};
      state.calls.push(path);
      if (state.pending) return new Promise(() => undefined);
      if (state.error) throw state.error;
      return state.passport;
    },
  },
}));

import { ApiError } from '@/lib/client-api';
import EcoPassportPage from './page';

const FULL = {
  firstOrderAt: '2026-06-30T18:00:00.000Z',
  plasticAvoidedGrams: 2410,
  refillPacks: 3,
  wasteReturned: { requests: 2, grams: 4500, unitsWithoutWeight: 0 },
  trees: { pledged: 0, planted: 0 },
  co2Grams: null,
  monthly: [
    { month: '2026-06', actions: 0 },
    { month: '2026-07', actions: 2 },
    { month: '2026-08', actions: 0 },
    { month: '2026-09', actions: 4 },
    { month: '2026-10', actions: 1 },
    { month: '2026-11', actions: 0 },
  ],
  stamps: [
    { id: 'first_order', reached: true },
    { id: 'plastic_1kg', reached: true },
    { id: 'refill_5', reached: false },
    { id: 'waste_3', reached: false },
    { id: 'tree_1', reached: false },
  ],
};
const EMPTY = {
  ...FULL,
  firstOrderAt: null,
  plasticAvoidedGrams: 0,
  refillPacks: 0,
  wasteReturned: { requests: 0, grams: 0, unitsWithoutWeight: 0 },
  monthly: FULL.monthly.map((m) => ({ ...m, actions: 0 })),
  stamps: FULL.stamps.map((s) => ({ ...s, reached: false })),
};

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<EcoPassportPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};

beforeEach(() => {
  state.phase = 'authenticated';
  state.passport = FULL;
  state.error = null;
  state.pending = false;
  state.calls = [];
  state.track.mockReset();
  state.share.mockReset();
  state.push.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  document.body.innerHTML = '';
});

describe('/tai-khoan/ho-chieu-xanh', () => {
  it('khách chưa đăng nhập: lời mời đăng nhập, không hỏi API', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.textContent).toContain('Đăng nhập để xem Hộ chiếu Xanh của bạn.');
    expect(state.calls).toEqual([]);
  });

  it('đang tải: khung chờ aria-busy', async () => {
    state.pending = true;
    const c = await mount();
    expect(c.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('cờ tắt (404): báo "chưa mở", không nút thử lại', async () => {
    state.error = new ApiError('Không tìm thấy.', 404);
    const c = await mount();
    expect(c.textContent).toContain('Hộ chiếu Xanh chưa mở');
    expect(byText(c, 'button', 'Thử lại')).toBeNull();
    expect(state.track).not.toHaveBeenCalled();
  });

  it('lỗi khác: báo lỗi và thử lại gọi lại API', async () => {
    state.error = new Error('Máy chủ đang bận');
    const c = await mount();
    expect(c.textContent).toContain('Chưa tải được Hộ chiếu Xanh.');
    expect(state.calls).toHaveLength(1);
    state.error = null;
    click(byText(c, 'button', 'Thử lại'));
    await flush(8);
    expect(state.calls).toHaveLength(2);
    expect(c.querySelector('[data-testid="eco-passport"]')).not.toBeNull();
  });

  it('chưa có đơn giao: câu rỗng + nút xem món refill; eco_passport_viewed hasData=false', async () => {
    state.passport = EMPTY;
    const c = await mount();
    const empty = c.querySelector('[data-testid="eco-passport-empty"]');
    expect(empty?.querySelector('a')?.getAttribute('href')).toBe('/san-pham?q=refill');
    expect(c.querySelector('[data-testid="eco-passport-share"]')).toBeNull();
    expect(state.track).toHaveBeenCalledWith('eco_passport_viewed', { hasData: false });
  });

  it('có số: ô số, dòng "Chưa có", biểu đồ ẩn với trình đọc kèm bảng, mốc có chữ đạt/chưa đạt; sự kiện một lần', async () => {
    const c = await mount();
    expect([...c.querySelectorAll('[data-metric]')].map((x) => x.getAttribute('data-metric'))).toEqual(['plastic', 'refill', 'waste']);
    expect(c.textContent).toContain('Chưa có: cây');
    expect(c.querySelector('[data-testid="eco-chart"]')?.getAttribute('aria-hidden')).toBe('true');
    const rows = c.querySelectorAll('table tbody tr');
    expect(rows).toHaveLength(6);
    expect(rows[3]!.textContent).toBe('09/20264');
    expect(c.querySelector('[data-stamp="first_order"]')?.textContent).toContain('đã đạt');
    expect(c.querySelector('[data-stamp="tree_1"]')?.textContent).toContain('chưa đạt');
    expect(state.track).toHaveBeenCalledTimes(1);
    expect(state.track).toHaveBeenCalledWith('eco_passport_viewed', { hasData: true });
    expect(state.calls).toEqual(['/me/eco-passport']);
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
  });

  it('chia sẻ: câu chỉ có số, đường dẫn trang chủ; sao chép thì báo và đếm eco_passport_shared; huỷ thì không đếm', async () => {
    state.share.mockResolvedValueOnce('copied').mockResolvedValueOnce('cancelled');
    const c = await mount();
    state.track.mockReset();
    click(c.querySelector('[data-testid="eco-passport-share"]'));
    await flush(4);
    expect(state.share).toHaveBeenCalledWith({
      title: 'Hộ chiếu Xanh của mình ở Tubu Tree',
      text: 'Hộ chiếu Xanh của mình: 2,4 kg nhựa giảm (ước tính), 3 can refill, 2 lần Đổi rác.',
      path: '/',
    });
    expect(state.track).toHaveBeenCalledWith('eco_passport_shared', {});
    expect(c.querySelector('[role="status"]')?.textContent).toBe('Đã sao chép câu chia sẻ');
    state.track.mockReset();
    click(c.querySelector('[data-testid="eco-passport-share"]'));
    await flush(4);
    expect(state.track).not.toHaveBeenCalled();
  });

  it('"Cách tính" mở sheet với nguồn của các số đang hiện và câu ghi chú', async () => {
    const c = await mount();
    click(c.querySelector('[data-testid="eco-passport-how"]'));
    await flush(4);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Nhựa giảm: số gam ghi ở sự thật đã duyệt');
    expect(text).toContain('Hộ chiếu không đổi được điểm hay quà.');
    expect(text).not.toContain('Cây: cây bạn đã cam kết');
  });
});
