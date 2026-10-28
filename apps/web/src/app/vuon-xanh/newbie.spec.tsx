// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets } from '@/test-utils/a11y';

/**
 * Nhịp chơi người mới của Vườn Xanh trên web (docs/2026-10-25-ux-review/03-game-nguoi-moi.md, 2.3, 2.6, 2.7, F1-F10):
 * cùng các ca với Mini App (apps/miniapp/src/pages/game-newbie.spec.tsx).
 */
type Call = { method: string; path: string; body?: unknown };

const state = vi.hoisted(() => ({
  search: '' as string,
  replace: vi.fn(),
  push: vi.fn(),
  data: {} as Record<string, unknown>,
  fail: new Set<string>(),
  posts: {} as Record<string, () => unknown>,
  calls: [] as Call[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => 'key-1' }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => false }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  usePathname: () => '/vuon-xanh',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'get', path });
      if (state.fail.delete(path)) throw new Error('mất mạng');
      if (path === '/config/public') return { waste: { enabled: false } };
      if (path in state.data) return state.data[path];
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'post', path, body });
      const h = state.posts[path];
      if (!h) throw new Error(`chưa mock POST ${path}`);
      return h();
    },
  },
}));

import GamePage from './page';

const todayIso = () => new Date().toISOString();
const yesterdayIso = () => new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const NEW_PLAYER = {
  totalSeeds: 0,
  streakDays: 0,
  treeStage: 1,
  treeHealth: 'HEALTHY',
  streakFreezes: 0,
  lastDewAt: null as string | null,
  lastCheckInAt: null as string | null,
  streakFreezeCost: 40,
  treePointsPrice: 50_000,
  streakRepairable: false,
  streakRepairCost: 50,
  spinCostPoints: 10_000,
  dailyLoginSeeds: 15,
  dewSeeds: 15,
  streak7Seeds: 30,
  quizWrongSeeds: 2,
  firstCheckinBonus: 50,
  currentTreeTarget: 60,
  nextTreeTarget: 300,
  ecoImpact: { progress: 0, target: 60, treeType: 'Cây Dứa Fuwa3e', treesPlanted: 0 },
};
const P = (over: Record<string, unknown> = {}) => ({ ...NEW_PLAYER, ...over });
const DRY = (over: Record<string, unknown> = {}) => P({ lastCheckInAt: todayIso(), lastDewAt: todayIso(), streakDays: 1, firstCheckinBonus: 0, ...over });
const HOME = { id: null, slot: 1, isHome: true, treeType: 'Sồi', speciesId: null, progress: 0, target: 60, treeStage: 1, treesPlanted: 2, treeHealth: 'HEALTHY' };
const PLOT = { id: 'pa', slot: 2, isHome: false, treeType: 'Mận', speciesId: 's1', progress: 5, target: 300, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' };
const QUIZ = [
  { id: 'q1', question: 'Cây cần gì?', options: ['A', 'B'], category: 'cay', difficulty: 1, waterReward: 8 },
  { id: 'q2', question: 'Nước từ đâu?', options: ['A', 'B'], category: 'nuoc', difficulty: 1, waterReward: 10 },
];

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<GamePage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const postsOf = (path: string) => state.calls.filter((c) => c.method === 'post' && c.path === path);
const btn = (c: HTMLElement, text: string | RegExp) => byText(c, 'button', text) as HTMLButtonElement;
const maybeBtn = (c: HTMLElement, text: string | RegExp) => Array.from(c.querySelectorAll('button')).find((b) => (typeof text === 'string' ? b.textContent === text : text.test(b.textContent ?? '')));
const panel = (c: HTMLElement, label: string) => c.querySelector<HTMLElement>(`[role="tabpanel"][aria-label="${label}"]`)!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const sheetOpen = () => dialog()?.textContent?.includes('Kiếm nước') ?? false;
const tab = async (c: HTMLElement, name: string) => {
  click(byText(c, '[role="tab"]', name));
  await flush(2);
};

beforeEach(() => {
  localStorage.clear();
  state.search = '';
  state.calls = [];
  state.fail = new Set();
  state.push.mockReset();
  state.replace.mockReset();
  state.posts = {
    '/me/daily-check-in': () => ({ points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: { seedsEarned: 65, streakDays: 1, totalSeeds: 65, streakFrozeUsed: false, bonusNote: '' }, alreadyDone: false, pending: [] }),
    '/game/dew/collect': () => ({ seedsEarned: 15, totalSeeds: 80 }),
    '/game/tree/water': () => ({ progress: 30, target: 60, harvested: false, treesPlanted: 0 }),
    '/game/garden/plot/pa/water': () => ({ progress: 25, target: 300, harvested: false, treesPlanted: 0, revivedFromDead: false }),
    '/game/streak-freeze/buy': () => ({ streakFreezes: 1, totalSeeds: 0 }),
    '/game/streak/repair': () => ({ repaired: true, streakDays: 5, totalSeeds: 0 }),
    '/game/garden/unlock': () => ({}),
    '/game/tree/buy': () => ({ certificateCode: 'T', treeType: 'x', cost: 50_000, pointsUsed: 50_000, pointsUsedConverted: 0 }),
    '/game/spin': () => ({ prize: { id: 'p', name: 'x', rewardType: 'POINTS', value: 1 } }),
  };
  state.data = {
    '/game/profile': P(),
    '/game/quiz/today': QUIZ,
    '/game/missions': [],
    '/game/forest': { count: 0, plantedCount: 0, trees: [] },
    '/game/season': null,
    '/game/garden': { plots: [HOME], maxPlots: 4, nextUnlock: { slot: 2, seedCost: 100 } },
    '/me/loyalty': { pointsBalance: 100_000, redeemablePoints: 100_000, redeemableTotal: 100_000 },
  };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Vườn Xanh người mới (web): nút chính và không ngõ cụt', () => {
  it('hồ sơ mới 0 giọt: nút đầu tiên của tab Hôm nay là điểm danh nhận 65💧, bấm gọi check-in, không tưới', async () => {
    const c = await mount();
    const first = panel(c, 'Hôm nay').querySelector('button')!;
    expect(first.textContent).toContain('Điểm danh nhận 65💧');
    click(first);
    await flush(6);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
    expect(postsOf('/game/tree/water')).toHaveLength(0);
    expect(postsOf('/game/dew/collect')).toHaveLength(0);
  });

  it('ngày sau: "Nhận nước hôm nay (+30💧)" điểm danh rồi hứng sương luôn', async () => {
    state.data['/game/profile'] = P({ firstCheckinBonus: 0, lastCheckInAt: yesterdayIso(), streakDays: 1 });
    const c = await mount();
    click(btn(c, 'Nhận nước hôm nay (+30💧)'));
    await flush(8);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
  });

  it('có từ 20💧: "Tưới hết (65💧)" gửi drops = toàn bộ số giọt', async () => {
    state.data['/game/profile'] = DRY({ totalSeeds: 65 });
    const c = await mount();
    click(btn(c, 'Tưới hết (65💧)'));
    await flush(6);
    expect(postsOf('/game/tree/water')[0]!.body).toEqual({ drops: 65 });
  });

  const cases: { label: string; tab?: string; name: string; path: string; need: string }[] = [
    { label: 'nút chính', name: 'Kiếm thêm nước', path: '/game/tree/water', need: 'Bạn đang có 0💧' },
    { label: 'vé giữ lửa', name: 'Giữ chuỗi (cần thêm 40💧)', path: '/game/streak-freeze/buy', need: 'Bạn cần thêm 40💧 nữa.' },
    { label: 'hồi sinh chuỗi', name: 'Còn thiếu 50💧', path: '/game/streak/repair', need: 'Bạn cần thêm 50💧 nữa.' },
    { label: 'tưới lô phụ', tab: 'Vườn', name: 'Tưới', path: '/game/garden/plot/pa/water', need: 'Bạn cần thêm 20💧 nữa.' },
    { label: 'mở lô', tab: 'Vườn', name: 'Còn thiếu 100💧', path: '/game/garden/unlock', need: 'Bạn cần thêm 100💧 nữa.' },
  ];
  it.each(cases)('mọi nút thiếu nước mở sheet "Kiếm nước", không gọi API, không báo lỗi: $label', async ({ tab: t, name, path, need }) => {
    state.data['/game/profile'] = DRY({ totalSeeds: 0, streakRepairable: true, brokenStreakDays: 5 });
    state.data['/game/garden'] = { plots: [HOME, PLOT], maxPlots: 4, nextUnlock: { slot: 3, seedCost: 100 } };
    // Dữ liệu tab Vườn chỉ tải khi mở tab (?tab=garden).
    state.search = t ? 'tab=garden' : '';
    const c = await mount();
    if (t) await tab(c, t);
    click(btn(t ? panel(c, t) : c, name));
    await flush(4);
    expect(sheetOpen()).toBe(true);
    expect(dialog()!.textContent).toContain(need);
    expect(postsOf(path)).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('sheet: liệt kê điểm danh (+số), câu đố còn lại, bạn bè; bấm điểm danh trong sheet gọi check-in; vùng chạm đủ lớn', async () => {
    state.data['/game/profile'] = P({ firstCheckinBonus: 0, lastCheckInAt: yesterdayIso(), totalSeeds: 3 });
    state.data['/game/friends'] = [{ id: 'f1', nickname: 'Lan', giftedToday: false }];
    const c = await mount();
    click(btn(c, 'Giữ chuỗi (cần thêm 37💧)'));
    await flush(4);
    const d = dialog()!;
    expect(d.textContent).toContain('Điểm danh hôm nay');
    expect(d.textContent).toContain('+15💧');
    expect(d.textContent).toContain('Làm câu đố (còn 2 câu)');
    expect(d.textContent).toContain('Nước từ bạn bè');
    expect(smallTouchTargets(d)).toEqual([]);
    click(btn(d, 'Điểm danh'));
    await flush(6);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
  });

  it('sheet: hết việc thì báo xong và giờ mở lại; câu đố tải lỗi hiện thông báo và "Thử lại"', async () => {
    state.data['/game/profile'] = DRY();
    state.data['/game/quiz/today'] = [];
    let c = await mount();
    click(btn(c, 'Kiếm thêm nước'));
    await flush(4);
    expect(dialog()!.textContent).toContain('Bạn đã làm hết việc kiếm nước hôm nay.');
    expect(dialog()!.textContent).toContain('Điểm danh và hứng sương mở lại sau 0 giờ ngày mai.');
    mounted.forEach((m) => m.unmount());
    mounted = [];

    state.data['/game/quiz/today'] = QUIZ;
    state.fail.add('/game/quiz/today');
    c = await mount();
    click(btn(c, 'Kiếm thêm nước'));
    await flush(4);
    expect(dialog()!.textContent).toContain('Chưa tải được việc kiếm nước.');
    click(btn(dialog()!, 'Thử lại'));
    await flush(6);
    expect(dialog()!.textContent).toContain('Làm câu đố (còn 2 câu)');
  });

  it('sheet: lỗi điểm danh hiện ngay trong sheet', async () => {
    state.data['/game/profile'] = P({ firstCheckinBonus: 0, lastCheckInAt: yesterdayIso(), totalSeeds: 0 });
    state.posts['/me/daily-check-in'] = () => {
      throw new Error('Hôm nay bạn đã điểm danh rồi');
    };
    const c = await mount();
    click(btn(c, 'Giữ chuỗi (cần thêm 40💧)'));
    await flush(4);
    click(btn(dialog()!, 'Điểm danh'));
    await flush(6);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('Hôm nay bạn đã điểm danh rồi');
  });
});

describe('Vườn Xanh người mới (web): thẻ 3 bước', () => {
  it('bước 1 → 2 → 3 theo dữ liệu; bước 3 có "Đã hiểu", bấm thì ẩn và không hiện lại', async () => {
    let c = await mount();
    expect(c.textContent).toContain('Bước 1/3');
    expect(maybeBtn(c, 'Đã hiểu')).toBeUndefined();
    mounted.forEach((m) => m.unmount());
    mounted = [];

    state.data['/game/profile'] = P({ lastCheckInAt: todayIso(), totalSeeds: 65 });
    c = await mount();
    expect(c.textContent).toContain('Bước 2/3');
    mounted.forEach((m) => m.unmount());
    mounted = [];

    state.data['/game/profile'] = DRY({ totalSeeds: 5, ecoImpact: { progress: 5, target: 300, treeType: 'Cây', treesPlanted: 1 } });
    c = await mount();
    expect(c.textContent).toContain('Bước 3/3');
    expect(c.textContent).toContain('Câu đố đúng hết thêm khoảng 18💧.');
    expect(c.textContent).toContain('Ngày mai: điểm danh + sương = 30💧');
    click(btn(c, 'Đã hiểu'));
    await flush(2);
    expect(c.textContent).not.toContain('Phiên đầu tiên của bạn');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    c = await mount();
    expect(c.textContent).not.toContain('Phiên đầu tiên của bạn');
  });
});

describe('Vườn Xanh người mới (web): số hiện trước khi bấm lấy từ hồ sơ', () => {
  it('điểm danh, sương, ô N3 và N7 ghi số 💧 từ profile', async () => {
    state.data['/game/profile'] = DRY({ lastCheckInAt: yesterdayIso(), lastDewAt: null, dailyLoginSeeds: 17, dewSeeds: 11, streak7Seeds: 40, totalSeeds: 500 });
    const c = await mount();
    expect(c.textContent).toContain('Nhận +17💧 và Điểm Xanh mỗi ngày');
    expect(maybeBtn(c, 'Hứng giọt sương (+11💧)')).toBeDefined();
    expect(c.textContent).toContain('+5💧');
    expect(c.textContent).toContain('+40💧');
    expect(maybeBtn(c, 'Nhận nước hôm nay (+28💧)')).toBeDefined();
  });

  it('bình đầy: nút chính "Nhận nước hôm nay" không ghi +N💧; gần đầy ghi số chỗ trống', async () => {
    state.data['/game/profile'] = DRY({ lastCheckInAt: yesterdayIso(), lastDewAt: null, firstCheckinBonus: 0, totalSeeds: 500, tankCapacity: 500 });
    let c = await mount();
    expect(maybeBtn(c, 'Nhận nước hôm nay')).toBeDefined();
    expect(c.textContent).not.toContain('Nhận nước hôm nay (+');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/game/profile'] = DRY({ lastCheckInAt: yesterdayIso(), lastDewAt: null, firstCheckinBonus: 0, totalSeeds: 495, tankCapacity: 500 });
    c = await mount();
    expect(maybeBtn(c, 'Nhận nước hôm nay (+5💧)')).toBeDefined();
  });

  it('lần đầu nói rõ quà người mới; API cũ chưa trả số thì không hiện "undefined"', async () => {
    let c = await mount();
    expect(c.textContent).toContain('Lần đầu nhận +65💧, các ngày sau +15💧');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/game/profile'] = { totalSeeds: 500, streakDays: 2, treeStage: 1, streakFreezes: 0, lastDewAt: null, lastCheckInAt: yesterdayIso(), ecoImpact: { progress: 0, target: 600, treeType: 'Cây', treesPlanted: 1 } };
    c = await mount();
    expect(c.textContent).toContain('Nhận giọt nước và Điểm Xanh mỗi ngày');
    expect(maybeBtn(c, 'Nhận nước hôm nay')).toBeDefined();
    expect(c.textContent).not.toMatch(/undefined|NaN/);
  });
});

describe('Vườn Xanh người mới (web): hộp chúc mừng', () => {
  const harvest = async (resp: unknown) => {
    state.data['/game/profile'] = DRY({ totalSeeds: 65 });
    state.posts['/game/tree/water'] = () => resp;
    const c = await mount();
    click(btn(c, 'Tưới hết (65💧)'));
    await flush(8);
    return dialog()!;
  };

  it('cây mầm: +2.000 Điểm Xanh và thẻ loài, không mã, không "Tubu góp 1 cây", cây kế tiếp cần 300💧', async () => {
    const d = await harvest({
      progress: 5,
      target: 300,
      harvested: true,
      treesPlanted: 1,
      reward: { points: 2000, species: { name: 'Lim xanh', emoji: '🌲', rarity: 'COMMON', ecoFact: null } },
    });
    expect(d.textContent).toContain('Thu hoạch thành công!');
    expect(d.textContent).toContain('+2.000 Điểm Xanh');
    expect(d.textContent).toContain('🌲 Lim xanh');
    expect(d.textContent).toContain('Cây tiếp theo cần 300💧');
    expect(d.textContent).not.toContain('Tubu sẽ góp');
    expect(maybeBtn(d, 'Dùng mã giảm giá ngay')).toBeUndefined();
  });

  it('cây mầm của khách (không điểm, không mã): nói cây mầm, không nói Tubu góp 1 cây', async () => {
    const d = await harvest({ progress: 0, target: 300, harvested: true, treesPlanted: 1, rewardBlocked: 'GUEST', reward: { sprout: true } });
    expect(d.textContent).toContain('Cây mầm đầu tiên của bạn đã lớn');
    expect(d.textContent).not.toContain('Tubu sẽ góp');
  });

  it.each([
    ['DAY', 'Hôm nay bạn đã nhận mã giảm giá'],
    ['MONTH', 'Tháng này bạn đã nhận đủ mã giảm giá'],
  ])('chạm trần mã %s: hộp giải thích, cây vẫn được tính', async (cap, text) => {
    const d = await harvest({ progress: 0, target: 600, harvested: true, treesPlanted: 5, couponCapped: cap, reward: { certificate: 'CERT-1' } });
    expect(d.textContent).toContain(text);
    expect(d.textContent).toContain('CERT-1');
    expect(maybeBtn(d, 'Dùng mã giảm giá ngay')).toBeUndefined();
  });

  it('nhiều mã trong một lần tưới: hiện tất cả', async () => {
    const d = await harvest({ progress: 0, target: 600, harvested: true, treesPlanted: 3, reward: { coupon: 'A1', coupons: ['A1', 'B2'] } });
    expect(d.textContent).toContain('A1');
    expect(d.textContent).toContain('B2');
    expect(maybeBtn(d, 'Dùng mã giảm giá ngay')).toBeDefined();
  });

  it.each([['couponCapped'], ['rewardBlocked']])('khách vãng lai (%s): mời đăng nhập Zalo, nút đăng nhập sang trang đăng nhập', async (field) => {
    const d = await harvest({ progress: 0, target: 600, harvested: true, treesPlanted: 1, [field]: 'GUEST' });
    expect(d.textContent).toContain('Đăng nhập Zalo để nhận quà khi thu hoạch.');
    click(btn(d, 'Đăng nhập Zalo'));
    expect(state.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fvuon-xanh');
  });

  it('thu hoạch thường vẫn nói Tubu góp 1 cây', async () => {
    const d = await harvest({ progress: 0, target: 600, harvested: true, treesPlanted: 2, reward: { coupon: 'GAME30000-X', certificate: 'C2' } });
    expect(d.textContent).toContain('Tubu sẽ góp 1 cây vào quỹ trồng cây');
  });
});

describe('Vườn Xanh người mới (web): thiếu điểm và lô phụ', () => {
  it('vòng quay thiếu điểm: hiện "Bạn có X / 10.000 Điểm Xanh", không nút quay, "Cách kiếm Điểm Xanh" sang trang Điểm Xanh', async () => {
    state.data['/me/loyalty'] = { pointsBalance: 3_000, redeemablePoints: 3_000, redeemableTotal: 3_000 };
    const c = await mount();
    const t = panel(c, 'Hôm nay');
    expect(t.textContent).toContain('Bạn có 3.000 / 10.000 Điểm Xanh cho 1 lượt quay');
    expect(maybeBtn(t, /Quay ngay/)).toBeUndefined();
    click(btn(t, 'Cách kiếm Điểm Xanh'));
    expect(state.push).toHaveBeenCalledWith('/tai-khoan/diem-xanh');
    expect(postsOf('/game/spin')).toHaveLength(0);
  });

  it('đủ điểm hoặc chưa biết số dư: vẫn là nút "Quay ngay"', async () => {
    let c = await mount();
    expect(maybeBtn(panel(c, 'Hôm nay'), /Quay ngay/)).toBeDefined();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    delete state.data['/me/loyalty'];
    c = await mount();
    expect(maybeBtn(panel(c, 'Hôm nay'), /Quay ngay/)).toBeDefined();
  });

  it('vòng quay chỉ tính điểm dùng được (không tính điểm đang khoá)', async () => {
    state.data['/me/loyalty'] = { pointsBalance: 12_000, redeemablePoints: 4_000, redeemableTotal: 4_000 };
    const c = await mount();
    expect(panel(c, 'Hôm nay').textContent).toContain('Bạn có 4.000 / 10.000 Điểm Xanh cho 1 lượt quay');
  });

  it('góp quỹ nằm ở tab Vườn, không ở Hôm nay; thiếu điểm hiện số dư và "Cách kiếm Điểm Xanh"', async () => {
    const c = await mount();
    expect(maybeBtn(panel(c, 'Hôm nay'), /Góp quỹ trồng cây/)).toBeUndefined();
    expect(maybeBtn(panel(c, 'Vườn'), 'Góp quỹ trồng cây (50.000 điểm)')).toBeDefined();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/me/loyalty'] = { pointsBalance: 1_000, redeemablePoints: 1_000, redeemableTotal: 1_000 };
    const c2 = await mount();
    const garden = panel(c2, 'Vườn');
    expect(garden.textContent).toContain('Bạn có 1.000 / 50.000 Điểm Xanh');
    expect(maybeBtn(garden, /Góp quỹ trồng cây/)).toBeUndefined();
    click(btn(garden, 'Cách kiếm Điểm Xanh'));
    expect(state.push).toHaveBeenCalledWith('/tai-khoan/diem-xanh');
  });

  it('lô phụ ẩn tới khi thu hoạch cây thứ 2, thay bằng dòng gợi ý; từ cây thứ 2 hiện nút mở lô ghi giá', async () => {
    state.search = 'tab=garden';
    state.data['/game/profile'] = DRY({ ecoImpact: { progress: 5, target: 300, treeType: 'Cây', treesPlanted: 1 } });
    let c = await mount();
    expect(panel(c, 'Vườn').textContent).toContain('Thu hoạch cây thứ 2 để mở thêm lô đất.');
    expect(panel(c, 'Vườn').textContent).not.toContain('Lô đất của bạn');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/game/profile'] = DRY({ totalSeeds: 500, ecoImpact: { progress: 5, target: 600, treeType: 'Cây', treesPlanted: 2 } });
    c = await mount();
    expect(maybeBtn(panel(c, 'Vườn'), 'Mở lô (100💧)')).toBeDefined();
    expect(panel(c, 'Vườn').textContent).not.toContain('Thu hoạch cây thứ 2');
  });
});

describe('Vườn Xanh người mới (web): chữ không còn hứa mất tiến độ', () => {
  it.each(['WILTED', 'DEAD'])('cây %s: "Cây đang héo, tưới để cây xanh lại."', async (health) => {
    state.data['/game/profile'] = DRY({ treeHealth: health });
    const c = await mount();
    expect(c.textContent).toContain('Cây đang héo, tưới để cây xanh lại.');
    expect(c.textContent).not.toMatch(/trồng cây mới từ đầu|héo úa|mất hết/);
  });

  it('cổng đăng nhập riêng cho game (không còn nói "xem cộng đồng")', async () => {
    const { gameNewbieCopy } = await import('@tubutree/app-core/game-newbie');
    expect(gameNewbieCopy.loginToView).toBe('Đăng nhập để trồng cây, nhận nước và quà');
  });
});
