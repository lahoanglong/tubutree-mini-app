// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameMoreCopy } from '@tubutree/app-core/game-more-copy';
import { gameNewbieCopy } from '@tubutree/app-core/game-newbie';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { NetworkError } from '@/lib/client-api';

/**
 * Khoá chạm đúp của trang Vườn Xanh. Mọi ca "cùng khung hình" dồn hai lần `click()` vào MỘT `act`: React chưa dựng lại giữa hai lần,
 * nên `disabled={isPending}` vẫn thấy nút rảnh và chỉ khoá đồng bộ (ref) mới chặn được lần gọi API thứ hai.
 */
type Call = { method: string; path: string; body?: unknown };

const state = vi.hoisted(() => ({
  search: '' as string,
  seasonPass: false,
  usingCode: null as string | null,
  data: {} as Record<string, unknown>,
  fail: new Map<string, number>(),
  posts: {} as Record<string, () => unknown>,
  getHold: new Map<string, Promise<unknown>>(),
  postHold: new Map<string, Promise<unknown>>(),
  calls: [] as Call[],
  push: vi.fn(),
  replace: vi.fn(),
  use: vi.fn(),
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'authenticated' }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: vi.fn() }) }));
vi.mock('@/lib/use-coupon-use', () => ({
  useCouponUse: () => ({ notice: null, copy: vi.fn(), cancel: vi.fn(), use: state.use, usingCode: state.usingCode }),
}));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => 'key-1' }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => false }));
vi.mock('@tubutree/app-core/features', () => ({
  get SEASON_PASS_ENABLED() {
    return state.seasonPass;
  },
  CASHBACK_ENABLED: false,
  GAME_SOCIAL_ON_WEB: true,
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
      await state.getHold.get(path);
      if (path === '/config/public') return { waste: { enabled: false } };
      if (!(path in state.data)) throw new Error(`chưa mock ${path}`);
      const v = state.data[path];
      return typeof v === 'function' ? (v as () => unknown)() : v;
    },
    post: async (path: string, body?: unknown) => {
      state.calls.push({ method: 'post', path, body });
      await state.postHold.get(path);
      const h = state.posts[path];
      if (!h) throw new Error(`chưa mock POST ${path}`);
      return h();
    },
  },
}));

import GamePage from './page';

const NOW = () => new Date().toISOString();
const profile = (over: Record<string, unknown> = {}) => ({
  totalSeeds: 1_250,
  streakDays: 3,
  treeStage: 1,
  treeHealth: 'HEALTHY',
  streakFreezes: 1,
  lastDewAt: null,
  lastCheckInAt: NOW(),
  ecoImpact: { progress: 600, target: 1_000, treeType: 'Cây Sưa', treesPlanted: 2 },
  streakFreezeCost: 80,
  treePointsPrice: 20_000,
  spinCostPoints: 10,
  ...over,
});
const HOME = { id: null, slot: 1, isHome: true, treeType: 'Sồi', speciesId: null, progress: 10, target: 50, treeStage: 1, treesPlanted: 3, treeHealth: 'HEALTHY' };
const plot = (n: number) => ({ id: `p${n}`, slot: n, isHome: false, treeType: 'Mận', speciesId: null, progress: 5, target: 20, treeStage: 1, treesPlanted: 2, treeHealth: 'HEALTHY' });
const GARDEN = { plots: [HOME, plot(2), plot(3)], maxPlots: 5, nextUnlock: { slot: 4, seedCost: 1_200 } };
const FRIENDS = [
  { id: 'f1', nickname: 'Lan', giftedToday: false },
  { id: 'f3', nickname: 'Hà', giftedToday: false },
];
const MISSIONS = [{ code: 'REVIEW_3', title: 'Đánh giá 3 sản phẩm', rewardPoints: 30, progress: 3, goal: 3, completed: true, claimed: false }];
const PASS = {
  active: true,
  seasonTitle: 'Xuân',
  xp: 150,
  premiumEligible: false,
  tiers: [{ tier: 0, xpRequired: 100, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 20 }, unlocked: true, claimedFree: false, claimedPremium: false }],
};
const WATERED = { progress: 620, target: 1_000, harvested: false, treesPlanted: 2 };

const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

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
const btn = (c: ParentNode, text: string | RegExp) => byText(c, 'button', text) as HTMLButtonElement;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const toastAlert = () => Array.from(document.querySelectorAll<HTMLElement>('[role="alert"]')).at(-1)!;
const panel = (c: HTMLElement, label: string) => c.querySelector<HTMLElement>(`[role="tabpanel"][aria-label="${label}"]`)!;
/** Mọi cú chạm nằm trong cùng một lô cập nhật của React. */
const tapTogether = async (...targets: HTMLElement[]) => {
  await act(async () => {
    for (const t of targets) t.click();
  });
};
const expectBusy = (b: HTMLElement) => {
  expect(b.getAttribute('aria-busy')).toBe('true');
  expect(b.getAttribute('aria-disabled')).toBe('true');
  // Nút đang giữ focus mà `disabled` thật thì Chromium thả focus về body.
  expect((b as HTMLButtonElement).disabled).toBe(false);
};
const expectIdle = (b: HTMLElement) => {
  expect(b.getAttribute('aria-busy')).toBeNull();
  expect(b.getAttribute('aria-disabled')).toBeNull();
};

beforeEach(() => {
  state.search = '';
  state.seasonPass = false;
  state.usingCode = null;
  state.calls = [];
  state.fail = new Map();
  state.getHold = new Map();
  state.postHold = new Map();
  state.push.mockReset();
  state.replace.mockReset();
  state.use.mockReset();
  state.posts = {};
  state.data = {
    '/game/profile': () => profile(),
    '/game/quiz/today': [],
    '/game/missions': [],
    '/game/forest': { count: 0, plantedCount: 0, trees: [] },
    '/game/season': null,
    '/game/garden': GARDEN,
    '/game/collection': [],
    '/game/friends': FRIENDS,
    '/game/community': { goal: null, myDrops: 0, pct: 0 },
    '/game/leaderboard': [],
    '/game/season/leaderboard': [],
    '/game/season-pass': PASS,
  };
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('Vườn Xanh: nút chính trên cây', () => {
  it('tưới hết: hai cú chạm cùng khung hình chỉ POST một lần; nút báo bận bằng aria, không disabled', async () => {
    state.posts['/game/tree/water'] = () => WATERED;
    const g = gate();
    state.postHold.set('/game/tree/water', g.p);
    const c = await mount();
    const b = btn(c, /Tưới hết/);
    await tapTogether(b, b);
    await flush();
    expectBusy(b);
    expect(postsOf('/game/tree/water')).toHaveLength(1);
    g.open();
    await flush(8);
    expect(postsOf('/game/tree/water')).toHaveLength(1);
    expectIdle(btn(c, /Tưới hết/));
  });

  it('tưới: khoá giữ tới khi hồ sơ mới về; chạm lúc số nước còn là số cũ không gọi API lần hai', async () => {
    let seeds = 1_250;
    state.data['/game/profile'] = () => profile({ totalSeeds: seeds });
    state.posts['/game/tree/water'] = () => {
      seeds = 0;
      return WATERED;
    };
    const c = await mount();
    const b = btn(c, /Tưới hết/);
    const fresh = gate();
    state.getHold.set('/game/profile', fresh.p);
    click(b);
    await flush(8);
    expect(postsOf('/game/tree/water')).toHaveLength(1);
    // POST đã xong nhưng hồ sơ mới chưa về: nút vẫn bận và vẫn nói "Tưới hết".
    expectBusy(b);
    click(b);
    await flush();
    expect(postsOf('/game/tree/water')).toHaveLength(1);
    fresh.open();
    await flush(8);
    expect(getsOf('/game/profile').length).toBeGreaterThan(1);
    expect(byText(c, 'button', /Tưới hết/)).toBeNull();
    expectIdle(btn(c, gameNewbieCopy.primary.earn));
  });

  it('tưới lỗi: báo role="alert", nhả khoá, bấm lại gọi API lần hai', async () => {
    let fail = true;
    state.posts['/game/tree/water'] = () => {
      if (fail) throw new Error('Không đủ giọt nước');
      return WATERED;
    };
    const c = await mount();
    const b = btn(c, /Tưới hết/);
    await tapTogether(b, b);
    await flush(8);
    expect(postsOf('/game/tree/water')).toHaveLength(1);
    expect(toastAlert().textContent).toContain('Không đủ giọt nước');
    expectIdle(b);
    fail = false;
    click(b);
    await flush(8);
    expect(postsOf('/game/tree/water')).toHaveLength(2);
  });

  it('điểm danh: hai cú chạm cùng khung hình chỉ POST một lần', async () => {
    state.data['/game/profile'] = () => profile({ lastCheckInAt: null });
    state.posts['/me/daily-check-in'] = () => ({ points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: null, alreadyDone: false, pending: [] });
    const c = await mount();
    const b = btn(c, /^(Điểm danh nhận|Nhận nước hôm nay)/);
    await tapTogether(b, b);
    await flush(8);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
  });
});

describe('Vườn Xanh: sương, vé giữ lửa, hồi sinh chuỗi', () => {
  it('hứng sương: hai cú chạm cùng khung hình chỉ POST một lần; nút bận không disabled', async () => {
    state.posts['/game/dew/collect'] = () => ({ seedsEarned: 5 });
    const g = gate();
    state.postHold.set('/game/dew/collect', g.p);
    const c = await mount();
    const b = btn(c, 'Hứng giọt sương');
    await tapTogether(b, b);
    await flush();
    expectBusy(b);
    g.open();
    await flush(8);
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
  });

  it('mua vé giữ lửa: hai cú chạm cùng khung hình chỉ POST một lần; nút bận không disabled', async () => {
    state.posts['/game/streak-freeze/buy'] = () => ({ streakFreezes: 2 });
    const g = gate();
    state.postHold.set('/game/streak-freeze/buy', g.p);
    const c = await mount();
    const b = btn(c, /^Mua \(/);
    await tapTogether(b, b);
    await flush();
    expectBusy(b);
    g.open();
    await flush(8);
    expect(postsOf('/game/streak-freeze/buy')).toHaveLength(1);
  });

  it('hồi sinh chuỗi: hai cú chạm cùng khung hình chỉ POST một lần; lỗi thì báo và bấm lại được', async () => {
    state.data['/game/profile'] = () => profile({ streakRepairable: true, brokenStreakDays: 5, streakRepairCost: 300 });
    let fail = true;
    state.posts['/game/streak/repair'] = () => {
      if (fail) throw new Error('Hết hạn hồi sinh');
      return {};
    };
    const c = await mount();
    const b = btn(c, /^Hồi sinh \(/);
    await tapTogether(b, b);
    await flush(8);
    expect(postsOf('/game/streak/repair')).toHaveLength(1);
    expect(toastAlert().textContent).toContain('Hết hạn hồi sinh');
    expectIdle(b);
    fail = false;
    click(b);
    await flush(8);
    expect(postsOf('/game/streak/repair')).toHaveLength(2);
  });
});

describe('Vườn Xanh: tab Vườn', () => {
  it('mở lô: hai cú chạm cùng khung hình chỉ POST một lần', async () => {
    state.posts['/game/garden/unlock'] = () => plot(4);
    const c = await mount('tab=garden');
    const b = btn(panel(c, 'Vườn'), 'Mở lô');
    await tapTogether(b, b);
    await flush(8);
    expect(postsOf('/game/garden/unlock')).toHaveLength(1);
  });

  it('tưới lô: chạm đúp cùng lô trong một khung hình gọi một lần, hai lô khác nhau gọi song song, mỗi lô một lần', async () => {
    state.posts['/game/garden/plot/p2/water'] = () => WATERED;
    state.posts['/game/garden/plot/p3/water'] = () => WATERED;
    const c = await mount('tab=garden');
    const waters = Array.from(panel(c, 'Vườn').querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.includes('Tưới'));
    expect(waters).toHaveLength(2);
    await tapTogether(waters[0]!, waters[0]!, waters[1]!);
    await flush(8);
    expect(postsOf('/game/garden/plot/p2/water')).toHaveLength(1);
    expect(postsOf('/game/garden/plot/p3/water')).toHaveLength(1);
  });

  it('tưới lô: lỗi nhả đúng khoá của lô đó, bấm lại gọi lần hai', async () => {
    let fail = true;
    state.posts['/game/garden/plot/p2/water'] = () => {
      if (fail) throw new Error('Cây đã chết');
      return WATERED;
    };
    const c = await mount('tab=garden');
    const b = Array.from(panel(c, 'Vườn').querySelectorAll<HTMLButtonElement>('button')).filter((x) => x.textContent?.includes('Tưới'))[0]!;
    await tapTogether(b, b);
    await flush(8);
    expect(toastAlert().textContent).toBe('Cây đã chết');
    fail = false;
    click(b);
    await flush(8);
    expect(postsOf('/game/garden/plot/p2/water')).toHaveLength(2);
  });

  it('lô lỗi tải: Thử lại chạm đúp cùng khung hình chỉ tải lại một lần, nút báo bận tới khi xong', async () => {
    state.fail.set('/game/garden', 1);
    const c = await mount('tab=garden');
    expect(getsOf('/game/garden')).toHaveLength(1);
    const g = gate();
    state.getHold.set('/game/garden', g.p);
    const retry = btn(panel(c, 'Vườn'), gameNewbieCopy.loadError.retry);
    await tapTogether(retry, retry);
    await flush();
    expect(getsOf('/game/garden')).toHaveLength(2);
    expectBusy(retry);
    g.open();
    await flush(8);
    expect(getsOf('/game/garden')).toHaveLength(2);
    expect(panel(c, 'Vườn').textContent).toContain('Lô đất của bạn');
  });

  it('góp quỹ: xác nhận hai lần cùng khung hình chỉ POST một lần; nút Xác nhận bận không disabled; khoá giữ tới khi điểm mới về', async () => {
    state.posts['/game/tree/buy'] = () => ({ certificateCode: 'TT-1', treeType: 'Sưa', cost: 20_000, pointsUsed: 20_000, pointsUsedConverted: 0 });
    const c = await mount('tab=garden');
    click(btn(c, 'Góp quỹ trồng cây'));
    const confirm = btn(dialog()!, 'Xác nhận');
    const fresh = gate();
    state.getHold.set('/game/profile', fresh.p);
    await tapTogether(confirm, confirm);
    await flush(8);
    expect(postsOf('/game/tree/buy')).toHaveLength(1);
    // Đã trừ điểm nhưng số dư mới chưa về: hộp còn mở, nút còn bận, chạm thêm không gửi lệnh thứ hai.
    expect(dialog()).not.toBeNull();
    expectBusy(btn(dialog()!, 'Xác nhận'));
    click(btn(dialog()!, 'Xác nhận'));
    await flush();
    expect(postsOf('/game/tree/buy')).toHaveLength(1);
    fresh.open();
    await flush(8);
    expect(postsOf('/game/tree/buy')).toHaveLength(1);
    expect(dialog()).toBeNull();
  });
});

describe('Vườn Xanh: nhiệm vụ, Chặng Mùa, tặng nước', () => {
  it('nhận thưởng nhiệm vụ: hai cú chạm cùng khung hình chỉ POST một lần; khoá giữ tới khi nhiệm vụ mới về', async () => {
    let claimed = false;
    state.data['/game/missions'] = () => MISSIONS.map((m) => ({ ...m, claimed }));
    state.posts['/game/missions/REVIEW_3/claim'] = () => {
      claimed = true;
      return { claimed: true, rewardPoints: 30, couponCode: null };
    };
    const c = await mount();
    const b = btn(c, 'Nhận thưởng');
    const fresh = gate();
    state.getHold.set('/game/missions', fresh.p);
    await tapTogether(b, b);
    await flush(8);
    expect(postsOf('/game/missions/REVIEW_3/claim')).toHaveLength(1);
    expectBusy(b);
    click(b);
    await flush();
    expect(postsOf('/game/missions/REVIEW_3/claim')).toHaveLength(1);
    fresh.open();
    await flush(8);
    expect(postsOf('/game/missions/REVIEW_3/claim')).toHaveLength(1);
    expect(byText(c, 'button', 'Nhận thưởng')).toBeNull();
  });

  it('nhận bậc Chặng Mùa: hai cú chạm cùng khung hình chỉ POST một lần; lỗi thì nhả khoá', async () => {
    state.seasonPass = true;
    let fail = true;
    state.posts['/game/season-pass/claim'] = () => {
      if (fail) throw new Error('Chưa đủ điểm kinh nghiệm');
      return { claimed: true, reward: { type: 'SEEDS', amount: 10 } };
    };
    const c = await mount('tab=community');
    const b = btn(panel(c, 'Cộng đồng'), 'Nhận');
    await tapTogether(b, b);
    await flush(8);
    expect(postsOf('/game/season-pass/claim')).toHaveLength(1);
    expect(toastAlert().textContent).toContain('Chưa đủ điểm kinh nghiệm');
    fail = false;
    click(b);
    await flush(8);
    expect(postsOf('/game/season-pass/claim')).toHaveLength(2);
  });

  it('tặng nước: chạm đúp cùng bạn trong một khung hình gọi một lần, nút bận không disabled', async () => {
    state.posts['/game/gift/f1'] = () => ({ amount: 5, recipientId: 'f1' });
    const g = gate();
    state.postHold.set('/game/gift/f1', g.p);
    const c = await mount('tab=community');
    const gifts = Array.from(panel(c, 'Cộng đồng').querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Tặng 💧');
    expect(gifts).toHaveLength(2);
    await tapTogether(gifts[0]!, gifts[0]!);
    await flush();
    expectBusy(gifts[0]!);
    expectIdle(gifts[1]!);
    g.open();
    await flush(8);
    expect(postsOf('/game/gift/f1')).toHaveLength(1);
  });

  it('tặng nước: hai bạn khác nhau trong cùng khung hình gọi song song, mỗi bạn một lần', async () => {
    state.posts['/game/gift/f1'] = () => ({ amount: 5, recipientId: 'f1' });
    state.posts['/game/gift/f3'] = () => ({ amount: 5, recipientId: 'f3' });
    const c = await mount('tab=community');
    const gifts = Array.from(panel(c, 'Cộng đồng').querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Tặng 💧');
    await tapTogether(gifts[0]!, gifts[0]!, gifts[1]!, gifts[1]!);
    await flush(8);
    expect(postsOf('/game/gift/f1')).toHaveLength(1);
    expect(postsOf('/game/gift/f3')).toHaveLength(1);
  });

  it('bảng xếp hạng lỗi tải: Thử lại chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    state.fail.set('/game/leaderboard', 1);
    const c = await mount('tab=community');
    expect(getsOf('/game/leaderboard')).toHaveLength(1);
    const g = gate();
    state.getHold.set('/game/leaderboard', g.p);
    const retry = btn(panel(c, 'Cộng đồng'), gameNewbieCopy.loadError.retry);
    await tapTogether(retry, retry);
    await flush();
    expect(getsOf('/game/leaderboard')).toHaveLength(2);
    expectBusy(retry);
    g.open();
    await flush(8);
    expect(getsOf('/game/leaderboard')).toHaveLength(2);
  });
});

describe('Vườn Xanh: lỗi tải có Thử lại khoá chạm đúp', () => {
  it('hồ sơ lỗi: role="alert", Thử lại chạm đúp cùng khung hình chỉ tải lại một lần, báo bận tới khi xong', async () => {
    state.fail.set('/game/profile', 1);
    const c = await mount();
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(getsOf('/game/profile')).toHaveLength(1);
    const g = gate();
    state.getHold.set('/game/profile', g.p);
    const retry = btn(c, 'Thử lại');
    await tapTogether(retry, retry);
    await flush();
    expect(getsOf('/game/profile')).toHaveLength(2);
    expectBusy(retry);
    g.open();
    await flush(8);
    expect(getsOf('/game/profile')).toHaveLength(2);
    expect(c.textContent).toContain('Chuỗi 3 ngày');
  });

  it('lịch điểm danh lỗi: dòng báo role="alert" tại thẻ, Thử lại chạm đúp cùng khung hình chỉ tải lại một lần', async () => {
    const c = await mount();
    const inCard = () => Array.from(c.querySelectorAll('section')).find((s) => s.textContent?.includes('Vé giữ lửa'))!;
    expect(inCard().querySelector('[role="alert"]')!.textContent).toContain('Chưa tải được lịch điểm danh');
    expect(getsOf('/me/daily-check-in')).toHaveLength(1);
    const g = gate();
    state.getHold.set('/me/daily-check-in', g.p);
    const retry = btn(inCard(), 'Thử lại');
    await tapTogether(retry, retry);
    await flush();
    expect(getsOf('/me/daily-check-in')).toHaveLength(2);
    expectBusy(retry);
    g.open();
    await flush(8);
    expect(getsOf('/me/daily-check-in')).toHaveLength(2);
    expectIdle(btn(inCard(), 'Thử lại'));
  });
});

describe('Vườn Xanh: sheet Kiếm nước', () => {
  const openSheet = async () => {
    // Thiếu nước cho vé giữ lửa: nút mở sheet, sheet liệt kê điểm danh và hứng sương còn làm được.
    state.data['/game/profile'] = () => profile({ totalSeeds: 10, lastCheckInAt: null, lastDewAt: null });
    state.posts['/me/daily-check-in'] = () => ({ points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: null, alreadyDone: false, pending: [] });
    state.posts['/game/dew/collect'] = () => ({ seedsEarned: 5 });
    const c = await mount();
    click(btn(c, gameMoreCopy.freezeShort(70)));
    await flush();
    return c;
  };

  it('điểm danh trong sheet: hai cú chạm cùng khung hình chỉ POST một lần; nút bận không disabled', async () => {
    const g = gate();
    await openSheet();
    state.postHold.set('/me/daily-check-in', g.p);
    const b = btn(dialog()!, gameNewbieCopy.earn.checkinCta);
    await tapTogether(b, b);
    await flush();
    expectBusy(b);
    g.open();
    await flush(8);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
  });

  it('hứng sương trong sheet: hai cú chạm cùng khung hình chỉ POST một lần; nút bận không disabled', async () => {
    const g = gate();
    await openSheet();
    state.postHold.set('/game/dew/collect', g.p);
    const b = btn(dialog()!, gameNewbieCopy.earn.dewCta);
    await tapTogether(b, b);
    await flush();
    expectBusy(b);
    g.open();
    await flush(8);
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
  });

  it('điểm danh lỗi: sheet báo role="alert" của đúng lần điểm danh, nút bật lại gọi được lần hai', async () => {
    let fail = true;
    await openSheet();
    state.posts['/me/daily-check-in'] = () => {
      if (fail) throw new Error('Máy chủ bận');
      return { points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: null, alreadyDone: false, pending: [] };
    };
    const b = btn(dialog()!, gameNewbieCopy.earn.checkinCta);
    await tapTogether(b, b);
    await flush(8);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('Máy chủ bận');
    fail = false;
    click(btn(dialog()!, gameNewbieCopy.earn.checkinCta));
    await flush(8);
    expect(postsOf('/me/daily-check-in')).toHaveLength(2);
  });
});

describe('Vườn Xanh: hộp thu hoạch', () => {
  const harvest = { progress: 50, target: 50, harvested: true, treesPlanted: 4, reward: { coupon: 'XANH-123', certificate: 'TT-77' } };
  const harvestNow = async () => {
    state.posts['/game/tree/water'] = () => harvest;
    const c = await mount();
    click(btn(c, /Tưới hết/));
    await flush(8);
    return c;
  };

  it('chia sẻ lên Cộng đồng: hai cú chạm cùng khung hình chỉ POST một lần; nút bận không disabled, xong thì khoá cứng', async () => {
    state.posts['/game/harvest/share'] = () => ({ shared: true, alreadyShared: false });
    const g = gate();
    state.postHold.set('/game/harvest/share', g.p);
    await harvestNow();
    const b = btn(dialog()!, gameNewbieCopy.harvest.shareCommunity);
    await tapTogether(b, b);
    await flush();
    expectBusy(b);
    g.open();
    await flush(8);
    expect(postsOf('/game/harvest/share')).toHaveLength(1);
    const done = btn(dialog()!, gameNewbieCopy.harvest.shareCommunityDone);
    expect(done.disabled).toBe(true);
  });

  it('chia sẻ lỗi: báo lỗi, nhả khoá, bấm lại gọi lần hai', async () => {
    let fail = true;
    state.posts['/game/harvest/share'] = () => {
      if (fail) throw new Error('Chưa chia sẻ được');
      return { shared: true, alreadyShared: false };
    };
    await harvestNow();
    const b = btn(dialog()!, gameNewbieCopy.harvest.shareCommunity);
    await tapTogether(b, b);
    await flush(8);
    expect(postsOf('/game/harvest/share')).toHaveLength(1);
    expect(toastAlert().textContent).toContain('Chưa chia sẻ được');
    fail = false;
    click(btn(dialog()!, gameNewbieCopy.harvest.shareCommunity));
    await flush(8);
    expect(postsOf('/game/harvest/share')).toHaveLength(2);
  });

  it('chia sẻ lần thu hoạch trước xong muộn, sau khi khách thu hoạch lần mới: nút của lần mới KHÔNG hiện "Đã chia sẻ", chia sẻ lần mới vẫn gọi và xong bình thường', async () => {
    const harvest2 = { ...harvest, treesPlanted: 5, reward: { coupon: 'XANH-456', certificate: 'TT-78' } };
    state.posts['/game/harvest/share'] = () => ({ shared: true, alreadyShared: false });
    const g = gate();
    state.postHold.set('/game/harvest/share', g.p);
    const c = await harvestNow();
    click(btn(dialog()!, gameNewbieCopy.harvest.shareCommunity));
    await flush();
    expect(postsOf('/game/harvest/share')).toHaveLength(1);
    click(btn(dialog()!, gameNewbieCopy.harvest.later));
    await flush(8);
    state.posts['/game/tree/water'] = () => harvest2;
    click(btn(c, /Tưới hết/));
    await flush(8);
    expect(dialog()!.textContent).toContain('XANH-456');
    g.open();
    await flush(8);
    const labels = Array.from(dialog()!.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain(gameNewbieCopy.harvest.shareCommunityDone);
    const next = btn(dialog()!, gameNewbieCopy.harvest.shareCommunity);
    expect(next.disabled).toBe(false);
    expectIdle(next);
    click(next);
    await flush(8);
    expect(postsOf('/game/harvest/share')).toHaveLength(2);
    expect(btn(dialog()!, gameNewbieCopy.harvest.shareCommunityDone).disabled).toBe(true);
  });

  it('"Dùng mã giảm giá ngay": lúc đang kiểm giỏ nút báo bận, chạm không gọi lần hai', async () => {
    await harvestNow();
    const b = btn(dialog()!, 'Dùng mã giảm giá ngay');
    click(b);
    expect(state.use).toHaveBeenCalledTimes(1);
    expectIdle(b);
    mounted.forEach((m) => m.unmount());
    mounted = [];
    state.use.mockReset();
    state.usingCode = 'XANH-123';
    await harvestNow();
    const busy = btn(dialog()!, 'Dùng mã giảm giá ngay');
    expectBusy(busy);
    click(busy);
    expect(state.use).not.toHaveBeenCalled();
  });
});

describe('Vườn Xanh: khoá giữ tới khi dữ liệu mới về', () => {
  it('hứng sương: POST xong mà hồ sơ chưa về thì nút vẫn bận, chạm thêm không gọi lần hai', async () => {
    let collected = false;
    state.data['/game/profile'] = () => profile({ lastDewAt: collected ? NOW() : null });
    state.posts['/game/dew/collect'] = () => {
      collected = true;
      return { seedsEarned: 5 };
    };
    const c = await mount();
    const b = btn(c, 'Hứng giọt sương');
    const fresh = gate();
    state.getHold.set('/game/profile', fresh.p);
    click(b);
    await flush(8);
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
    expectBusy(b);
    click(b);
    await flush();
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
    fresh.open();
    await flush(8);
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
    expect(getsOf('/game/profile').length).toBeGreaterThan(1);
    expectIdle(b);
  });

  it('hết thời gian chờ: máy chủ có thể đã ghi nhận nên làm mới, nút vẫn bận tới khi hồ sơ mới về', async () => {
    state.posts['/game/dew/collect'] = () => {
      throw new NetworkError(true);
    };
    const c = await mount();
    const b = btn(c, 'Hứng giọt sương');
    const fresh = gate();
    state.getHold.set('/game/profile', fresh.p);
    const before = getsOf('/game/profile').length;
    click(b);
    await flush(8);
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
    expect(toastAlert().textContent).toContain('Mạng chậm, chưa rõ đã xong chưa');
    expectBusy(b);
    click(b);
    await flush();
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
    fresh.open();
    await flush(8);
    expect(getsOf('/game/profile').length).toBeGreaterThan(before);
    expectIdle(b);
  });

  it('hồi sinh chuỗi: POST xong mà hồ sơ chưa về thì nút vẫn bận, chạm thêm không gọi lần hai', async () => {
    let repaired = false;
    state.data['/game/profile'] = () => profile({ streakRepairable: !repaired, brokenStreakDays: 5, streakRepairCost: 300 });
    state.posts['/game/streak/repair'] = () => {
      repaired = true;
      return {};
    };
    const c = await mount();
    const b = btn(c, /^Hồi sinh \(/);
    const fresh = gate();
    state.getHold.set('/game/profile', fresh.p);
    click(b);
    await flush(8);
    expect(postsOf('/game/streak/repair')).toHaveLength(1);
    expectBusy(b);
    click(b);
    await flush();
    expect(postsOf('/game/streak/repair')).toHaveLength(1);
    fresh.open();
    await flush(8);
    expect(postsOf('/game/streak/repair')).toHaveLength(1);
    expect(byText(c, 'button', /^Hồi sinh \(/)).toBeNull();
  });

  it('điểm danh: POST xong mà số liệu mới chưa về thì nút vẫn bận, chạm thêm không gọi lần hai', async () => {
    let done = false;
    state.data['/game/profile'] = () => profile({ lastCheckInAt: done ? NOW() : null });
    state.posts['/me/daily-check-in'] = () => {
      done = true;
      return { points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: null, alreadyDone: false, pending: [] };
    };
    const c = await mount();
    const b = btn(c, /^(Điểm danh nhận|Nhận nước hôm nay)/);
    const fresh = gate();
    state.getHold.set('/game/profile', fresh.p);
    click(b);
    await flush(8);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
    expectBusy(b);
    click(b);
    await flush();
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
    fresh.open();
    await flush(8);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
    expect(byText(c, 'button', /^(Điểm danh nhận|Nhận nước hôm nay)/)).toBeNull();
  });

  it('nhận hai nhiệm vụ khác nhau cùng khung hình: song song, mỗi nhiệm vụ một POST', async () => {
    state.data['/game/missions'] = [MISSIONS[0]!, { ...MISSIONS[0]!, code: 'SHARE_1', title: 'Chia sẻ 1 lần' }];
    state.posts['/game/missions/REVIEW_3/claim'] = () => ({ claimed: true, rewardPoints: 30, couponCode: null });
    state.posts['/game/missions/SHARE_1/claim'] = () => ({ claimed: true, rewardPoints: 30, couponCode: null });
    const c = await mount();
    const claims = Array.from(c.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Nhận thưởng');
    expect(claims).toHaveLength(2);
    await tapTogether(claims[0]!, claims[0]!, claims[1]!, claims[1]!);
    await flush(8);
    expect(postsOf('/game/missions/REVIEW_3/claim')).toHaveLength(1);
    expect(postsOf('/game/missions/SHARE_1/claim')).toHaveLength(1);
  });

  it('nhận hai bậc Chặng Mùa khác nhau cùng khung hình: song song, mỗi bậc một POST', async () => {
    state.seasonPass = true;
    const tier = (n: number) => ({ tier: n, xpRequired: 100 * (n + 1), free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 20 }, unlocked: true, claimedFree: false, claimedPremium: false });
    state.data['/game/season-pass'] = { ...PASS, tiers: [tier(0), tier(1)] };
    state.posts['/game/season-pass/claim'] = () => ({ claimed: true, reward: { type: 'SEEDS', amount: 10 } });
    const c = await mount('tab=community');
    const claims = Array.from(panel(c, 'Cộng đồng').querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent === 'Nhận');
    expect(claims).toHaveLength(2);
    await tapTogether(claims[0]!, claims[0]!, claims[1]!, claims[1]!);
    await flush(8);
    const bodies = postsOf('/game/season-pass/claim').map((x) => JSON.stringify(x.body)).sort();
    expect(bodies).toHaveLength(2);
    expect(new Set(bodies).size).toBe(2);
  });
});

describe('Vườn Xanh: vòng quay may mắn', () => {
  it('chạm đúp nút Quay ngay và trục QUAY cùng khung hình chỉ POST một lần; cả hai nút báo bận, không disabled', async () => {
    state.posts['/game/spin'] = () => ({ prize: { id: 'm', name: 'Chúc may mắn', rewardType: 'NONE', value: 0 } });
    const g = gate();
    state.postHold.set('/game/spin', g.p);
    const c = await mount();
    const cta = btn(c, /^Quay ngay/);
    const hub = btn(c, 'QUAY');
    await tapTogether(cta, cta, hub);
    await flush();
    expect(postsOf('/game/spin')).toHaveLength(1);
    expectBusy(cta);
    expectBusy(hub);
  });

  it('quay lỗi: báo role="alert", nhả khoá, quay lại được', async () => {
    let fail = true;
    state.posts['/game/spin'] = () => {
      if (fail) throw new Error('Không đủ điểm');
      return { prize: { id: 'm', name: 'Chúc may mắn', rewardType: 'NONE', value: 0 } };
    };
    const c = await mount();
    const cta = btn(c, /^Quay ngay/);
    await tapTogether(cta, cta);
    await flush(8);
    expect(postsOf('/game/spin')).toHaveLength(1);
    expect(toastAlert().textContent).toContain('Không đủ điểm');
    expectIdle(btn(c, /^Quay ngay/));
    fail = false;
    click(btn(c, /^Quay ngay/));
    await flush(8);
    expect(postsOf('/game/spin')).toHaveLength(2);
  });
});
