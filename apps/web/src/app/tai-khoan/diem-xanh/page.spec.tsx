// @vitest-environment jsdom
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
  fail: new Set<string>(),
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
  };
  return {
    coreHttp: {
      get: async (path: string, opts?: { query?: { beforeId?: string; limit?: number } }) => {
        state.calls.push({ method: 'get', path, query: opts?.query });
        if (state.fail.has(path)) throw new Error('Máy chủ đang bận');
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
  state.readyRoutes = new Set();
  state.calls = [];
  state.push.mockReset();
  state.cartCount = 0;
  state.applied = [];
  state.config = { waste: { enabled: true } };
  state.wasteRequests = [];
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

  it('thiếu mốc chi tiêu: nói theo điểm tích từ mua hàng kèm số tiền tương ứng', async () => {
    state.loyalty = { ...state.loyalty!, nextTier: { id: 't2', name: 'Lộc Biếc', minPoints: 200, minSpending: null, pointsToGo: 120 } };
    const c = await mount();
    expect(c.textContent).toContain('Còn 120 điểm tích từ mua hàng (tương đương khoảng 6.000đ mua hàng) để lên hạng Lộc Biếc');
  });

  it('giải thích cách tích điểm và 1 điểm khi dùng theo cấu hình; API cũ chưa trả rates thì không hiện', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Tích 2% tiền hàng thành Điểm Xanh');
    expect(c.textContent).toContain('1 điểm = 1.000đ khi dùng ở bước thanh toán (tối đa 50% giá trị đơn)');
    state.loyalty = { ...state.loyalty!, rates: undefined };
    const old = await mount();
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

describe('/tai-khoan/diem-xanh — một dòng mã giảm giá thay cho danh sách mã', () => {
  const COUPONS = [
    { code: 'FREESHIP1', type: 'FREESHIP', value: 0, minOrder: 199000, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' },
    { code: 'PCT10', type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50000, endAt: '2026-11-01T05:00:00Z' },
  ];

  it('có mã: "Ví mã (n)" tới Ưu đãi mục mã, nằm ngay dưới thẻ hạng và trước điểm danh; không liệt kê từng mã', async () => {
    state.coupons = COUPONS;
    state.readyRoutes = new Set(['/uu-dai', '/kho-qua']);
    const c = await mount();
    const link = c.querySelector('a[href="/uu-dai?section=coupons"]')!;
    expect(link.textContent).toContain('Ví mã (2)');
    const heads = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(heads).not.toContain('Mã giảm giá của tôi');
    for (const later of ['Điểm danh mỗi ngày', 'Các hạng', 'Lịch sử Điểm Xanh']) {
      const h = Array.from(c.querySelectorAll('h2')).find((x) => x.textContent === later)!;
      expect(link.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING, later).toBeTruthy();
    }
    const tier = c.querySelector('section[aria-label="Hạng thành viên"]')!;
    expect(tier.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const gone of ['Miễn phí giao hàng', 'HSD', 'Giảm 10%', 'FREESHIP1']) expect(c.textContent).not.toContain(gone);
    // Kho quà vẫn là một dòng riêng khi dòng trên là Ví mã.
    expect(c.querySelector('a[href="/kho-qua"]')?.textContent).toContain('Kho quà');
  });

  it('chưa có mã: "Đổi quà" tới Kho quà, không lặp thêm dòng "Kho quà"', async () => {
    state.readyRoutes = new Set(['/uu-dai', '/kho-qua']);
    const c = await mount();
    const links = c.querySelectorAll('a[href="/kho-qua"]');
    expect(links).toHaveLength(1);
    expect(links[0]!.textContent).toContain('Đổi quà');
    expect(c.querySelector('a[href^="/uu-dai"]')).toBeNull();
    expect(c.textContent).not.toContain('Ví mã');
  });

  it('không tải được mã: "Ví mã" không kèm số, không giả vờ "chưa có mã"', async () => {
    state.fail.add('/me/coupons');
    state.readyRoutes = new Set(['/uu-dai', '/kho-qua']);
    const c = await mount();
    const link = c.querySelector('a[href="/uu-dai?section=coupons"]')!;
    expect(link.textContent).toContain('Ví mã');
    expect(link.textContent).not.toContain('Ví mã (');
    expect(c.textContent).not.toContain('Đổi quà');
  });

  it('route đích chưa sẵn sàng thì không hiện dòng', async () => {
    state.coupons = COUPONS;
    const c = await mount();
    expect(c.querySelector('a[href^="/uu-dai"]')).toBeNull();
  });
});

describe('/tai-khoan/diem-xanh — điểm danh', () => {
  it('câu giải thích nói một nút cho cả Điểm Xanh và giọt nước, không còn câu "điểm danh riêng trong Vườn Xanh"', async () => {
    const c = await mount();
    const note = Array.from(c.querySelectorAll('div')).find((p) => (p.textContent ?? '').startsWith('Một lần bấm nhận cả Điểm Xanh và giọt nước'))!;
    expect(note.textContent).toContain('Điểm danh không tính vào xét hạng.');
    expect(c.textContent).not.toContain('điểm danh riêng');
  });

  it('chưa điểm danh: nút "Điểm danh"; bấm gửi đúng POST /me/daily-check-in một lần, báo kết quả và khoá nút', async () => {
    state.checkInPost = async () => {
      state.checkIn = { ...state.checkIn!, checkedInToday: true };
      return {
        points: { success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 1804, message: '' },
        water: { seedsEarned: 10, streakDays: 1, totalSeeds: 10, streakFrozeUsed: false, bonusNote: '' },
        alreadyDone: false,
        pending: [],
      };
    };
    const c = await mount();
    const btn = byText(c, 'button', 'Điểm danh') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    click(btn);
    click(btn);
    await flush();
    const posts = state.calls.filter((x) => x.method === 'post');
    expect(posts).toEqual([{ method: 'post', path: '/me/daily-check-in', body: undefined, headers: undefined }]);
    expect(c.querySelector('[role="status"]')?.textContent).toContain('+3 Điểm Xanh · +10 giọt nước');
    expect((byText(c, 'button', 'Đã điểm danh') as HTMLButtonElement).disabled).toBe(true);
  });

  it('thiếu một phần (nước lỗi): báo kiểu lỗi (role=alert) kèm lời nhắc bấm lại, giống Vườn Xanh', async () => {
    state.checkInPost = async () => ({
      points: { success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 1804, message: '' },
      water: null,
      alreadyDone: false,
      pending: ['water'],
    });
    const c = await mount();
    click(byText(c, 'button', 'Điểm danh'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('+3 Điểm Xanh. Còn thiếu một phần, bấm điểm danh lại để nhận nốt');
    expect(c.querySelector('[role="status"]')).toBeNull();
  });

  it('nửa vời (đã nhận Điểm Xanh, còn thiếu nước): dòng "Hôm nay nhận" chỉ liệt kê giọt nước', async () => {
    state.checkIn = { ...state.checkIn!, pointsDone: true, waterDone: false, todayPoints: 0, todayWater: 10 };
    const c = await mount();
    expect(c.textContent).toContain('Hôm nay nhận +10 giọt nước');
    expect(c.textContent).not.toContain('Hôm nay nhận +3 Điểm Xanh');
  });

  it('đã điểm danh hôm nay: nút "Đã điểm danh" tắt, bấm không gọi API', async () => {
    state.checkIn = { ...state.checkIn!, checkedInToday: true };
    const c = await mount();
    const btn = byText(c, 'button', 'Đã điểm danh') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    click(btn);
    await flush();
    expect(state.calls.some((x) => x.method === 'post')).toBe(false);
  });

  it('lỗi điểm danh: báo lỗi và tải lại trạng thái để nút theo đúng thực tế', async () => {
    state.checkInPost = async () => {
      throw new Error('Hôm nay bạn đã điểm danh rồi');
    };
    const c = await mount();
    const before = state.calls.filter((x) => x.path === '/me/daily-check-in' && x.method === 'get').length;
    click(byText(c, 'button', 'Điểm danh'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Hôm nay bạn đã điểm danh rồi');
    expect(state.calls.filter((x) => x.path === '/me/daily-check-in' && x.method === 'get').length).toBeGreaterThan(before);
  });

  it('7 ô ngày với điểm từng ngày và vị trí trong vòng 7 ngày', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Ngày 3/7');
    for (const d of ['N1', 'N2', 'N3', 'N7']) expect(c.textContent).toContain(d);
    expect(c.querySelector('[aria-label="Ngày 7: +10 Điểm Xanh"]')).not.toBeNull();
  });

  it('lỗi tải lịch điểm danh: báo lỗi có Thử lại', async () => {
    state.fail.add('/me/daily-check-in');
    const c = await mount();
    expect(c.textContent).toContain('Chưa tải được lịch điểm danh');
    expect(c.textContent).toContain('Máy chủ đang bận');
    expect(c.textContent).not.toContain('Chưa tải được lịch điểm danh: ');
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
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
    expect(c.querySelector('section[aria-label="Hạng thành viên"]')!.textContent).toContain('🌿');
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

describe('/tai-khoan/diem-xanh — lối tắt', () => {
  it('route web chưa làm (pending) thì không hiện lối tắt; chỉ còn lối mua sắm', async () => {
    const c = await mount();
    expect(c.querySelector('a[href="/vuon-xanh"]')).toBeNull();
    expect(c.querySelector('a[href="/doi-rac"]')).toBeNull();
    expect(c.querySelector('a[href="/kho-qua"]')).toBeNull();
  });

  it('route đã sẵn sàng: Vườn Xanh, Đổi rác lấy quà (theo waste.enabled), Đổi quà (chưa có mã) tới Kho quà', async () => {
    state.readyRoutes = new Set(['/vuon-xanh', '/doi-rac', '/kho-qua']);
    const c = await mount();
    expect(c.querySelector('a[href="/vuon-xanh"]')?.textContent).toContain('Vườn Xanh');
    expect(c.querySelector('a[href="/doi-rac"]')?.textContent).toContain('Đổi rác lấy quà');
    expect(c.querySelector('a[href="/kho-qua"]')?.textContent).toContain('Đổi quà');
    state.config = { waste: { enabled: false } };
    const off = await mount();
    expect(off.querySelectorAll('a[href="/doi-rac"]')).toHaveLength(0);
    expect(off.querySelectorAll('a[href="/kho-qua"]')).toHaveLength(1);
  });
});

describe('/tai-khoan/diem-xanh — xem lại yêu cầu đổi rác khi chương trình tắt', () => {
  it('chương trình tắt + khách từng có yêu cầu: có lối xem lại; không có yêu cầu hoặc chương trình bật thì không', async () => {
    state.readyRoutes = new Set(['/doi-rac', '/doi-rac/yeu-cau']);
    state.config = { waste: { enabled: false } };
    state.wasteRequests = [{ id: 'r1' }];
    const c = await mount();
    expect(c.querySelector('a[href="/doi-rac/yeu-cau"]')?.textContent).toContain('Yêu cầu đổi rác');
    expect(c.querySelector('a[href="/doi-rac"]')).toBeNull();
    mounted.pop()!.unmount();
    state.wasteRequests = [];
    const none = await mount();
    expect(none.querySelector('a[href="/doi-rac/yeu-cau"]')).toBeNull();
    mounted.pop()!.unmount();
    state.config = { waste: { enabled: true } };
    state.wasteRequests = [{ id: 'r1' }];
    const on = await mount();
    expect(on.querySelector('a[href="/doi-rac/yeu-cau"]')).toBeNull();
    expect(on.querySelector('a[href="/doi-rac"]')).not.toBeNull();
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
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('chưa được áp dụng');
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

  it('có đúng một h1 nói tên trang, đạt kiểm tra truy cập tối thiểu', async () => {
    const c = await mount();
    expect(c.querySelectorAll('h1')).toHaveLength(1);
    expect(c.querySelector('h1')?.textContent).toBe('Hạng thành viên & Điểm Xanh');
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });

  it('nút mua sắm dẫn về danh mục sản phẩm', async () => {
    const c = await mount();
    expect(byText(c, 'a', 'Mua sắm để tích thêm Điểm Xanh')?.getAttribute('href')).toBe('/');
  });
});

describe('/tai-khoan/diem-xanh — giao diện điện thoại như Mini App', () => {
  it('thẻ hạng giữ màu nền theo hạng (không bị nền trắng của thẻ đè), không viền ở điện thoại', async () => {
    const c = await mount();
    const card = c.querySelector('section[aria-label="Hạng thành viên"]')!;
    expect(card.classList.contains('bg-sage-50')).toBe(true);
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

  it('nút thẻ thành viên số và nút mua sắm là nút phụ kiểu ZaUI ở điện thoại', async () => {
    const c = await mount();
    expect(byText(c, 'button', 'Thẻ thành viên số')!.className).toContain('max-md:bg-forest-50');
    expect(byText(c, 'a', 'Mua sắm để tích thêm Điểm Xanh')!.className).toContain('max-md:bg-forest-50');
  });

  it('các thẻ khối không viền ở điện thoại', async () => {
    const c = await mount();
    const bordered = Array.from(c.querySelectorAll('section')).filter((s) => s.classList.contains('border'));
    expect(bordered).toEqual([]);
  });

  it('lối tắt dùng mũi tên chevron, không dùng ký tự ›', async () => {
    state.readyRoutes = new Set(['/vuon-xanh', '/kho-qua']);
    const c = await mount();
    const link = c.querySelector('a[href="/vuon-xanh"]')!;
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
