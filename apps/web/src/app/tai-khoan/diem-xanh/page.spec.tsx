// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  loyalty: null as Record<string, unknown> | null,
  coupons: [] as Record<string, unknown>[],
  txns: [] as Record<string, unknown>[],
  checkIn: null as Record<string, unknown> | null,
  preview: null as object | null,
  card: null as Record<string, unknown> | null,
  config: { waste: { enabled: true } } as Record<string, unknown>,
  wasteRequests: [] as unknown[],
  passport: null as Record<string, unknown> | null,
  fail: new Set<string>(),
  pending: new Set<string>(),
  holds: new Map<string, Promise<unknown>>(),
  readyRoutes: new Set<string>(),
  calls: [] as { method: string; path: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, unknown> }[],
  checkInPost: null as null | (() => Promise<unknown>),
  push: vi.fn(),
  cartCount: 0,
  applied: [] as string[],
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), usePathname: () => '/' }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCart: async () => ({ itemCount: state.cartCount }),
  applyCoupon: async (code: string) => {
    state.applied.push(code);
    return { couponCode: code, discount: 0, freeship: true };
  },
}));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => state.readyRoutes.has(p) }));
vi.mock('@/lib/core-http', () => {
  // Máy chủ giả của lịch sử điểm: trả đúng trang theo beforeId/limit như API thật (dòng đã sắp mới nhất trước).
  const txnPage = (q?: { beforeId?: string; limit?: number }) => {
    const start = q?.beforeId ? state.txns.findIndex((r) => r.id === q.beforeId) + 1 : 0;
    return state.txns.slice(start, start + (q?.limit ?? 100));
  };
  const table: Record<string, (q?: { beforeId?: string; limit?: number }) => unknown> = {
    '/loyalty/preview': () => state.preview,
    '/me/loyalty': () => state.loyalty,
    '/me/coupons': () => state.coupons,
    '/me/points/transactions': txnPage,
    '/me/daily-check-in': () => state.checkIn,
    '/me/loyalty/member-card': () => state.card,
    '/config/public': () => state.config,
    '/waste/requests': () => state.wasteRequests,
    '/me/eco-passport': () => {
      if (!state.passport) throw new Error('404');
      return state.passport;
    },
  };
  return {
    coreHttp: {
      get: async (path: string, opts?: { query?: { beforeId?: string; limit?: number } }) => {
        state.calls.push({ method: 'get', path, query: opts?.query });
        if (state.fail.has(path)) throw new Error('Máy chủ đang bận');
        if (state.pending.has(path)) return new Promise(() => undefined);
        await state.holds.get(path);
        return table[path]!(opts?.query);
      },
      post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
        state.calls.push({ method: 'post', path, body, headers: opts?.headers });
        return state.checkInPost!();
      },
    },
  };
});

import LoyaltyPage from './page';

const TIERS = [
  { id: 't1', name: 'Mầm Xanh', minPoints: 0, minSpending: 0, multiplier: 1 },
  { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, multiplier: 1.2 },
  { id: 't3', name: 'Đại Thụ', minPoints: 1000, minSpending: 20_000_000, multiplier: 1.5 },
];
const REWARDS = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, points: day === 7 ? 10 : day, claimed: day < 3, isToday: day === 3 }));

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<LoyaltyPage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const storage = new Map<string, string>();

beforeEach(() => {
  state.phase = 'authenticated';
  state.fail = new Set();
  state.pending = new Set();
  state.holds = new Map();
  state.readyRoutes = new Set();
  state.calls = [];
  state.push.mockReset();
  state.cartCount = 0;
  state.applied = [];
  state.config = { waste: { enabled: true } };
  state.wasteRequests = [];
  state.passport = null;
  state.loyalty = {
    pointsBalance: 1681,
    pointsConvertedBalance: 119,
    tier: { id: 't1', name: 'Mầm Xanh', multiplier: 1, perks: ['Freeship đơn từ 199.000đ', 'Quà sinh nhật'] },
    nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: 4_000_000, pointsToGo: 120, spendingToGo: 2_500_000 },
    tiers: TIERS,
    spent12m: 1_500_000,
    tierPoints: 80,
    rates: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1000, maxRedeemPct: 0.5 },
    lockedPoints: 0,
    lockedReturnPoints: 0,
    lockedUntil: null,
  };
  state.coupons = [];
  state.txns = [
    { id: 'p1', delta: -1681, reason: 'ORDER_REDEEM:TB1', expiresAt: null, createdAt: '2026-10-14T05:00:00Z' },
    { id: 'p2', delta: 250, reason: 'ORDER_DELIVERED:TB0', expiresAt: '2027-10-14T00:00:00Z', createdAt: '2026-10-10T05:00:00Z' },
    { id: 'p3', delta: 119, reason: 'XU_TO_POINTS:1', expiresAt: null, lot: 'CONVERTED', createdAt: '2026-09-01T05:00:00Z' },
    { id: 'p4', delta: 5, reason: 'WEIRD_INTERNAL_CODE:xyz', expiresAt: null, createdAt: '2026-08-01T05:00:00Z' },
  ];
  state.checkIn = { checkedInToday: false, streakDays: 2, currentCycleDay: 3, todayPoints: 3, rewards: REWARDS };
  state.card = { memberCode: 'TUBUAN123', name: 'An', phone: null, tierName: 'Mầm Xanh', tierMultiplier: 1, pointsBalance: 1681, posCreditEnabled: true };
  state.checkInPost = async () => ({ success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 1804, message: 'Điểm danh thành công +3 Điểm Xanh' });
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('/tai-khoan/diem-xanh — thẻ hạng', () => {
  it('đang chờ hạng: khung chờ mang aria-busy để CSS ẩn chân trang gọn, không để nó hiện rồi bị đẩy đi (HIEUNANG-04)', async () => {
    state.pending.add('/me/loyalty');
    const c = await mount();
    expect(c.querySelector('[aria-busy="true"] [data-skeleton]')).not.toBeNull();
  });

  it('hiện hạng, hệ số, tổng hai lô Điểm Xanh, dòng không hết hạn và phần còn lại để lên hạng kế', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Mầm Xanh');
    expect(c.textContent).toContain('Tích điểm ×1');
    expect(c.textContent).toContain('1.800 Điểm Xanh');
    expect(c.textContent).toContain('trong đó 119 điểm không hết hạn');
    expect(c.textContent).toContain('Còn 2,5 triệu mua hàng để lên hạng Lộc Biếc');
    const bar = c.querySelector('[role="progressbar"][aria-label="Tiến độ lên hạng kế"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('38');
  });

  it('hạng cao nhất: không có thanh tiến độ, hiện lời chúc', async () => {
    state.loyalty = { ...state.loyalty!, tier: { id: 't3', name: 'Đại Thụ', multiplier: 1.5, perks: [] }, nextTier: null };
    const c = await mount();
    expect(c.querySelector('[role="progressbar"][aria-label="Tiến độ lên hạng kế"]')).toBeNull();
    expect(c.textContent).toContain('Bạn đang ở hạng cao nhất');
    expect(c.textContent).toContain('Tích điểm ×1,5');
  });

  it('thiếu mốc chi tiêu: một dòng theo điểm, kèm số tiền tương ứng trong ngoặc, phần số in đậm', async () => {
    state.loyalty = { ...state.loyalty!, nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: null, pointsToGo: 120 } };
    const c = await mount();
    const line = c.querySelector('[data-testid="tier-next-line"]')!;
    expect(line.textContent).toBe('Còn 120 điểm (≈ 6.000đ mua hàng) để lên hạng Lộc Biếc');
    expect(line.querySelector('b')!.textContent).toBe('120 điểm');
  });

  it('luật tích/dùng nằm trong mục gập "Cách kiếm và dùng Điểm Xanh" (h2 bọc nút): đóng mặc định, bấm mở, bấm lại đóng; thẻ hạng không còn hai dòng đó', async () => {
    const c = await mount();
    const toggle = byText(c, 'button', 'Cách kiếm và dùng Điểm Xanh') as HTMLButtonElement;
    expect(toggle.closest('h2')).not.toBeNull();
    const body = c.querySelector(`#${CSS.escape(toggle.getAttribute('aria-controls')!)}`) as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    click(toggle);
    await flush();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(body.textContent).toContain('Tích 2% tiền hàng thành Điểm Xanh');
    expect(body.textContent).toContain('1 điểm = 1.000đ khi dùng ở bước thanh toán (tối đa 50% giá trị đơn)');
    expect(c.querySelector('section[aria-label="Hạng thành viên"]')!.textContent).not.toContain('tiền hàng thành Điểm Xanh');
    click(toggle);
    await flush();
    expect(body.hidden).toBe(true);
  });

  it('API cũ chưa trả rates: không có mục gập luật, các hạng vẫn nói mốc theo điểm', async () => {
    state.loyalty = { ...state.loyalty!, rates: undefined };
    const old = await mount();
    expect(byText(old, 'button', 'Cách kiếm và dùng Điểm Xanh')).toBeFalsy();
    expect(old.textContent).not.toContain('1 điểm = ');
    expect(old.textContent).toContain('từ 200 điểm tích luỹ');
  });

  it('điểm sắp hết hạn, chính sách hạn điểm; điểm đang khoá không hiện dòng chờ như Mini App', async () => {
    state.loyalty = {
      ...state.loyalty!,
      expiringPoints: { amount: 70, expiresAt: new Date(Date.now() + 5 * 864e5).toISOString() },
      pointExpireMonths: 12,
      lockedPoints: 350,
      lockedReturnPoints: 100,
      lockedUntil: '2026-10-21T20:00:00.000Z',
    };
    const c = await mount();
    expect(c.textContent).toMatch(/70 Điểm Xanh sẽ hết hạn ngày \d{2}\/\d{2}\/\d{4} \(còn [45] ngày\)/);
    expect(c.textContent).toContain('Điểm Xanh thường có hạn 12 tháng');
    expect(c.textContent).not.toContain('đang chờ');
    expect(c.textContent).not.toContain('mở khoá ngày');
  });

  it('không có điểm khoá, hết hạn hay lô quy đổi: các dòng phụ không hiện', async () => {
    state.loyalty = { ...state.loyalty!, pointsConvertedBalance: 0 };
    const c = await mount();
    const card = c.querySelector('section[aria-label="Hạng thành viên"]')!;
    expect(card.textContent).not.toContain('đang chờ');
    expect(card.textContent).not.toContain('sẽ hết hạn');
    expect(card.textContent).not.toContain('không hết hạn');
  });

  it('danh sách các hạng đánh dấu hạng hiện tại và nói mốc bằng tiền 12 tháng', async () => {
    const c = await mount();
    const section = c.querySelector('section[aria-label="Các hạng"]')!;
    expect(section.textContent).toContain('hạng khởi đầu · ×1');
    expect(section.textContent).toContain('từ 4 triệu mua hàng trong 12 tháng · ×1,2');
    expect(section.querySelector('[aria-current="true"]')?.textContent).toContain('Mầm Xanh');
  });

  it('quyền lợi của hạng hiện tại', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Quyền lợi của bạn');
    expect(c.textContent).toContain('Quà sinh nhật');
  });
});

describe('/tai-khoan/diem-xanh — một dòng sang hub Ưu đãi', () => {
  const COUPONS = [
    { code: 'FREESHIP1', type: 'FREESHIP', value: 0, minOrder: 199000, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' },
    { code: 'PCT10', type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50000, endAt: '2026-11-01T05:00:00Z' },
  ];
  const offersLinks = (c: HTMLElement) => c.querySelectorAll('a[href^="/uu-dai"], a[href^="/kho-qua"], a[href^="/ma-giam-gia"]');

  it('có mã: một dòng "Đổi quà & mã giảm giá" tới tab Đổi quà, dòng phụ nêu số mã, ngay dưới thẻ hạng; không liệt kê từng mã', async () => {
    state.coupons = COUPONS;
    state.readyRoutes = new Set(['/uu-dai', '/kho-qua']);
    const c = await mount();
    expect(offersLinks(c)).toHaveLength(1);
    const link = c.querySelector('a[href="/uu-dai?tab=rewards"]')!;
    expect(link.textContent).toContain('Đổi quà & mã giảm giá');
    expect(link.textContent).toContain('Bạn đang có 2 mã giảm giá');
    const tier = c.querySelector('section[aria-label="Hạng thành viên"]')!;
    expect(tier.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const later of ['Các hạng', 'Lịch sử Điểm Xanh']) {
      const h = Array.from(c.querySelectorAll('h2')).find((x) => x.textContent === later)!;
      expect(link.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING, later).toBeTruthy();
    }
    for (const gone of ['Miễn phí giao hàng', 'HSD', 'Giảm 10%', 'FREESHIP1', 'Ví mã', 'Kho quà']) expect(c.textContent).not.toContain(gone);
  });

  it('chưa có mã, mã đang tải hay tải lỗi: vẫn đúng một dòng, dòng phụ nói chung', async () => {
    state.readyRoutes = new Set(['/uu-dai', '/kho-qua']);
    for (const setup of [() => undefined, () => state.pending.add('/me/coupons'), () => state.fail.add('/me/coupons')]) {
      state.pending = new Set();
      state.fail = new Set();
      setup();
      const c = await mount();
      expect(offersLinks(c)).toHaveLength(1);
      expect(c.querySelector('a[href="/uu-dai?tab=rewards"]')!.textContent).toContain('Đổi Điểm Xanh lấy mã giảm giá và quà');
      expect(c.textContent).not.toContain('Bạn đang có');
      mounted.pop()!.unmount();
    }
  });

  it('route đích chưa sẵn sàng thì không hiện dòng', async () => {
    state.coupons = COUPONS;
    const c = await mount();
    expect(offersLinks(c)).toHaveLength(0);
  });
});

describe('/tai-khoan/diem-xanh — điểm danh chỉ ở Vườn Xanh: trang chỉ có dòng trạng thái', () => {
  const checkInButtons = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).filter((b) => /^(Đã )?[Đđ]iểm danh$/.test(b.textContent?.trim() ?? ''));
  const strip = (c: HTMLElement) => c.querySelector('section[aria-label^="Hôm nay bạn"]');

  it('chưa điểm danh: dòng "Hôm nay bạn chưa điểm danh" mở /vuon-xanh; không có nút điểm danh, không gọi lệnh điểm danh', async () => {
    state.readyRoutes = new Set(['/vuon-xanh']);
    const c = await mount();
    const row = strip(c)!;
    expect(row.getAttribute('aria-label')).toBe('Hôm nay bạn chưa điểm danh');
    expect(row.textContent).toContain('Mở Vườn Xanh');
    expect(checkInButtons(c)).toHaveLength(0);
    click(row.querySelector('[role="button"]') as HTMLElement);
    expect(state.push).toHaveBeenCalledWith('/vuon-xanh');
    expect(state.calls.some((x) => x.method === 'post')).toBe(false);
  });

  it('đã điểm danh: dòng "Hôm nay bạn đã điểm danh", vẫn không có nút', async () => {
    state.readyRoutes = new Set(['/vuon-xanh']);
    state.checkIn = { ...state.checkIn!, checkedInToday: true };
    const c = await mount();
    expect(strip(c)?.getAttribute('aria-label')).toBe('Hôm nay bạn đã điểm danh');
    expect(checkInButtons(c)).toHaveLength(0);
  });

  it('không còn thẻ 7 ô, luật điểm danh hay ô báo kết quả điểm danh', async () => {
    state.readyRoutes = new Set(['/vuon-xanh']);
    const c = await mount();
    for (const gone of ['Điểm danh mỗi ngày', 'Ngày 3/7', 'N1', 'Mỗi ngày nhận 1 lần cả Điểm Xanh và giọt nước']) expect(c.textContent).not.toContain(gone);
    expect(c.querySelector('[data-testid="daily-check-in"]')).toBeNull();
  });

  it('tải trạng thái lỗi hoặc /vuon-xanh chưa có trên web: không vẽ dòng, trang vẫn đủ', async () => {
    state.readyRoutes = new Set(['/vuon-xanh']);
    state.fail.add('/me/daily-check-in');
    const failed = await mount();
    expect(strip(failed)).toBeNull();
    expect(failed.textContent).toContain('Lịch sử Điểm Xanh');
    mounted.pop()!.unmount();
    state.fail = new Set();
    state.readyRoutes = new Set();
    const notReady = await mount();
    expect(strip(notReady)).toBeNull();
  });
});

describe('/tai-khoan/diem-xanh — hạn giữ hạng, biểu tượng theo thứ hạng, thẻ thành viên tải khi mở', () => {
  it('đang trong hạn giữ hạng: một dòng nói phải mua thêm bao nhiêu và đến ngày nào', async () => {
    state.loyalty = { ...state.loyalty, tierGrace: { until: '2026-11-07T10:00:00.000Z', spendingToKeep: 400_000, pointsToKeep: 0 } };
    const c = await mount();
    expect(c.textContent).toContain('Giữ hạng Mầm Xanh: đơn giao thành công thêm 400.000đ trước 07/11/2026');
  });

  it('không có hạn giữ hạng: không có dòng đó', async () => {
    const c = await mount();
    expect(c.textContent).not.toContain('Giữ hạng');
  });

  it('đổi tên hạng trong admin: biểu tượng vẫn theo thứ hạng, tên hạng không xuống dòng', async () => {
    state.loyalty = { ...state.loyalty, tier: { ...(state.loyalty as { tier: object }).tier, id: 't2', name: 'Hạng Bạc Đặc Biệt' } };
    const c = await mount();
    const medal = c.querySelector('section[aria-label="Hạng thành viên"] [data-testid="tier-medallion"]')!;
    expect(medal.getAttribute('data-kind')).toBe('sapling');
    expect(c.querySelector('section[aria-label="Hạng thành viên"]')!.textContent).not.toMatch(/🌱|🌿|🌳|🌲/);
    const names = Array.from(c.querySelectorAll('section[aria-label="Các hạng"] li span.whitespace-nowrap')).map((x) => x.textContent);
    expect(names).toEqual(['Mầm Xanh', 'Lộc Biếc', 'Đại Thụ']);
  });

  it('thẻ thành viên chỉ tải khi khách mở thẻ', async () => {
    const c = await mount();
    expect(state.calls.some((x) => x.path === '/me/loyalty/member-card')).toBe(false);
    click(byText(c, 'button', 'Thẻ thành viên số (mã QR)')!);
    await flush(8);
    expect(state.calls.some((x) => x.path === '/me/loyalty/member-card')).toBe(true);
  });
});

describe('/tai-khoan/diem-xanh — không còn lối tắt riêng (Vườn Xanh, Đổi rác, Kho quà, mua sắm)', () => {
  it.each([true, false])('mọi route sẵn sàng, Đổi rác bật=%s: không có liên kết Vườn Xanh, Đổi rác, Kho quà hay nút mua sắm; không hỏi danh sách yêu cầu đổi rác', async (enabled) => {
    state.readyRoutes = new Set(['/vuon-xanh', '/doi-rac', '/doi-rac/yeu-cau', '/kho-qua', '/uu-dai', '/san-pham']);
    state.config = { waste: { enabled } };
    state.wasteRequests = [{ id: 'r1' }];
    const c = await mount();
    for (const href of ['/vuon-xanh', '/doi-rac', '/doi-rac/yeu-cau', '/kho-qua', '/san-pham']) expect(c.querySelector(`a[href="${href}"]`), href).toBeNull();
    for (const gone of ['Chăm cây nhận quà', 'Đổi rác lấy quà', 'Yêu cầu đổi rác', 'Mua sắm để tích thêm Điểm Xanh']) expect(c.textContent).not.toContain(gone);
    expect(state.calls.some((x) => x.path === '/waste/requests')).toBe(false);
  });
});

describe('/tai-khoan/diem-xanh — lịch sử Điểm Xanh', () => {
  it('từng dòng bằng nhãn ngắn như Mini App, có dấu cộng/trừ và ngày; không in mã đơn hay hạn từng dòng', async () => {
    const c = await mount();
    const rows = Array.from(c.querySelectorAll('section[aria-label="Lịch sử Điểm Xanh"] li')).map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Dùng điểm khi thanh toán');
    expect(rows[0]).not.toContain('TB1');
    expect(rows[0]).toContain('−1.681');
    expect(rows[0]).toContain('14/10/2026');
    expect(rows[1]).toContain('+250');
    expect(rows[1]).not.toContain('Hết hạn');
    expect(rows[2]).toContain('Điểm không hết hạn');
    expect(c.textContent).toContain('Điều chỉnh Điểm Xanh');
    expect(c.textContent).not.toContain('WEIRD_INTERNAL_CODE');
  });

  it('phí shipper thu gom tận nhà: dòng trừ và dòng hoàn có nhãn riêng kèm mã yêu cầu, không in chuỗi kỹ thuật', async () => {
    state.txns = [
      { id: 'w1', delta: -25_000, reason: 'WASTE_PICKUP_FEE:TR-8K2M9', expiresAt: null, createdAt: '2026-10-14T05:00:00Z' },
      { id: 'w2', delta: 25_000, reason: 'WASTE_PICKUP_FEE_REFUND:TR-8K2M9', expiresAt: null, createdAt: '2026-10-15T05:00:00Z' },
    ];
    const c = await mount();
    const rows = Array.from(c.querySelectorAll('section[aria-label="Lịch sử Điểm Xanh"] li')).map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Trừ phí shipper thu gom · TR-8K2M9');
    expect(rows[0]).toContain('−25.000');
    expect(rows[1]).toContain('Hoàn điểm phí shipper · TR-8K2M9');
    expect(rows[1]).toContain('+25.000');
    expect(c.textContent).not.toContain('WASTE_PICKUP_FEE');
    expect(c.textContent).not.toContain('Điều chỉnh Điểm Xanh');
  });

  it('hiện 20 giao dịch gần nhất, "Xem thêm" tải trang kế từ máy chủ (cả dòng cũ hơn 100) cho tới hết', async () => {
    state.txns = Array.from({ length: 145 }, (_, i) => ({
      id: `n${String(i).padStart(3, '0')}`, delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: new Date(Date.UTC(2026, 9, 10, 5, 0, 0) - i * 1000).toISOString(),
    }));
    const c = await mount();
    const rows = () => c.querySelectorAll('section[aria-label="Lịch sử Điểm Xanh"] li').length;
    expect(rows()).toBe(20);
    expect(c.textContent).not.toContain('Hiển thị tối đa');
    for (const shown of [40, 60, 80, 100, 120, 140, 145]) {
      click(byText(c, 'button', 'Xem thêm')!);
      await flush(3);
      expect(rows()).toBe(shown);
    }
    expect(byText(c, 'button', /^Xem thêm/)).toBeFalsy();
    // Mỗi trang gửi mốc của dòng cuối trang trước.
    const txnCalls = state.calls.filter((x) => x.path === '/me/points/transactions');
    expect(txnCalls[0]!.query).toMatchObject({ limit: 20 });
    expect(txnCalls[1]!.query).toMatchObject({ limit: 20, beforeId: 'n019', before: state.txns[19]!.createdAt });
  });

  it('ít hơn một trang (dưới 20 dòng) thì không có nút Xem thêm', async () => {
    state.txns = Array.from({ length: 19 }, (_, i) => ({ id: `n${i}`, delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: '2026-10-10T05:00:00Z' }));
    const c = await mount();
    expect(byText(c, 'button', /^Xem thêm/)).toBeFalsy();
  });

  it('tải trang kế lỗi: giữ các dòng đã có, nút đổi thành "thử lại" và bấm lại tải được', async () => {
    state.txns = Array.from({ length: 30 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: new Date(Date.UTC(2026, 9, 10, 5) - i * 1000).toISOString() }));
    const c = await mount();
    const rows = () => c.querySelectorAll('section[aria-label="Lịch sử Điểm Xanh"] li').length;
    state.fail.add('/me/points/transactions');
    click(byText(c, 'button', 'Xem thêm')!);
    await flush(3);
    expect(rows()).toBe(20);
    expect(byText(c, 'button', 'Chưa tải được, bấm để thử lại')).toBeTruthy();
    state.fail.clear();
    click(byText(c, 'button', 'Chưa tải được, bấm để thử lại')!);
    await flush(3);
    expect(rows()).toBe(30);
  });

  it('chưa có giao dịch: câu báo trống; tải lỗi: báo lỗi và Thử lại', async () => {
    state.txns = [];
    const c = await mount();
    expect(c.textContent).toContain('Chưa có giao dịch điểm nào');
    state.fail.add('/me/points/transactions');
    const failed = await mount();
    expect(failed.textContent).toContain('Không tải được lịch sử Điểm Xanh');
  });
});

describe('/tai-khoan/diem-xanh — thẻ thành viên số', () => {
  const open = async () => {
    const c = await mount();
    click(byText(c, 'button', 'Thẻ thành viên số'));
    await flush();
    return c;
  };

  it('mở thẻ: QR mã hoá đúng memberCode, mã gõ tay được, tổng hai lô và lời nhắc theo cờ backend', async () => {
    await open();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Thẻ Thành Viên Tubu');
    expect(dialog.textContent).toContain('TUBUAN123');
    expect(dialog.textContent).toContain('Hạng Mầm Xanh · 1.800 Điểm Xanh');
    expect(dialog.textContent).toContain('Đưa mã QR này cho thu ngân');
    expect(dialog.querySelector('img[alt="QR"], [data-qr-placeholder]')).not.toBeNull();
    expect(state.calls.some((x) => x.path === '/me/loyalty/member-card')).toBe(true);
  });

  it('posCreditEnabled=false: không hứa tích điểm tại quầy', async () => {
    state.card = { ...state.card!, posCreditEnabled: false };
    await open();
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('chỉ tích khi mua hàng online');
  });

  it('chép mã thành công: báo "Đã sao chép", nút đổi thành "Đã chép"', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await open();
    click(byText(document.body, 'button', 'Chép'));
    await flush();
    expect(writeText).toHaveBeenCalledWith('TUBUAN123');
    expect(document.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain('Đã sao chép mã thành viên');
    expect(byText(document.body, 'button', 'Đã chép')).not.toBeNull();
  });

  it('W40A: nút "Chép" co khi nhấn (tubu-press như nút chép của Mini App)', async () => {
    await open();
    expect(byText(document.body, 'button', 'Chép')!.className).toContain('tubu-press');
  });

  it('chép không được: báo lỗi, không báo "Đã sao chép"', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => Promise.reject(new Error('denied')) } });
    await open();
    click(byText(document.body, 'button', 'Chép'));
    await flush();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Không sao chép được — hãy đọc mã cho nhân viên.');
    expect(dialog.textContent).not.toContain('Đã sao chép');
  });

  it('lỗi tải mã: có Thử lại gọi lại API, không vẽ QR; "Đóng" tắt thẻ', async () => {
    state.fail.add('/me/loyalty/member-card');
    await open();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Chưa tải được mã thành viên: Máy chủ đang bận');
    expect(dialog.querySelector('img[alt="QR"]')).toBeNull();
    state.fail.clear();
    state.calls = [];
    click(byText(dialog as HTMLElement, 'button', 'Thử lại'));
    await flush();
    expect(state.calls.some((x) => x.path === '/me/loyalty/member-card')).toBe(true);
    click(byText(document.body, 'button', 'Đóng'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('/tai-khoan/diem-xanh — tubu-w21-02: đổi điểm trước khi hết hạn, thẻ quét ở quầy', () => {
  const CTA = 'Đổi điểm ngay trước khi hết hạn →';
  const rewardsLinks = (c: HTMLElement) => Array.from(c.querySelectorAll('a')).filter((a) => a.getAttribute('href') === '/uu-dai?tab=rewards');
  const ctaLink = (c: HTMLElement) => rewardsLinks(c).find((a) => a.querySelector('[data-testid="loyalty-expiring-cta"]'));
  const soon = () => new Date(Date.now() + 5 * 864e5).toISOString();

  it('điểm thường còn ≤ 30 ngày: dòng Đổi quà thành lời mời đổi ngay (vẫn một lối sang tab Đổi quà), dòng phụ nêu số đổi được ngay', async () => {
    state.readyRoutes = new Set(['/uu-dai']);
    state.loyalty = { ...state.loyalty!, redeemablePoints: 1500, expiringPoints: { amount: 70, expiresAt: soon() } };
    const c = await mount();
    expect(rewardsLinks(c)).toHaveLength(1);
    const link = ctaLink(c)!;
    expect(link.querySelector('[data-testid="loyalty-expiring-cta"]')!.textContent).toBe(CTA);
    expect(link.textContent).toContain('Điểm sắp hết hạn là điểm thường: đổi quà dùng được ngay 1.500 điểm');
    expect(link.className).toContain('min-h-11');
    expect(link.textContent).not.toContain('Đổi quà & mã giảm giá');
  });

  it('chưa gấp, hết điểm đổi được ngay: dòng Đổi quà như cũ; hub Ưu đãi chưa mở trên web: không có dòng', async () => {
    state.readyRoutes = new Set(['/uu-dai']);
    state.loyalty = { ...state.loyalty!, redeemablePoints: 1500, expiringPoints: { amount: 70, expiresAt: '2099-01-01T03:00:00.000Z' } };
    let c = await mount();
    expect(ctaLink(c)).toBeUndefined();
    expect(rewardsLinks(c)[0]!.textContent).toContain('Đổi quà & mã giảm giá');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.loyalty = { ...state.loyalty!, redeemablePoints: 0, expiringPoints: { amount: 70, expiresAt: soon() } };
    c = await mount();
    expect(ctaLink(c)).toBeUndefined();
    expect(rewardsLinks(c)[0]!.textContent).toContain('Đổi quà & mã giảm giá');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.readyRoutes = new Set();
    state.loyalty = { ...state.loyalty!, redeemablePoints: 1500 };
    expect(rewardsLinks(await mount())).toHaveLength(0);
  });

  it('thẻ thành viên: mã QR trong khung trắng cố định có lề; quầy tích điểm được thì dặn chụp màn hình khi mất mạng', async () => {
    const c = await mount();
    click(byText(c, 'button', 'Thẻ thành viên số'));
    await flush();
    const dialog = document.querySelector('[role="dialog"]')!;
    const frame = dialog.querySelector('[data-testid="member-card-scan"]')!;
    expect(frame.className).toContain('bg-stone-0');
    expect(frame.className).toContain('p-4');
    expect(frame.querySelector('img[alt="QR"], [data-qr-placeholder]')).not.toBeNull();
    expect(dialog.querySelector('[data-testid="member-card-offline-hint"]')?.textContent).toBe(
      'Mất mạng ở quầy? Chụp màn hình thẻ này trước: mã không đổi nên vẫn quét được.',
    );
  });

  it('quầy chưa tích điểm: không dặn chụp màn hình', async () => {
    state.card = { ...state.card!, posCreditEnabled: false };
    const c = await mount();
    click(byText(c, 'button', 'Thẻ thành viên số'));
    await flush();
    expect(document.querySelector('[data-testid="member-card-offline-hint"]')).toBeNull();
  });
});

describe('/tai-khoan/diem-xanh — chúc mừng lên hạng', () => {
  const higher = () => {
    state.loyalty = { ...state.loyalty!, tier: { id: 't2', name: 'Lộc Biếc', multiplier: 1.2, perks: ['Quà sinh nhật'] } };
  };

  it('lần đầu chưa có mốc cũ: chỉ ghi mốc, không bật chúc mừng', async () => {
    higher();
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(storage.get('tubu_last_tier_min_v2')).toBe('200');
  });

  it('mốc lưu trước đợt đổi ngưỡng (khoá cũ) bị bỏ qua: không chúc mừng giả', async () => {
    higher();
    storage.set('tubu_last_tier_min', '0');
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('mốc cũ thấp hơn: chúc mừng kèm quyền lợi, "Tuyệt vời!" đóng lại', async () => {
    higher();
    storage.set('tubu_last_tier_min_v2', '0');
    await mount();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Chúc mừng lên hạng Lộc Biếc!');
    expect(dialog.textContent).toContain('Quà sinh nhật');
    click(byText(document.body, 'button', 'Tuyệt vời!'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('mốc cũ bằng hạng hiện tại: không chúc mừng', async () => {
    higher();
    storage.set('tubu_last_tier_min_v2', '200');
    await mount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('/tai-khoan/diem-xanh — trạng thái trang', () => {
  it('khách chưa đăng nhập xem được bảng hạng, nút "Đăng nhập để đổi" mang theo returnTo, không gọi API của khách', async () => {
    state.phase = 'guest';
    state.preview = {
      rewards: [], giftClaimDays: 60, claimPoint: null, rates: {}, pointExpireMonths: 12,
      tiers: [
        { id: 'MAM_XANH', name: 'Mầm Xanh', minPoints: 0, minSpending: null, multiplier: 1, perks: ['Tích Điểm Xanh mỗi đơn'] },
        { id: 'LOC_BIEC', name: 'Lộc Biếc', minPoints: 2500, minSpending: 5_000_000, multiplier: 1.2, perks: ['Freeship đơn từ 99k'] },
      ],
    };
    const c = await mount();
    await flush(4);
    expect(c.textContent).toContain('Lộc Biếc');
    expect(c.textContent).toContain('Freeship đơn từ 99k');
    expect(c.textContent).toContain('Chi tiêu từ 5 triệu trong 12 tháng');
    const a = c.querySelector('a[href^="/dang-nhap"]');
    expect(a?.textContent).toBe('Đăng nhập để đổi');
    expect(a?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/tai-khoan/diem-xanh')}`);
    expect(state.calls.map((x) => x.path)).toEqual(['/loyalty/preview']);
  });

  it('phiên chưa khôi phục được: nói không kết nối được thay vì mời đăng nhập', async () => {
    state.phase = 'unavailable';
    const c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
  });

  it('tải hạng lỗi: báo lỗi và Thử lại, không vẽ thẻ hạng', async () => {
    state.fail.add('/me/loyalty');
    const c = await mount();
    expect(c.textContent).toContain('Máy chủ đang bận');
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
    expect(c.textContent).not.toContain('Tích điểm ×');
  });

  it('có đúng một h1 nói tên trang, đạt kiểm tra truy cập tối thiểu (kể cả nút gập luật và dòng điểm danh)', async () => {
    state.readyRoutes = new Set(['/vuon-xanh', '/uu-dai']);
    const c = await mount();
    expect(byText(c, 'button', 'Cách kiếm và dùng Điểm Xanh')).toBeTruthy();
    expect(c.querySelector('section[aria-label="Hôm nay bạn chưa điểm danh"]')).not.toBeNull();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')?.textContent).toBe('Hạng thành viên & Điểm Xanh');
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

describe('/tai-khoan/diem-xanh — giao diện điện thoại như Mini App', () => {
  it('thẻ hạng giữ màu nền theo hạng (không bị nền trắng của thẻ đè), không viền ở điện thoại', async () => {
    const c = await mount();
    const card = c.querySelector('section[aria-label="Hạng thành viên"]')!;
    expect((card as HTMLElement).style.background).toBe('var(--sage-50)');
    expect(card.classList.contains('bg-stone-0')).toBe(false);
    expect(card.classList.contains('border')).toBe(false);
  });

  it('thanh tiến độ không in chữ nhãn (chỉ aria-label), thanh dày 10px', async () => {
    const c = await mount();
    const bar = c.querySelector('[role="progressbar"][aria-label="Tiến độ lên hạng kế"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('38');
    expect(bar.className).toContain('h-2.5');
    const card = c.querySelector('section[aria-label="Hạng thành viên"]')!;
    expect(card.textContent).not.toContain('Tiến độ lên hạng kế');
  });

  it('nút thẻ thành viên số là nút phụ kiểu ZaUI ở điện thoại', async () => {
    const c = await mount();
    expect(byText(c, 'button', 'Thẻ thành viên số')!.className).toContain('max-md:bg-forest-50');
  });

  it('các thẻ khối không viền ở điện thoại', async () => {
    const c = await mount();
    const bordered = Array.from(c.querySelectorAll('section')).filter((s) => s.classList.contains('border'));
    expect(bordered).toEqual([]);
  });

  it('dòng sang Ưu đãi dùng mũi tên chevron, không dùng ký tự ›', async () => {
    state.readyRoutes = new Set(['/uu-dai']);
    const c = await mount();
    const link = c.querySelector('a[href="/uu-dai?tab=rewards"]')!;
    expect(link.textContent).not.toContain('›');
    expect(link.querySelectorAll('svg').length).toBe(2);
  });

  it('trang bỏ đệm 48px của body và có thanh tiêu đề trắng với h1 như Mini App', async () => {
    const c = await mount();
    expect(c.querySelector('h1')!.closest('header')!.hasAttribute('data-page-bleed')).toBe(true);
    expect(c.querySelector('h1')!.closest('header')!.className).toContain('max-md:bg-[var(--color-bg-surface)]');
  });
});

describe('/tai-khoan/diem-xanh — tiêu đề khối như Mini App', () => {
  it('tiêu đề các khối cỡ title-sm ở điện thoại; thẻ hạng chữ lớn như medallion', async () => {
    const c = await mount();
    for (const name of ['Các hạng', 'Lịch sử Điểm Xanh']) {
      const h = Array.from(c.querySelectorAll('h2')).find((x) => x.textContent === name)!;
      expect(h.className, name).toContain('max-md:text-[length:var(--type-title-sm-size)]');
    }
    const tier = c.querySelector('section[aria-label="Hạng thành viên"] h2')!;
    expect(tier.className).toContain('max-md:text-[length:var(--type-title-lg-size)]');
  });
});

describe('/tai-khoan/diem-xanh — khoá chạm đúp', () => {
  const gate = () => {
    let open!: () => void;
    const p = new Promise<void>((r) => (open = r));
    return { p, open };
  };
  const tapTogether = async (...els: HTMLElement[]) => {
    await act(async () => {
      for (const e of els) e.click();
    });
  };
  const gets = (path: string) => state.calls.filter((x) => x.method === 'get' && x.path === path);

  it('"Xem thêm": hai cú chạm cùng khung hình chỉ tải một trang; nút báo bận không disabled', async () => {
    state.txns = Array.from({ length: 45 }, (_, i) => ({
      id: `n${String(i).padStart(2, '0')}`, delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: new Date(Date.UTC(2026, 9, 10, 5) - i * 1000).toISOString(),
    }));
    const c = await mount();
    expect(gets('/me/points/transactions')).toHaveLength(1);
    const g = gate();
    state.holds.set('/me/points/transactions', g.p);
    const b = byText(c, 'button', 'Xem thêm') as HTMLButtonElement;
    await tapTogether(b, b);
    await flush();
    expect(gets('/me/points/transactions')).toHaveLength(2);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.disabled).toBe(false);
    g.open();
    await flush(8);
    expect(gets('/me/points/transactions')).toHaveLength(2);
    expect(c.querySelectorAll('section[aria-label="Lịch sử Điểm Xanh"] li')).toHaveLength(40);
  });

  it('lịch sử lỗi tải: dòng báo role="alert", Thử lại chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    state.fail.add('/me/points/transactions');
    const c = await mount();
    const section = c.querySelector('section[aria-label="Lịch sử Điểm Xanh"]')!;
    expect(section.querySelector('[role="alert"]')?.textContent).toContain('Không tải được lịch sử Điểm Xanh');
    const before = gets('/me/points/transactions').length;
    state.fail.clear();
    const g = gate();
    state.holds.set('/me/points/transactions', g.p);
    const retry = byText(section as HTMLElement, 'button', 'Thử lại') as HTMLButtonElement;
    await tapTogether(retry, retry);
    await flush();
    expect(gets('/me/points/transactions')).toHaveLength(before + 1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    g.open();
    await flush(8);
    expect(gets('/me/points/transactions')).toHaveLength(before + 1);
  });

  it('hạng lỗi tải: Thử lại chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    state.fail.add('/me/loyalty');
    const c = await mount();
    const before = gets('/me/loyalty').length;
    state.fail.clear();
    const g = gate();
    state.holds.set('/me/loyalty', g.p);
    const retry = byText(c, 'button', 'Thử lại') as HTMLButtonElement;
    await tapTogether(retry, retry);
    await flush();
    expect(gets('/me/loyalty')).toHaveLength(before + 1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    g.open();
    await flush(8);
    expect(gets('/me/loyalty')).toHaveLength(before + 1);
  });

  it('thẻ thành viên lỗi tải mã: Thử lại chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    state.fail.add('/me/loyalty/member-card');
    const c = await mount();
    click(byText(c, 'button', 'Thẻ thành viên số'));
    await flush(8);
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const before = gets('/me/loyalty/member-card').length;
    state.fail.clear();
    const g = gate();
    state.holds.set('/me/loyalty/member-card', g.p);
    const retry = byText(dialog, 'button', 'Thử lại') as HTMLButtonElement;
    await tapTogether(retry, retry);
    await flush();
    expect(gets('/me/loyalty/member-card')).toHaveLength(before + 1);
    expect(retry.getAttribute('aria-busy')).toBe('true');
    g.open();
    await flush(8);
    expect(gets('/me/loyalty/member-card')).toHaveLength(before + 1);
  });
});

describe('/tai-khoan/diem-xanh — dòng Hộ chiếu Xanh (cờ eco.passport_enabled)', () => {
  const PASSPORT = {
    firstOrderAt: '2026-10-02T03:00:00.000Z',
    plasticAvoidedGrams: 1200,
    refillPacks: 1,
    wasteReturned: { requests: 0, grams: 0, unitsWithoutWeight: 0 },
    trees: { pledged: 0, planted: 0 },
    co2Grams: null,
    monthly: [],
    stamps: [],
  };

  it('cấu hình chung bật và API trả hộ chiếu: một dòng tới /tai-khoan/ho-chieu-xanh', async () => {
    state.config = { waste: { enabled: true }, ecoPassportEnabled: true };
    state.passport = PASSPORT;
    const c = await mount();
    const row = c.querySelector<HTMLAnchorElement>('[data-testid="eco-passport-entry"]');
    expect(row?.getAttribute('href')).toBe('/tai-khoan/ho-chieu-xanh');
    expect(row?.textContent).toContain('Hộ chiếu Xanh');
    // Từ lg: thêm một hàng auto cho dòng này và cột phải trải thêm một hàng, lịch sử vẫn ở hàng 1fr cuối.
    expect(row?.parentElement?.className).toContain('lg:grid-rows-[auto_auto_auto_auto_1fr]');
    expect(c.querySelector('.lg\\:col-start-2.lg\\:row-start-2')?.className).toContain('lg:row-span-4');
  });

  it('cấu hình chung không báo bật: không hỏi /me/eco-passport, không có dòng', async () => {
    state.passport = PASSPORT;
    for (const config of [{ waste: { enabled: true } }, { waste: { enabled: true }, ecoPassportEnabled: 'true' }]) {
      state.config = config;
      state.calls = [];
      const c = await mount();
      expect(state.calls.some((x) => x.path === '/me/eco-passport')).toBe(false);
      expect(c.querySelector('[data-testid="eco-passport-entry"]')).toBeNull();
      expect(c.querySelector('.lg\\:grid-rows-\\[auto_auto_auto_1fr\\]')).not.toBeNull();
      expect(c.querySelector('.lg\\:col-start-2.lg\\:row-start-2')?.className).toContain('lg:row-span-3');
      expect(c.textContent).toContain('Mầm Xanh');
    }
  });

  it('cấu hình chung bật nhưng API 404 hay lỗi: không có dòng, trang vẫn đủ', async () => {
    state.config = { waste: { enabled: true }, ecoPassportEnabled: true };
    const c = await mount();
    expect(state.calls.some((x) => x.path === '/me/eco-passport')).toBe(true);
    expect(c.querySelector('[data-testid="eco-passport-entry"]')).toBeNull();
    expect(c.textContent).toContain('Mầm Xanh');
  });

  it('khách chưa đăng nhập: không hỏi /me/eco-passport', async () => {
    state.config = { waste: { enabled: true }, ecoPassportEnabled: true };
    state.phase = 'guest';
    await mount();
    expect(state.calls.some((x) => x.path === '/me/eco-passport')).toBe(false);
  });
});
