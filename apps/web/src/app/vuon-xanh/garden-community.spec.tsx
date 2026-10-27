// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

type Call = { method: string; path: string; body?: unknown };

const state = vi.hoisted(() => ({
  search: '' as string,
  replace: vi.fn(),
  push: vi.fn(),
  ready: new Set<string>(),
  seasonPass: false,
  config: { waste: { enabled: false } } as Record<string, unknown>,
  data: {} as Record<string, unknown>,
  fail: new Map<string, number>(),
  posts: {} as Record<string, () => unknown>,
  hold: new Map<string, Promise<unknown>>(),
  calls: [] as Call[],
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-coupon-use', () => ({
  useCouponUse: () => ({
    notice: null,
    copy: vi.fn(),
    cancel: vi.fn(),
    use: (code: string, before?: () => void) => {
      state.push('/san-pham', code);
      before?.();
    },
  }),
}));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => 'key-1' }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: (p: string) => state.ready.has(p) }));
vi.mock('@tubutree/app-core/features', () => ({
  get SEASON_PASS_ENABLED() {
    return state.seasonPass;
  },
  CASHBACK_ENABLED: false,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: state.replace }),
  usePathname: () => '/vuon-xanh',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('@/lib/core-http', () => ({
  coreHttp: {
    get: async (path: string) => {
      state.calls.push({ method: 'get', path });
      const left = state.fail.get(path) ?? 0;
      if (left > 0) {
        state.fail.set(path, left - 1);
        throw new Error('mất mạng');
      }
      if (path === '/config/public') return state.config;
      if (path in state.data) return state.data[path];
      throw new Error(`chưa mock ${path}`);
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'post', path, body });
      await state.hold.get(path);
      const h = state.posts[path];
      if (!h) throw new Error(`chưa mock POST ${path}`);
      return h();
    },
  },
}));

import GamePage from './page';

const HOME = { id: null, slot: 1, isHome: true, treeType: 'Sồi', speciesId: null, progress: 10, target: 50, treeStage: 1, treesPlanted: 3, treeHealth: 'HEALTHY' };
const plot = (n: number, over: Record<string, unknown> = {}) => ({
  id: `p${n}`, slot: n, isHome: false, treeType: 'Mận', speciesId: null, progress: 5, target: 20, treeStage: 1, treesPlanted: 2, treeHealth: 'HEALTHY', ...over,
});
const GARDEN = (over: Record<string, unknown> = {}) => ({ plots: [HOME, plot(2), plot(3)], maxPlots: 5, nextUnlock: { slot: 4, seedCost: 1_200 }, ...over });
const CODEX = [
  { id: 'c1', name: 'Sưa đỏ', rarity: 'LEGENDARY', emoji: '🌳', region: null, owned: true, count: 3, story: null, ecoFact: null },
  { id: 'c2', name: 'Mận', rarity: 'COMMON', emoji: '🌸', region: null, owned: true, count: 1, story: null, ecoFact: null },
  { id: 'c3', name: 'Lim xanh', rarity: 'RARE', emoji: '🌲', region: null, owned: false, count: 0, story: null, ecoFact: null },
];
const FRIENDS = [
  { id: 'f1', nickname: 'Lan', giftedToday: false },
  { id: 'f2', nickname: 'Minh', giftedToday: true },
  { id: 'f3', nickname: 'Hà', giftedToday: false },
];
const COMMUNITY = {
  goal: { id: 'g1', title: 'Rừng Tubu', region: 'Hà Giang', targetDrops: 5_000_000, currentDrops: 1_250_000, treesToPlant: 100, status: 'ACTIVE' },
  myDrops: 89_000,
  pct: 25,
};
const BOARD = [
  { rank: 1, nickname: 'Nhất', streak: 30, treesPlanted: 9 },
  { rank: 2, nickname: 'Nhì', streak: 20, treesPlanted: 7 },
  { rank: 3, nickname: 'Ba', streak: 15, treesPlanted: 5 },
  { rank: 4, nickname: 'Tư', streak: 9, treesPlanted: 2 },
];
const SEASON_BOARD = [1, 2, 3, 4].map((rank) => ({ rank, nickname: `Bạn ${rank}`, drops: 2_000 - rank }));
const PASS = {
  active: true,
  seasonTitle: 'Xuân',
  xp: 150,
  premiumEligible: false,
  tiers: [0, 1].map((tier) => ({
    tier, xpRequired: 100 * (tier + 1), free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 20 }, unlocked: tier === 0, claimedFree: false, claimedPremium: false,
  })),
};
const profile = () => ({
  totalSeeds: 1_250, streakDays: 3, treeStage: 1, treeHealth: 'HEALTHY', streakFreezes: 1, lastDewAt: null, lastCheckInAt: new Date().toISOString(),
  ecoImpact: { progress: 600, target: 1_000, treeType: 'Cây Sưa', treesPlanted: 2 }, streakFreezeCost: 80, treePointsPrice: 20_000, spinCostPoints: 10,
});

let mounted: Rendered[] = [];
const mount = async (search = '') => {
  state.search = search;
  const r = render(<GamePage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const postsOf = (path: string) => state.calls.filter((c) => c.method === 'post' && c.path === path);
const getsOf = (path: string) => state.calls.filter((c) => c.method === 'get' && c.path === path);
const btn = (c: HTMLElement, text: string | RegExp) => byText(c, 'button', text) as HTMLButtonElement;
const panel = (c: HTMLElement, label: string) => c.querySelector<HTMLElement>(`[role="tabpanel"][aria-label="${label}"]`)!;
const card = (c: HTMLElement, title: string | RegExp) =>
  Array.from(c.querySelectorAll('h2')).find((h) => (typeof title === 'string' ? h.textContent === title : title.test(h.textContent ?? '')))?.parentElement ?? null;

beforeEach(() => {
  state.search = '';
  state.ready = new Set();
  state.seasonPass = false;
  state.config = { waste: { enabled: false } };
  state.calls = [];
  state.fail = new Map();
  state.hold = new Map();
  state.replace.mockReset();
  state.push.mockReset();
  state.data = {
    '/game/profile': profile(),
    '/game/quiz/today': [],
    '/game/missions': [],
    '/game/forest': { count: 0, plantedCount: 0, trees: [] },
    '/game/season': null,
    '/game/garden': GARDEN(),
    '/game/collection': CODEX,
    '/game/friends': FRIENDS,
    '/game/community': COMMUNITY,
    '/game/leaderboard': BOARD,
    '/game/season/leaderboard': SEASON_BOARD,
  };
  state.posts = {};
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('Vườn Xanh: tab Vườn', () => {
  it('lô đất, sổ tay và tác động xanh nằm ở tab Vườn; tặng nước, mục tiêu và xếp hạng ở tab Cộng đồng', async () => {
    const c = await mount('tab=garden');
    const garden = panel(c, 'Vườn');
    expect(garden.textContent).toContain('Lô đất của bạn (3/5)');
    expect(garden.textContent).toContain('Sổ tay loài cây (2/3)');
    expect(garden.textContent).toContain('Tác động xanh của bạn');
    expect(garden.textContent).toContain('Mục tiêu cộng đồng');
    expect(garden.textContent).not.toContain('Tặng nước cho bạn bè');
    expect(panel(c, 'Hôm nay').textContent).not.toContain('Lô đất');
    const community = panel(await mount('tab=community'), 'Cộng đồng');
    for (const t of ['Tặng nước cho bạn bè', 'Chuỗi điểm danh dài nhất', 'Xếp hạng góp nước mùa này']) {
      expect(community.textContent).toContain(t);
    }
  });

  it('chưa tải được garden: không có khối lô đất', async () => {
    delete state.data['/game/garden'];
    const c = await mount('tab=garden');
    expect(c.textContent).not.toContain('Lô đất của bạn');
  });

  it('chỉ liệt kê lô không phải lô nhà; chưa có lô thì có lời gợi ý', async () => {
    const c = await mount('tab=garden');
    expect(c.textContent).toContain('Lô 2 · Mận');
    expect(c.textContent).toContain('Lô 3 · Mận');
    expect(c.textContent).not.toContain('Lô 1');
    expect(c.textContent).not.toContain('Mở thêm lô đất để trồng nhiều cây');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/game/garden'] = GARDEN({ plots: [HOME] });
    const c2 = await mount('tab=garden');
    expect(c2.textContent).toContain('Mở thêm lô đất để trồng nhiều cây cùng lúc');
  });

  it('mỗi lô: tiến độ có dấu nghìn, héo có nhãn (lô DEAD cũ cũng chỉ héo), giai đoạn cây theo phần trăm', async () => {
    state.data['/game/garden'] = GARDEN({
      plots: [HOME, plot(2, { progress: 1_250, target: 2_500, treeHealth: 'WILTED' }), plot(3, { progress: 20, target: 20, treeHealth: 'DEAD' }), plot(4, { progress: 2, target: 20 })],
    });
    const c = await mount('tab=garden');
    const plots = panel(c, 'Vườn');
    expect(plots.textContent).toContain('1.250/2.500💧');
    expect(plots.textContent).toContain('héo');
    expect(plots.textContent).not.toContain('chết');
    expect(plots.textContent).toContain('🌿');
    expect(plots.textContent).toContain('🌳');
    expect(plots.textContent).toContain('🌱');
  });

  it('Tưới lô gọi POST đúng lô với {drops:20}; chạm đúp cùng lô chỉ gọi một lần; lô khác gọi song song', async () => {
    let release!: () => void;
    state.hold.set('/game/garden/plot/p2/water', new Promise<void>((r) => (release = r)));
    state.posts['/game/garden/plot/p2/water'] = () => ({ progress: 6, target: 20, harvested: false, treesPlanted: 2, revivedFromDead: false });
    state.posts['/game/garden/plot/p3/water'] = () => ({ progress: 6, target: 20, harvested: false, treesPlanted: 2, revivedFromDead: false });
    const c = await mount('tab=garden');
    const waters = Array.from(panel(c, 'Vườn').querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.includes('Tưới'));
    expect(waters).toHaveLength(2);
    click(waters[0]!);
    click(waters[0]!);
    await flush();
    expect(waters[0]!.disabled).toBe(true);
    expect(waters[1]!.disabled).toBe(false);
    click(waters[1]!);
    await flush();
    release();
    await flush(8);
    expect(postsOf('/game/garden/plot/p2/water')).toHaveLength(1);
    expect(postsOf('/game/garden/plot/p2/water')[0]!.body).toEqual({ drops: 20 });
    expect(postsOf('/game/garden/plot/p3/water')).toHaveLength(1);
    expect(document.body.textContent).toContain('Đã tưới lô −20💧 · còn 14💧 nữa là thu hoạch');
  });

  it('tưới lô lỗi: báo lỗi và nhả khoá, bấm lại gọi lần hai', async () => {
    state.posts['/game/garden/plot/p2/water'] = () => {
      throw new Error('Cây đã chết');
    };
    const c = await mount('tab=garden');
    const w = () => Array.from(panel(c, 'Vườn').querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Tưới'))!;
    click(w());
    await flush(6);
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Cây đã chết');
    click(w());
    await flush(6);
    expect(postsOf('/game/garden/plot/p2/water')).toHaveLength(2);
  });

  it('tưới lô đến mức thu hoạch: mở hộp chúc mừng, làm mới garden và rừng', async () => {
    state.posts['/game/garden/plot/p2/water'] = () => ({
      progress: 20, target: 20, harvested: true, treesPlanted: 3, revivedFromDead: false,
      reward: { certificate: 'TT-9', species: { id: 's', name: 'Sao đen', emoji: '🌴', rarity: 'RARE', ecoFact: 'Cây sao đen sống hàng trăm năm.' } },
    });
    const c = await mount('tab=garden');
    const before = getsOf('/game/garden').length;
    click(Array.from(panel(c, 'Vườn').querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Tưới'))!);
    await flush(8);
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.textContent).toContain('Thu hoạch thành công!');
    expect(dlg.textContent).toContain('TT-9');
    expect(dlg.textContent).toContain('💎 Hiếm · Sưu tập mới!');
    expect(dlg.textContent).toContain('Sao đen');
    expect(getsOf('/game/garden').length).toBeGreaterThan(before);
  });

  it('mở lô: nút kèm giá giọt nước, POST {currency:"SEEDS", slot} một lần dù chạm đúp, báo và làm mới', async () => {
    let release!: () => void;
    state.hold.set('/game/garden/unlock', new Promise<void>((r) => (release = r)));
    state.posts['/game/garden/unlock'] = () => plot(4);
    const c = await mount('tab=garden');
    const b = btn(panel(c, 'Vườn'), 'Mở lô');
    expect(b.textContent).toContain('1.200💧');
    click(b);
    click(b);
    await flush();
    expect(b.disabled).toBe(true);
    release();
    await flush(8);
    expect(postsOf('/game/garden/unlock')).toHaveLength(1);
    expect(postsOf('/game/garden/unlock')[0]!.body).toEqual({ currency: 'SEEDS', slot: 4 });
    expect(document.body.textContent).toContain('Đã mở lô đất mới 🪴');
    expect(getsOf('/game/garden').length).toBeGreaterThan(1);
  });

  it('mở lô lỗi (danh sách lô đã đổi): báo lỗi, nút mở lại được, body vẫn {currency, slot}', async () => {
    state.posts['/game/garden/unlock'] = () => {
      throw new Error('Danh sách lô đất đã thay đổi, hãy tải lại trang.');
    };
    const c = await mount('tab=garden');
    const b = btn(panel(c, 'Vườn'), 'Mở lô');
    click(b);
    await flush(8);
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Danh sách lô đất đã thay đổi, hãy tải lại trang.');
    expect(b.disabled).toBe(false);
    expect(postsOf('/game/garden/unlock')).toHaveLength(1);
    expect(postsOf('/game/garden/unlock')[0]!.body).toEqual({ currency: 'SEEDS', slot: 4 });
  });

  it('đã đủ lô: không còn nút mở, hiện thông báo tối đa', async () => {
    state.data['/game/garden'] = GARDEN({ nextUnlock: null });
    const c = await mount('tab=garden');
    expect(byText(panel(c, 'Vườn'), 'button', 'Mở lô')).toBeNull();
    expect(c.textContent).toContain('Bạn đã mở tối đa số lô đất');
  });

  it('sổ tay: đếm loài đã có, loài chưa có hiện ???, loài trùng hiện ×N; trống thì ẩn khối', async () => {
    const c = await mount('tab=garden');
    const codex = card(c, /Sổ tay loài cây/)!;
    expect(codex.textContent).toContain('Sưa đỏ');
    expect(codex.textContent).toContain('×3');
    expect(codex.textContent).not.toContain('×1');
    expect(codex.textContent).toContain('???');
    expect(codex.textContent).not.toContain('Lim xanh');
    expect(codex.textContent).toContain('Thu hoạch cây để sưu tập đủ loài cây Việt Nam');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/game/collection'] = [];
    const c2 = await mount('tab=garden');
    expect(c2.textContent).not.toContain('Sổ tay loài cây');
  });
});

describe('Vườn Xanh: tab Cộng đồng', () => {
  it('mục tiêu cộng đồng (đặt ở tab Vườn như Mini App): số có dấu nghìn, phần trăm, phần bạn đã góp; chỉ hiện khi có mục tiêu', async () => {
    const c = await mount('tab=garden');
    const g = card(c, 'Mục tiêu cộng đồng')!;
    expect(g.textContent).toContain('Rừng Tubu');
    expect(g.textContent).toContain('Hà Giang · mục tiêu góp quỹ trồng 100 cây');
    expect(g.textContent).toContain('1.250.000/5.000.000💧 (25%)');
    expect(g.textContent).toContain('Bạn đã góp 89.000💧');
    expect(g.querySelector('[role="progressbar"]')).not.toBeNull();
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/game/community'] = { goal: null, myDrops: 0, pct: 0 };
    const c2 = await mount('tab=garden');
    expect(c2.textContent).not.toContain('Mục tiêu cộng đồng');
  });

  it('tặng nước: khoá nút của bạn đã tặng hôm nay hoặc đang gửi, gọi đúng id, mỗi bạn một lần', async () => {
    let release!: () => void;
    state.hold.set('/game/gift/f1', new Promise<void>((r) => (release = r)));
    state.posts['/game/gift/f1'] = () => ({ amount: 5, recipientId: 'f1' });
    state.posts['/game/gift/f3'] = () => ({ amount: 5, recipientId: 'f3' });
    const c = await mount('tab=community');
    const gifts = card(c, 'Tặng nước cho bạn bè')!;
    const buttons = Array.from(gifts.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Tặng 💧', 'Đã tặng hôm nay', 'Tặng 💧']);
    expect(buttons[1]!.disabled).toBe(true);
    click(buttons[0]!);
    click(buttons[0]!);
    await flush();
    expect(buttons[0]!.disabled).toBe(true);
    expect(buttons[2]!.disabled).toBe(false);
    click(buttons[2]!);
    await flush();
    release();
    await flush(8);
    expect(postsOf('/game/gift/f1')).toHaveLength(1);
    expect(postsOf('/game/gift/f3')).toHaveLength(1);
    expect(document.body.textContent).toContain('Đã tặng 5💧 cho bạn 🎁');
  });

  it('không có bạn bè: ẩn khối tặng nước', async () => {
    state.data['/game/friends'] = [];
    const c = await mount('tab=community');
    expect(c.textContent).not.toContain('Tặng nước cho bạn bè');
  });

  it('tặng nước lỗi: báo lỗi, nút bật lại', async () => {
    state.posts['/game/gift/f1'] = () => {
      throw new Error('Đã tặng rồi');
    };
    const c = await mount('tab=community');
    const b = card(c, 'Tặng nước cho bạn bè')!.querySelector<HTMLButtonElement>('button')!;
    click(b);
    await flush(6);
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('Đã tặng rồi');
    expect(b.disabled).toBe(false);
  });

  it('chuỗi điểm danh dài nhất: bục xếp 2-1-3 với số ngày chuỗi, hạng 4+ kèm chuỗi và cây', async () => {
    const c = await mount('tab=community');
    const w = card(c, 'Chuỗi điểm danh dài nhất')!;
    const podium = Array.from(w.querySelectorAll('[data-podium] [data-slot]')).map((e) => e.textContent);
    expect(podium).toEqual(['🥈Nhì🔥20', '🥇Nhất🔥30', '🥉Ba🔥15']);
    expect(w.textContent).toContain('#4 Tư');
    expect(w.textContent).toContain('🔥9 · 🌳2');
  });

  it('bảng chuỗi chỉ có 2 người: ô thứ 3 để trống và không trùng khoá', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.data['/game/leaderboard'] = BOARD.slice(0, 2);
    const c = await mount('tab=community');
    const podium = Array.from(card(c, 'Chuỗi điểm danh dài nhất')!.querySelectorAll('[data-podium] [data-slot]')).map((e) => e.textContent);
    expect(podium).toEqual(['🥈Nhì🔥20', '🥇Nhất🔥30', '']);
    expect(errors.mock.calls.filter((a) => /same key|unique "key"/.test(String(a[0])))).toEqual([]);
    errors.mockRestore();
  });

  it('bảng chuỗi trống: "Chưa có dữ liệu xếp hạng."', async () => {
    state.data['/game/leaderboard'] = [];
    const c = await mount('tab=community');
    expect(card(c, 'Chuỗi điểm danh dài nhất')!.textContent).toContain('Chưa có ai trên bảng.');
  });

  it('top góp nước mùa này: huy chương top 3, #hạng từ 4; không có dữ liệu thì ẩn khối', async () => {
    const c = await mount('tab=community');
    const s = card(c, 'Xếp hạng góp nước mùa này')!;
    expect(s.textContent).toContain('🥇 Bạn 1');
    expect(s.textContent).toContain('🥉 Bạn 3');
    expect(s.textContent).toContain('#4 Bạn 4');
    expect(s.textContent).toContain('1.999💧');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/game/season/leaderboard'] = [];
    const c2 = await mount('tab=community');
    expect(c2.textContent).not.toContain('Xếp hạng góp nước mùa này');
  });

  it('Bảng tin cộng đồng: chỉ hiện khi trang /cong-dong đã có trên web', async () => {
    const c = await mount('tab=community');
    expect(c.textContent).not.toContain('Bảng tin cộng đồng');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.ready = new Set(['/cong-dong']);
    const c2 = await mount('tab=community');
    const link = c2.querySelector<HTMLAnchorElement>('a[href="/cong-dong"]')!;
    expect(link.textContent).toContain('Bảng tin cộng đồng');
    expect(link.textContent).toContain('Khoe thành tích xanh & cổ vũ nhau trồng cây');
  });
});

describe('Vườn Xanh: Chặng Mùa theo SEASON_PASS_ENABLED', () => {
  it('cờ tắt: không gọi API season-pass và không dựng khối dù server trả mùa đang chạy', async () => {
    state.data['/game/season-pass'] = PASS;
    const c = await mount('tab=community');
    expect(getsOf('/game/season-pass')).toHaveLength(0);
    expect(c.textContent).not.toContain('Chặng Mùa');
  });

  it('cờ bật: hiện điểm kinh nghiệm, gợi ý Cao cấp, bậc đã mở nhận được, Cao cấp và bậc khoá đều tắt', async () => {
    state.seasonPass = true;
    state.data['/game/season-pass'] = PASS;
    const c = await mount('tab=community');
    const p = card(c, 'Chặng Mùa')!;
    expect(p.textContent).toContain('Điểm danh mỗi ngày để lên bậc mùa "Xuân"');
    expect(p.textContent).toContain('150 điểm kinh nghiệm');
    expect(p.textContent).toContain('200 điểm kinh nghiệm');
    expect(p.textContent).toContain('Cao cấp');
    expect(p.textContent).toContain('Cần đăng ký định kỳ để mở phần thưởng Cao cấp.');
    const buttons = Array.from(p.querySelectorAll<HTMLButtonElement>('button'));
    expect(buttons.map((b) => [b.textContent, b.disabled])).toEqual([
      ['Nhận', false],
      ['Chưa mở', true],
      ['Chưa mở', true],
      ['Chưa mở', true],
    ]);
  });

  it('cờ bật, không có mùa đang chạy hoặc không có bậc: ẩn khối', async () => {
    state.seasonPass = true;
    state.data['/game/season-pass'] = { active: false };
    const c = await mount('tab=community');
    expect(c.textContent).not.toContain('Chặng Mùa');
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.data['/game/season-pass'] = { active: true, tiers: [] };
    const c2 = await mount('tab=community');
    expect(c2.textContent).not.toContain('Chặng Mùa');
  });

  it('nhận nhánh miễn phí: POST {tier, track} một lần dù chạm đúp, báo, làm mới mùa/hồ sơ/Điểm Xanh', async () => {
    state.seasonPass = true;
    state.data['/game/season-pass'] = PASS;
    state.posts['/game/season-pass/claim'] = () => ({ claimed: true, reward: { type: 'SEEDS', amount: 10 } });
    const c = await mount('tab=community');
    const b = btn(card(c, 'Chặng Mùa')!, 'Nhận');
    click(b);
    click(b);
    await flush(8);
    expect(postsOf('/game/season-pass/claim')).toHaveLength(1);
    expect(postsOf('/game/season-pass/claim')[0]!.body).toEqual({ tier: 0, track: 'free' });
    expect(document.body.textContent).toContain('Đã nhận thưởng chặng mùa! 🎉');
    expect(getsOf('/game/season-pass').length).toBeGreaterThan(1);
  });

  it('đủ điều kiện Premium nhận được nhánh Premium; phần đã nhận hiện "Đã nhận" thay cho nút', async () => {
    state.seasonPass = true;
    state.data['/game/season-pass'] = {
      ...PASS,
      premiumEligible: true,
      tiers: [{ ...PASS.tiers[0]!, claimedFree: true }, PASS.tiers[1]!],
    };
    state.posts['/game/season-pass/claim'] = () => ({ claimed: true, reward: { type: 'POINTS', amount: 20 } });
    const c = await mount('tab=community');
    const p = card(c, 'Chặng Mùa')!;
    expect(p.textContent).toContain('Đã nhận');
    expect(p.textContent).toContain('20 điểm');
    click(btn(p, 'Nhận'));
    await flush(8);
    expect(postsOf('/game/season-pass/claim')[0]!.body).toEqual({ tier: 0, track: 'premium' });
  });
});

describe('Vườn Xanh: hộp thu hoạch', () => {
  const harvest = {
    progress: 50, target: 50, harvested: true, treesPlanted: 4,
    reward: { coupon: 'XANH-123', certificate: 'TT-77', species: { id: 's', name: 'Sao đen', emoji: '🌴', rarity: 'LEGENDARY', ecoFact: 'Sống hàng trăm năm.' } },
  };
  const water = async (c: HTMLElement) => {
    click(btn(c, /Tưới hết/));
    await flush(8);
  };

  it('tưới cây tới mức thu hoạch: hộp chúc mừng có mã giảm giá, mã đóng góp, loài mới; không báo tiến độ', async () => {
    state.posts['/game/tree/water'] = () => harvest;
    const c = await mount();
    await water(c);
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.textContent).toContain('Thu hoạch thành công!');
    expect(dlg.textContent).toContain('Tubu sẽ góp 1 cây vào quỹ trồng cây');
    expect(dlg.textContent).toContain('XANH-123');
    expect(dlg.textContent).toContain('TT-77');
    expect(dlg.textContent).toContain('🌟 Huyền thoại · Sưu tập mới!');
    expect(dlg.textContent).toContain('🌴 Sao đen');
    expect(dlg.textContent).toContain('Sống hàng trăm năm.');
    expect(c.querySelector('[role="status"]')).toBeNull();
  });

  it('"Chia sẻ lên Cộng đồng": gọi /game/harvest/share một lần, báo đã chia sẻ và khoá nút', async () => {
    state.posts['/game/tree/water'] = () => harvest;
    state.posts['/game/harvest/share'] = () => ({ shared: true, alreadyShared: false });
    const c = await mount();
    await water(c);
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    const share = btn(dlg, 'Chia sẻ lên Cộng đồng');
    act(() => {
      share.click();
      share.click();
    });
    await flush(8);
    expect(postsOf('/game/harvest/share')).toHaveLength(1);
    expect(btn(dlg, 'Đã chia sẻ').disabled).toBe(true);
    expect(document.body.textContent).toContain('Đã chia sẻ lên Cộng đồng');
  });

  it('nút chia sẻ có dòng báo bài sẽ hiện tên khách', async () => {
    state.posts['/game/tree/water'] = () => harvest;
    const c = await mount();
    await water(c);
    expect((document.querySelector('[role="dialog"]') as HTMLElement).textContent).toContain('Bài sẽ hiện tên của bạn trên Cộng đồng');
  });

  it('API báo alreadyShared: thông báo "Bạn đã chia sẻ cây này rồi"', async () => {
    state.posts['/game/tree/water'] = () => harvest;
    state.posts['/game/harvest/share'] = () => ({ shared: true, alreadyShared: true });
    const c = await mount();
    await water(c);
    click(btn(document.querySelector('[role="dialog"]') as HTMLElement, 'Chia sẻ lên Cộng đồng'));
    await flush(8);
    expect(document.body.textContent).toContain('Bạn đã chia sẻ cây này rồi');
    expect(document.body.textContent).not.toContain('Đã chia sẻ lên Cộng đồng');
  });

  it('thu hoạch ở lô phụ: hộp chúc mừng không có nút chia sẻ', async () => {
    state.data['/game/garden'] = GARDEN();
    state.posts['/game/garden/plot/p2/water'] = () => ({ progress: 0, target: 20, harvested: true, treesPlanted: 2, revivedFromDead: false, reward: { certificate: 'TT-9' } });
    const c = await mount('tab=garden');
    const waters = Array.from(panel(c, 'Vườn').querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.includes('Tưới'));
    click(waters[0]!);
    await flush(8);
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.textContent).toContain('Thu hoạch thành công!');
    expect(dlg.textContent).not.toContain('Chia sẻ lên Cộng đồng');
  });

  it('khách vãng lai: hộp thu hoạch không có nút chia sẻ', async () => {
    state.posts['/game/tree/water'] = () => ({ progress: 50, target: 50, harvested: true, treesPlanted: 1, rewardBlocked: 'GUEST' });
    const c = await mount();
    await water(c);
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dlg.textContent).not.toContain('Chia sẻ lên Cộng đồng');
  });

  it('thu hoạch không có quà: không có mã, không có "Dùng mã giảm giá ngay"; "Tuyệt vời!" đóng hộp', async () => {
    state.posts['/game/tree/water'] = () => ({ progress: 50, target: 50, harvested: true, treesPlanted: 4 });
    const c = await mount();
    await water(c);
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.textContent).not.toContain('Dùng mã giảm giá ngay');
    expect(dlg.textContent).not.toContain('Mã đóng góp quỹ trồng cây');
    click(btn(dlg as HTMLElement, 'Tuyệt vời!'));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('chạm mã giảm giá để chép (thành công và thất bại); "Dùng mã giảm giá ngay" đóng hộp và sang /san-pham', async () => {
    state.posts['/game/tree/water'] = () => harvest;
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('chặn'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const c = await mount();
    await water(c);
    const dlg = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
    const code = () => dlg().querySelector<HTMLElement>('[data-coupon]')!;
    click(code());
    await flush();
    expect(writeText).toHaveBeenCalledWith('XANH-123');
    expect(document.querySelector('[role="status"]')!.textContent).toBe('Đã sao chép mã giảm giá');
    click(code());
    await flush();
    expect(document.body.textContent).toContain('Không sao chép được — mã của bạn: XANH-123');
    click(btn(dlg(), 'Dùng mã giảm giá ngay'));
    await flush();
    expect(state.push).toHaveBeenCalledWith('/san-pham', 'XANH-123');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('ô mã giảm giá là nút thật (bàn phím chép được như chạm)', async () => {
    state.posts['/game/tree/water'] = () => harvest;
    const c = await mount();
    await water(c);
    const code = document.querySelector<HTMLElement>('[role="dialog"] [data-coupon]')!;
    expect(code.tagName).toBe('BUTTON');
    expect(code.textContent).toContain('XANH-123');
  });
});

describe('Vườn Xanh: bố cục tab Vườn và Cộng đồng', () => {
  it('đổi tab không dựng lại khối và mỗi khối có h2 thật; heading, nút có tên, vùng chạm đủ lớn ở cả hai tab', async () => {
    state.seasonPass = true;
    state.data['/game/season-pass'] = PASS;
    state.ready = new Set(['/cong-dong']);
    const c = await mount('tab=community');
    const tabs = Array.from(c.querySelectorAll('[role="tab"]'));
    click(tabs[1] as HTMLElement);
    await flush();
    expect(state.replace).toHaveBeenCalledWith('/vuon-xanh?tab=garden', { scroll: false });
    for (const label of ['Vườn', 'Cộng đồng']) {
      for (const h of Array.from(panel(c, label).querySelectorAll('h2'))) expect(h.textContent!.length).toBeGreaterThan(0);
    }
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

describe('Vườn Xanh: hộp thu hoạch khi trình duyệt không có clipboard', () => {
  it('navigator.clipboard không có: không ném lỗi, báo mã để khách tự chép', async () => {
    state.data['/game/profile'] = profile();
    state.posts['/game/tree/water'] = () => ({
      progress: 50, target: 50, harvested: true, treesPlanted: 4,
      reward: { coupon: 'XANH-123', certificate: 'TT-77' },
    });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const c = await mount();
    click(btn(c, /Tưới hết/));
    await flush(8);
    click(document.querySelector<HTMLElement>('[role="dialog"] [data-coupon]'));
    await flush();
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Không sao chép được — mã của bạn: XANH-123');
  });
});

describe('Vườn Xanh: làm mới Điểm Xanh ở tab Vườn và Cộng đồng', () => {
  let spy: MockInstance<QueryClient['invalidateQueries']>;
  const keys = () => spy.mock.calls.map((a) => JSON.stringify(a[0]?.queryKey));
  afterEach(() => spy?.mockRestore());

  it('mở lô làm mới game, me và loyalty', async () => {
    state.posts['/game/garden/unlock'] = () => plot(4);
    const c = await mount('tab=garden');
    spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    click(btn(panel(c, 'Vườn'), 'Mở lô'));
    await flush(8);
    expect(keys()).toEqual(expect.arrayContaining(['["game"]', '["me"]', '["loyalty"]']));
  });

  it('nhận thưởng chặng mùa làm mới loyalty', async () => {
    state.seasonPass = true;
    state.data['/game/season-pass'] = PASS;
    state.posts['/game/season-pass/claim'] = () => ({ claimed: true, reward: { type: 'POINTS', amount: 20 } });
    const c = await mount('tab=community');
    spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    click(btn(card(c, 'Chặng Mùa')!, 'Nhận'));
    await flush(8);
    expect(keys()).toEqual(expect.arrayContaining(['["game","seasonPass"]', '["loyalty"]']));
  });
});
