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
  card: null as Record<string, unknown> | null,
  config: { waste: { enabled: true } } as Record<string, unknown>,
  fail: new Set<string>(),
  readyRoutes: new Set<string>(),
  calls: [] as { method: string; path: string; body?: unknown; headers?: Record<string, string> }[],
  checkInPost: null as null | (() => Promise<unknown>),
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => state.readyRoutes.has(p) }));
vi.mock('@/lib/core-http', () => {
  const table: Record<string, () => unknown> = {
    '/me/loyalty': () => state.loyalty,
    '/me/coupons': () => state.coupons,
    '/me/points/transactions': () => state.txns,
    '/me/loyalty/check-in': () => state.checkIn,
    '/me/loyalty/member-card': () => state.card,
    '/config/public': () => state.config,
  };
  return {
    coreHttp: {
      get: async (path: string) => {
        state.calls.push({ method: 'get', path });
        if (state.fail.has(path)) throw new Error('Máy chủ đang bận');
        return table[path]!();
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
  state.config = { waste: { enabled: true } };
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
    expect(c.textContent).toContain('1.800 điểm Xanh');
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

  it('điểm sắp hết hạn, chính sách hạn điểm và điểm đang chờ mở khoá', async () => {
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
    expect(c.textContent).toContain('250 điểm đang chờ, mở khoá ngày 22/10');
    expect(c.textContent).toContain('100 điểm đang chờ xử lý đổi/trả');
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
    expect(section.textContent).toContain('từ 4 triệu mua hàng trong 12 tháng · ×1.2');
    expect(section.querySelector('[aria-current="true"]')?.textContent).toContain('Mầm Xanh');
  });

  it('quyền lợi của hạng hiện tại', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Quyền lợi của bạn');
    expect(c.textContent).toContain('Quà sinh nhật');
  });
});

describe('/tai-khoan/diem-xanh — mã giảm giá của tôi', () => {
  it('nằm ngay dưới thẻ hạng, trước điểm danh; hiện số mã, nhãn, điều kiện và hạn dd/MM/yyyy', async () => {
    state.coupons = [
      { code: 'FREESHIP1', type: 'FREESHIP', value: 0, minOrder: 199000, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' },
      { code: 'PCT10', type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50000, endAt: '2026-11-01T05:00:00Z' },
      { code: 'PCT5', type: 'PERCENT', value: 5, minOrder: null, maxDiscount: null, endAt: '2026-11-01T05:00:00Z' },
      { code: 'AMT', type: 'AMOUNT', value: 30000, minOrder: null, maxDiscount: null, endAt: '2026-11-01T05:00:00Z' },
    ];
    const c = await mount();
    const heads = Array.from(c.querySelectorAll('h2')).map((h) => h.textContent);
    expect(heads.indexOf('Mã giảm giá của tôi')).toBeGreaterThan(-1);
    expect(heads.indexOf('Mã giảm giá của tôi')).toBeLessThan(heads.indexOf('Điểm danh nhận Điểm Xanh'));
    expect(heads.indexOf('Điểm danh nhận Điểm Xanh')).toBeLessThan(heads.indexOf('Các hạng'));
    expect(c.textContent).toContain('4 mã');
    expect(c.textContent).toContain('Miễn phí vận chuyển');
    expect(c.textContent).toContain('đơn từ 199.000đ');
    expect(c.textContent).toContain('HSD 31/12/2026');
    expect(c.textContent).toContain('Giảm 10% (tối đa 50.000đ)');
    expect(c.textContent).toContain('Giảm 5%');
    expect(c.textContent).not.toContain('Giảm 5% (tối đa');
    expect(c.textContent).toContain('Giảm 30.000đ');
  });

  it('mã tự cấp hiện tên thân thiện, không lộ mã thô', async () => {
    state.coupons = [{ code: 'MILESTONE1000000-2026-10-u1abc', type: 'AMOUNT', value: 50000, minOrder: null, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' }];
    const c = await mount();
    expect(c.textContent).toContain('Quà mốc chi tiêu 1 triệu');
    expect(c.textContent).not.toContain('MILESTONE1000000-2026-10-u1abc');
  });

  it('chưa có mã: câu trống chỉ cách có mã; lỗi tải: báo lỗi và Thử lại, không giả vờ "chưa có mã"', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Chưa có mã giảm giá khả dụng');
    state.fail.add('/me/coupons');
    const failed = await mount();
    expect(failed.textContent).toContain('Chưa tải được mã giảm giá: Máy chủ đang bận');
    expect(failed.textContent).not.toContain('Chưa có mã giảm giá khả dụng');
    state.fail.clear();
    state.calls = [];
    click(byText(failed, 'button', 'Thử lại'));
    await flush();
    expect(state.calls.some((x) => x.path === '/me/coupons')).toBe(true);
  });
});

describe('/tai-khoan/diem-xanh — điểm danh', () => {
  it('chưa điểm danh: nút "Điểm danh +3"; bấm gửi đúng POST /me/loyalty/check-in một lần, báo kết quả và khoá nút', async () => {
    state.checkInPost = async () => {
      state.checkIn = { ...state.checkIn!, checkedInToday: true };
      return { success: true, cycleDay: 3, streakDays: 3, pointsEarned: 3, totalPoints: 1804, message: 'Điểm danh thành công +3 Điểm Xanh' };
    };
    const c = await mount();
    const btn = byText(c, 'button', 'Điểm danh +3') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    click(btn);
    click(btn);
    await flush();
    const posts = state.calls.filter((x) => x.method === 'post');
    expect(posts).toEqual([{ method: 'post', path: '/me/loyalty/check-in', body: undefined, headers: undefined }]);
    expect(c.querySelector('[role="status"]')?.textContent).toContain('Điểm danh thành công +3 Điểm Xanh');
    expect((byText(c, 'button', 'Đã điểm danh') as HTMLButtonElement).disabled).toBe(true);
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
    const before = state.calls.filter((x) => x.path === '/me/loyalty/check-in' && x.method === 'get').length;
    click(byText(c, 'button', 'Điểm danh +3'));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Hôm nay bạn đã điểm danh rồi');
    expect(state.calls.filter((x) => x.path === '/me/loyalty/check-in' && x.method === 'get').length).toBeGreaterThan(before);
  });

  it('7 ô ngày với điểm từng ngày và chuỗi ngày liên tiếp', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Chuỗi: 2 ngày liên tiếp');
    for (const d of ['N1', 'N2', 'N3', 'N7']) expect(c.textContent).toContain(d);
    expect(c.textContent).toContain('+10');
  });

  it('lỗi tải lịch điểm danh: báo lỗi có Thử lại', async () => {
    state.fail.add('/me/loyalty/check-in');
    const c = await mount();
    expect(c.textContent).toContain('Chưa tải được lịch điểm danh: Máy chủ đang bận');
    expect(byText(c, 'button', 'Thử lại')).not.toBeNull();
  });
});

describe('/tai-khoan/diem-xanh — lối tắt', () => {
  it('route web chưa làm (pending) thì không hiện lối tắt; chỉ còn lối mua sắm', async () => {
    const c = await mount();
    expect(c.querySelector('a[href="/vuon-xanh"]')).toBeNull();
    expect(c.querySelector('a[href="/doi-rac"]')).toBeNull();
    expect(c.querySelector('a[href="/kho-qua"]')).toBeNull();
  });

  it('route đã sẵn sàng: Vườn Xanh, Đổi rác lấy quà (theo waste.enabled), Kho quà', async () => {
    state.readyRoutes = new Set(['/vuon-xanh', '/doi-rac', '/kho-qua']);
    const c = await mount();
    expect(c.querySelector('a[href="/vuon-xanh"]')?.textContent).toContain('Vườn Cây Tubu');
    expect(c.querySelector('a[href="/doi-rac"]')?.textContent).toContain('Đổi rác lấy quà');
    expect(c.querySelector('a[href="/kho-qua"]')?.textContent).toContain('Kho quà');
    state.config = { waste: { enabled: false } };
    const off = await mount();
    expect(off.querySelectorAll('a[href="/doi-rac"]')).toHaveLength(0);
    expect(off.querySelectorAll('a[href="/kho-qua"]')).toHaveLength(1);
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

  it('chỉ hiện 20 giao dịch gần nhất và không có dòng chú thích cuối như Mini App', async () => {
    state.txns = Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, delta: 1, reason: 'CHECKIN_DAILY:DAY_1', expiresAt: null, createdAt: '2026-10-10T05:00:00Z' }));
    const c = await mount();
    expect(c.querySelectorAll('section[aria-label="Lịch sử Điểm Xanh"] li')).toHaveLength(20);
    expect(c.textContent).not.toContain('Hiển thị tối đa');
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
    expect(dialog.textContent).toContain('Hạng Mầm Xanh · 1.800 điểm Xanh');
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
  it('khách chưa đăng nhập thấy lời mời đăng nhập mang theo returnTo, không gọi API', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.querySelector('a[href^="/dang-nhap"]')?.getAttribute('href')).toBe(`/dang-nhap?returnTo=${encodeURIComponent('/tai-khoan/diem-xanh')}`);
    expect(state.calls).toEqual([]);
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
    expect(c.querySelector('main')!.hasAttribute('data-page-bleed')).toBe(true);
    expect(c.querySelector('h1')!.parentElement!.className).toContain('max-md:bg-stone-0');
  });
});

describe('/tai-khoan/diem-xanh — tiêu đề khối như Mini App', () => {
  it('tiêu đề các khối cỡ title-sm ở điện thoại; thẻ hạng chữ lớn như medallion', async () => {
    const c = await mount();
    for (const name of ['Các hạng', 'Lịch sử Điểm Xanh', 'Mã giảm giá của tôi']) {
      const h = Array.from(c.querySelectorAll('h2')).find((x) => x.textContent === name)!;
      expect(h.className, name).toContain('max-md:text-[length:var(--type-title-sm-size)]');
    }
    const tier = c.querySelector('section[aria-label="Hạng thành viên"] h2')!;
    expect(tier.className).toContain('max-md:text-[length:var(--type-title-lg-size)]');
  });
});
