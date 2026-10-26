// @vitest-environment jsdom
import { act } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { headingProblems, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

type Call = { method: string; path: string; body?: unknown; headers?: Record<string, string> };

const state = vi.hoisted(() => ({
  phase: 'authenticated' as string,
  search: '' as string,
  replace: vi.fn(),
  push: vi.fn(),
  retrySession: vi.fn(),
  wasteReady: false,
  config: { waste: { enabled: false } } as Record<string, unknown>,
  data: {} as Record<string, unknown>,
  fail: new Map<string, number>(),
  posts: {} as Record<string, () => unknown>,
  calls: [] as Call[],
  keySeq: 0,
}));

vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => state.phase }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ retrySession: state.retrySession }) }));
vi.mock('@/lib/idempotency-key', () => ({ newIdempotencyKey: () => `key-${++state.keySeq}` }));
vi.mock('@/lib/route-map', () => ({ isWebRouteReady: () => state.wasteReady }));
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
    post: async (path: string, body?: unknown, opts?: { headers?: Record<string, string> }) => {
      state.calls.push({ method: 'post', path, body, headers: opts?.headers });
      const h = state.posts[path];
      if (!h) throw new Error(`chưa mock POST ${path}`);
      return h();
    },
  },
}));

import GamePage from './page';

const todayIso = () => new Date().toISOString();
const PROFILE = (over: Record<string, unknown> = {}) => ({
  totalSeeds: 1_250,
  streakDays: 3,
  treeStage: 1,
  treeHealth: 'HEALTHY',
  streakFreezes: 1,
  lastDewAt: null,
  lastCheckInAt: null,
  ecoImpact: { progress: 600, target: 1_000, treeType: 'Cây Sưa', treesPlanted: 2 },
  streakFreezeCost: 80,
  treePointsPrice: 20_000,
  spinCostPoints: 10,
  ...over,
});
const QUIZ = [
  { id: 'q1', question: 'Cây nào hấp thụ nhiều CO₂?', options: ['Sưa', 'Tre', 'Cỏ', 'Rêu'], category: 'cay', difficulty: 2, waterReward: 10 },
  { id: 'q2', question: 'Rác nào tái chế được?', options: ['Chai nhựa', 'Pin', 'Tã', 'Gốm'], category: 'tai_che', difficulty: 1, waterReward: 5 },
];
const MISSIONS = [
  { code: 'REVIEW_3', title: 'Đánh giá 3 sản phẩm', description: 'Viết đánh giá', rewardPoints: 30, progress: 3, goal: 3, completed: true, claimed: false },
  { code: 'INVITE_3', title: 'Mời 3 bạn', rewardPoints: 50, progress: 1, goal: 3, completed: false, claimed: false },
  { code: 'FIRST_ORDER', title: 'Đơn đầu tiên', rewardPoints: 20, progress: 1, goal: 1, completed: true, claimed: true },
];
const FOREST = { count: 7, plantedCount: 1, trees: Array.from({ length: 7 }, (_, i) => ({ certificateCode: `TT-${i + 1}`, treeType: 'Sưa', status: i === 0 ? 'PLANTED' : 'PLEDGED', region: null, pledgedAt: '2026-10-01T00:00:00Z', plantedAt: null })) };
const SEASON = { id: 's1', name: 'Mùa Thu Xanh', theme: 'Thu', region: 'Tây Nguyên', startAt: '2026-10-01', endAt: '2026-12-01', featuredSpecies: [{ id: 'a', name: 'Sưa', emoji: '🌳', rarity: 'RARE' }] };

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<GamePage />);
  mounted.push(r);
  await flush(8);
  return r.container;
};
const postsOf = (path: string) => state.calls.filter((c) => c.method === 'post' && c.path === path);
const getsOf = (path: string) => state.calls.filter((c) => c.method === 'get' && c.path === path);
const btn = (c: HTMLElement, text: string | RegExp) => byText(c, 'button', text) as HTMLButtonElement;
const panel = (c: HTMLElement, label: string) => c.querySelector<HTMLElement>(`[role="tabpanel"][aria-label="${label}"]`)!;
const visible = (c: HTMLElement, label: string) => !panel(c, label).hidden;

beforeEach(() => {
  state.phase = 'authenticated';
  state.search = '';
  state.wasteReady = false;
  state.config = { waste: { enabled: false } };
  state.calls = [];
  state.fail = new Map();
  state.keySeq = 0;
  state.replace.mockReset();
  state.push.mockReset();
  state.data = {
    '/game/profile': PROFILE(),
    '/game/quiz/today': QUIZ,
    '/game/missions': MISSIONS,
    '/game/forest': FOREST,
    '/game/season': SEASON,
  };
  state.posts = {};
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

describe('Vườn Xanh: trạng thái trang', () => {
  it('khách: cổng đăng nhập mang returnTo, không tải hồ sơ', async () => {
    state.phase = 'guest';
    const c = await mount();
    expect(c.textContent).toContain('Vườn Xanh');
    expect(c.textContent).toContain('Đăng nhập để trồng cây, nhận nước và quà');
    expect(c.querySelector('a[href="/dang-nhap?returnTo=%2Fvuon-xanh"]')).not.toBeNull();
    expect(getsOf('/game/profile')).toHaveLength(0);
  });

  it('đang khôi phục phiên: chỉ khung chờ, không cổng đăng nhập, không tải hồ sơ', async () => {
    state.phase = 'loading';
    const c = await mount();
    expect(c.textContent).toContain('Đang tải…');
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    expect(getsOf('/game/profile')).toHaveLength(0);
  });

  it('mất kết nối lúc khôi phục phiên: nói đúng chuyện đó và cho thử lại, không mời đăng nhập', async () => {
    state.phase = 'unavailable';
    const c = await mount();
    expect(c.textContent).toContain('Không kết nối được với Tubu Tree');
    expect(c.querySelector('a[href^="/dang-nhap"]')).toBeNull();
    click(btn(c, 'Thử lại'));
    await flush();
    expect(state.retrySession).toHaveBeenCalledTimes(1);
  });

  it('mỗi trạng thái có đúng một h1 "Vườn Xanh"', async () => {
    for (const phase of ['guest', 'loading', 'unavailable', 'authenticated']) {
      state.phase = phase;
      const c = await mount();
      expect(c.querySelectorAll('h1')).toHaveLength(1);
      expect(c.querySelector('h1')!.textContent).toBe('Vườn Xanh');
    }
  });

  it('lỗi tải hồ sơ: báo lỗi và "Thử lại" tải lại hồ sơ, không dựng phần còn lại', async () => {
    state.fail.set('/game/profile', 1);
    const c = await mount();
    expect(c.querySelector('[role="alert"]')).not.toBeNull();
    expect(c.textContent).not.toContain('Điểm danh');
    click(btn(c, 'Thử lại'));
    await flush(8);
    expect(getsOf('/game/profile')).toHaveLength(2);
    expect(c.textContent).toContain('Điểm danh chuỗi 3 ngày');
  });
});

describe('Vườn Xanh: khung, tab và thẻ vườn', () => {
  it('ba tab Hôm nay / Vườn / Cộng đồng, mở sẵn Hôm nay, khối của tab khác ẩn nhưng vẫn dựng', async () => {
    const c = await mount();
    const tabs = Array.from(c.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual(['Hôm nay', 'Vườn', 'Cộng đồng']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(visible(c, 'Hôm nay')).toBe(true);
    expect(visible(c, 'Vườn')).toBe(false);
    expect(visible(c, 'Cộng đồng')).toBe(false);
  });

  it('?tab=community mở tab Cộng đồng; chạm tab ghi ?tab= bằng replace, Hôm nay thì bỏ ?tab=', async () => {
    state.search = 'tab=community';
    const c = await mount();
    expect(visible(c, 'Cộng đồng')).toBe(true);
    expect(visible(c, 'Hôm nay')).toBe(false);
    click(byText(c, '[role="tab"]', 'Vườn'));
    expect(state.replace).toHaveBeenCalledWith('/vuon-xanh?tab=garden', { scroll: false });
    click(byText(c, '[role="tab"]', 'Hôm nay'));
    expect(state.replace).toHaveBeenLastCalledWith('/vuon-xanh', { scroll: false });
  });

  it('giá trị ?tab= lạ rơi về Hôm nay', async () => {
    state.search = 'tab=xyz';
    const c = await mount();
    expect(visible(c, 'Hôm nay')).toBe(true);
  });

  it('thẻ vườn: tên cây, tiến độ và dòng tổng hợp có dấu phân cách nghìn', async () => {
    const c = await mount();
    expect(c.textContent).toContain('Cây Sưa');
    expect(c.textContent).toContain('600/1.000💧 · 💧 1.250 · 🔥 3 ngày · 🌳 cây đã trồng: 2');
    expect(c.querySelector('[role="progressbar"][aria-label="Tiến độ cây"]')!.getAttribute('aria-valuenow')).toBe('60');
  });

  it('chưa có ecoImpact: tên mặc định "Vườn của bạn" và số 0', async () => {
    state.data['/game/profile'] = PROFILE({ ecoImpact: null, totalSeeds: undefined, streakDays: undefined });
    const c = await mount();
    expect(c.textContent).toContain('Vườn của bạn');
    expect(c.textContent).toContain('0/0💧 · 💧 0 · 🔥 0 ngày · 🌳 cây đã trồng: 0');
  });

  it('giai đoạn cây: <=50% mầm, >50% cành, 100% cây', async () => {
    const stage = async (progress: number) => {
      state.data['/game/profile'] = PROFILE({ ecoImpact: { progress, target: 1000, treeType: 'X', treesPlanted: 0 } });
      const c = await mount();
      return c.querySelector('[data-testid="garden-stage"]')!.textContent;
    };
    expect(await stage(500)).toBe('🌱');
    expect(await stage(600)).toBe('🌿');
    expect(await stage(1000)).toBe('🌳');
  });

  it('banner mùa (tab Cộng đồng) hiện chủ đề, vùng và loài nổi bật; không có mùa thì ẩn', async () => {
    const c = await mount();
    expect(panel(c, 'Cộng đồng').textContent).toContain('Mùa Thu Xanh');
    expect(panel(c, 'Cộng đồng').textContent).toContain('Thu · Tây Nguyên');
    expect(panel(c, 'Cộng đồng').textContent).toContain('Loài nổi bật mùa này: Sưa');
    state.data['/game/season'] = null;
    const c2 = await mount();
    expect(panel(c2, 'Cộng đồng').textContent).not.toContain('Mùa Thu Xanh');
  });

  it('lối vào Đổi rác lấy quà: chỉ khi chương trình bật và route đã xong', async () => {
    state.config = { waste: { enabled: true } };
    state.wasteReady = false;
    let c = await mount();
    expect(c.textContent).not.toContain('Đổi rác lấy quà');
    state.wasteReady = true;
    c = await mount();
    const link = c.querySelector<HTMLAnchorElement>('a[href="/doi-rac"]')!;
    expect(link.textContent).toContain('Đổi rác lấy quà');
    expect(link.textContent).toContain('Mới');
    expect(link.textContent).toContain('Giọt nước dùng trong Vườn, Điểm Xanh dùng để mua sắm');
    state.config = { waste: { enabled: false } };
    c = await mount();
    expect(c.querySelector('a[href="/doi-rac"]')).toBeNull();
  });

  it('khối nào ở tab nào: tưới, điểm danh, nhiệm vụ, quiz, vòng quay thuộc Hôm nay, mỗi khối có h2; tác động xanh ở tab Vườn', async () => {
    const c = await mount();
    const today = panel(c, 'Hôm nay');
    for (const t of ['Nhận nước hôm nay', 'Điểm danh chuỗi']) expect(today.textContent).toContain(t);
    expect(Array.from(today.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Nhiệm vụ', 'Câu đố Sống Xanh hôm nay', 'Vòng quay may mắn']),
    );
    expect(panel(c, 'Vườn').textContent).toContain('Tác động xanh của bạn');
    expect(today.textContent).not.toContain('Tác động xanh của bạn');
  });

  it('a11y: heading hợp lệ, nút có tên, vùng chạm đủ lớn', async () => {
    const c = await mount();
    expect(headingProblems(c)).toEqual([]);
    expect(unnamedControls(c)).toEqual([]);
    expect(smallTouchTargets(c)).toEqual([]);
  });
});

describe('Vườn Xanh: điểm danh, sương, vé giữ lửa, hồi sinh chuỗi', () => {
  it('điểm danh: gửi POST một lần dù chạm đúp, báo thành công, tải lại hồ sơ', async () => {
    state.posts['/me/daily-check-in'] = () => ({ points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: { seedsEarned: 10, streakDays: 4, totalSeeds: 1260, streakFrozeUsed: true, bonusNote: 'Thưởng ngày 3' }, alreadyDone: false, pending: [] });
    const c = await mount();
    const b = btn(c, 'Điểm danh');
    act(() => {
      b.click();
      b.click();
    });
    await flush(8);
    expect(postsOf('/me/daily-check-in')).toHaveLength(1);
    expect(document.body.textContent).toContain('+1.000 Điểm Xanh · +10 giọt nước · đã dùng vé giữ lửa · Thưởng ngày 3');
    expect(getsOf('/game/profile').length).toBeGreaterThanOrEqual(2);
  });

  it('đã điểm danh hôm nay: nút "Đã điểm danh" tắt; hôm kia thì bật lại', async () => {
    state.data['/game/profile'] = PROFILE({ lastCheckInAt: todayIso() });
    let c = await mount();
    expect(btn(c, 'Đã điểm danh').disabled).toBe(true);
    state.data['/game/profile'] = PROFILE({ lastCheckInAt: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    c = await mount();
    expect(btn(c, 'Điểm danh').disabled).toBe(false);
  });

  it('lỗi điểm danh: báo lỗi, nút bật lại gọi được lần hai', async () => {
    let n = 0;
    state.posts['/me/daily-check-in'] = () => {
      if (++n === 1) throw new Error('Lỗi máy chủ');
      return { seedsEarned: 5, pointsEarned: 0, streakDays: 4, totalSeeds: 1, streakFrozeUsed: false, bonusNote: '' };
    };
    const c = await mount();
    click(btn(c, 'Điểm danh'));
    await flush(6);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Lỗi máy chủ');
    click(btn(c, 'Điểm danh'));
    await flush(6);
    expect(postsOf('/me/daily-check-in')).toHaveLength(2);
  });

  it('chuỗi 3 ngày: tiêu đề, 7 ô theo chu kỳ, ô thưởng ngày 3 và 7', async () => {
    state.data['/game/profile'] = PROFILE({ streakDays: 2 });
    const c = await mount();
    expect(c.textContent).toContain('Điểm danh chuỗi 2 ngày');
    const cells = Array.from(c.querySelectorAll('[data-testid="streak-cell"]')).map((x) => x.textContent);
    expect(cells).toEqual(['💧', '💧', '🎁', '4', '5', '6', '🎁']);
  });

  it('chuỗi chẵn bội 7: đủ 7 ô đã xong', async () => {
    state.data['/game/profile'] = PROFILE({ streakDays: 7 });
    const c = await mount();
    expect(Array.from(c.querySelectorAll('[data-testid="streak-cell"]')).every((x) => x.textContent === '💧')).toBe(true);
  });

  it('giọt sương: gọi một lần, báo số giọt nước; đã hứng hôm nay thì tắt và độc lập với điểm danh', async () => {
    state.posts['/game/dew/collect'] = () => ({ seedsEarned: 5, totalSeeds: 1255 });
    let c = await mount();
    click(btn(c, 'Hứng giọt sương'));
    await flush(6);
    expect(postsOf('/game/dew/collect')).toHaveLength(1);
    expect(document.body.textContent).toContain('Hứng được +5💧 từ giọt sương sáng 💦');
    state.data['/game/profile'] = PROFILE({ lastDewAt: todayIso(), lastCheckInAt: null });
    c = await mount();
    expect(btn(c, 'Đã hứng sương').disabled).toBe(true);
    expect(btn(c, 'Điểm danh').disabled).toBe(false);
  });

  it('vé giữ lửa: số vé và giá từ hồ sơ (mặc định 80💧), mua gọi một lần và báo số vé còn lại', async () => {
    state.posts['/game/streak-freeze/buy'] = () => ({ streakFreezes: 2, totalSeeds: 1100 });
    let c = await mount();
    expect(c.textContent).toContain('Vé giữ lửa: 1');
    click(btn(c, 'Mua (80💧)'));
    await flush(6);
    expect(postsOf('/game/streak-freeze/buy')).toHaveLength(1);
    expect(document.body.textContent).toContain('Đã mua vé giữ lửa 🧊 (còn 2 vé)');
    state.data['/game/profile'] = PROFILE({ streakFreezeCost: undefined });
    c = await mount();
    expect(btn(c, 'Mua (80💧)')).not.toBeNull();
  });

  it('hồi sinh chuỗi: chỉ trong cửa sổ hồi sinh; bấm gọi API một lần và báo', async () => {
    let c = await mount();
    expect(c.textContent).not.toContain('Bạn vừa mất chuỗi');
    state.data['/game/profile'] = PROFILE({ streakRepairable: true, brokenStreakDays: 12, streakRepairCost: 150 });
    state.posts['/game/streak/repair'] = () => ({ repaired: true, streakDays: 12, totalSeeds: 1 });
    c = await mount();
    expect(c.textContent).toContain('Bạn vừa mất chuỗi 12 ngày');
    expect(c.textContent).toContain('Hồi sinh ngay để giữ lại thành tích trước khi hết hạn.');
    click(btn(c, 'Hồi sinh (150💧)'));
    await flush(6);
    expect(postsOf('/game/streak/repair')).toHaveLength(1);
    expect(document.body.textContent).toContain('Đã hồi sinh chuỗi! 🌿');
  });

  it('cây héo/chết hiện đúng cảnh báo; khoẻ thì không có', async () => {
    let c = await mount();
    expect(c.querySelector('[data-testid="tree-health"]')).toBeNull();
    state.data['/game/profile'] = PROFILE({ treeHealth: 'WILTED' });
    c = await mount();
    expect(c.textContent).toContain('Cây đang héo, tưới để cây xanh lại.');
    state.data['/game/profile'] = PROFILE({ treeHealth: 'DEAD' });
    c = await mount();
    // Hồ sơ cũ còn DEAD: hiện như héo, không nói chuyện mất tiến độ.
    expect(c.textContent).toContain('Cây đang héo, tưới để cây xanh lại.');
    expect(c.textContent).not.toContain('trồng cây mới từ đầu');
  });
});

describe('Vườn Xanh: tưới cây và góp quỹ trồng cây', () => {
  it('tưới hết: POST /game/tree/water {drops:1250} đúng một lần dù chạm đúp, báo tiến độ, tải lại hồ sơ và rừng', async () => {
    state.data['/game/profile'] = PROFILE({ lastCheckInAt: todayIso() });
    state.posts['/game/tree/water'] = () => ({ progress: 620, target: 1000, harvested: false, treesPlanted: 2 });
    const c = await mount();
    const b = btn(c, 'Tưới hết (1.250💧)');
    act(() => {
      b.click();
      b.click();
    });
    await flush(8);
    expect(postsOf('/game/tree/water')).toHaveLength(1);
    expect(postsOf('/game/tree/water')[0]!.body).toEqual({ drops: 1250 });
    expect(document.body.textContent).toContain('Đã tưới · 620/1.000💧');
    expect(getsOf('/game/forest').length).toBeGreaterThanOrEqual(2);
  });

  it('tưới lỗi: báo lỗi và nút bật lại', async () => {
    state.data['/game/profile'] = PROFILE({ lastCheckInAt: todayIso() });
    state.posts['/game/tree/water'] = () => {
      throw new Error('Không đủ giọt nước');
    };
    const c = await mount();
    click(btn(c, 'Tưới hết (1.250💧)'));
    await flush(6);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Không đủ giọt nước');
    expect(btn(c, 'Tưới hết (1.250💧)').disabled).toBe(false);
  });

  it('nút góp quỹ kèm giá Điểm Xanh từ hồ sơ; không có giá thì không kèm', async () => {
    let c = await mount();
    expect(btn(c, 'Góp quỹ trồng cây').textContent).toContain('(20.000 điểm)');
    state.data['/game/profile'] = PROFILE({ treePointsPrice: undefined });
    c = await mount();
    expect(btn(c, 'Góp quỹ trồng cây').textContent!.trim()).toBe('Góp quỹ trồng cây');
    expect(c.textContent).toContain('Góp bằng Điểm Xanh — dùng điểm thường trước, thiếu mới dùng điểm không hết hạn.');
  });

  const BUY = '/game/tree/buy';
  const BOUGHT = { certificateCode: 'TT-99', treeType: 'Sưa', cost: 20_000, pointsUsed: 20_000, pointsUsedConverted: 0 };
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  it('góp quỹ: hộp xác nhận nêu số điểm; xác nhận hai lần cùng khung hình chỉ gọi một lần, kèm Idempotency-Key', async () => {
    state.posts[BUY] = () => BOUGHT;
    const c = await mount();
    click(btn(c, 'Góp quỹ trồng cây'));
    expect(dialog()!.textContent).toContain('Góp quỹ trồng cây sẽ trừ 20.000 điểm từ Điểm Xanh của bạn.');
    const ok = btn(dialog()!, 'Xác nhận');
    act(() => {
      ok.click();
      ok.click();
    });
    await flush(8);
    expect(postsOf(BUY)).toHaveLength(1);
    expect(postsOf(BUY)[0]!.headers).toEqual({ 'Idempotency-Key': 'key-1' });
    expect(document.body.textContent).toContain('Đã góp 1 cây vào quỹ trồng cây 🌳 (−20.000 điểm) · mã TT-99');
    expect(dialog()).toBeNull();
  });

  it('lỗi mạng: hộp ở lại, thử lại gửi đúng key cũ; thành công thì đóng, mở lại ra key mới', async () => {
    let n = 0;
    state.posts[BUY] = () => {
      if (++n === 1) throw new Error('mất mạng');
      return BOUGHT;
    };
    const c = await mount();
    click(btn(c, 'Góp quỹ trồng cây'));
    click(btn(dialog()!, 'Xác nhận'));
    await flush(6);
    expect(dialog()).not.toBeNull();
    click(btn(dialog()!, 'Xác nhận'));
    await flush(6);
    expect(postsOf(BUY).map((p) => p.headers!['Idempotency-Key'])).toEqual(['key-1', 'key-1']);
    expect(dialog()).toBeNull();
    click(btn(c, 'Góp quỹ trồng cây'));
    click(btn(dialog()!, 'Xác nhận'));
    await flush(6);
    expect(postsOf(BUY)[2]!.headers!['Idempotency-Key']).toBe('key-2');
  });

  it('Huỷ đóng hộp, không gọi API', async () => {
    const c = await mount();
    click(btn(c, 'Góp quỹ trồng cây'));
    click(btn(dialog()!, 'Huỷ'));
    expect(dialog()).toBeNull();
    expect(postsOf(BUY)).toHaveLength(0);
  });
});

describe('Vườn Xanh: nhiệm vụ', () => {
  it('đạt chưa nhận có nút "Nhận thưởng" gọi claim đúng mã; đã nhận có dấu và không có nút; chưa đạt hiện tiến độ', async () => {
    state.posts['/game/missions/REVIEW_3/claim'] = () => ({ claimed: true, rewardPoints: 30, couponCode: null });
    const c = await mount();
    expect(Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Nhận thưởng')).toHaveLength(1);
    expect(c.textContent).toContain('1/3');
    expect(c.textContent).toContain('(đã nhận thưởng)');
    expect(c.textContent).toContain('+30 Điểm Xanh');
    const b = btn(c, 'Nhận thưởng');
    act(() => {
      b.click();
      b.click();
    });
    await flush(8);
    expect(postsOf('/game/missions/REVIEW_3/claim')).toHaveLength(1);
    expect(document.body.textContent).toContain('Đã nhận +30 Điểm Xanh! 🌿');
  });

  it('không có nhiệm vụ: "Chưa có nhiệm vụ."', async () => {
    state.data['/game/missions'] = [];
    const c = await mount();
    expect(c.textContent).toContain('Chưa có nhiệm vụ.');
  });

  it('CHECKIN_7 lấy tiến độ từ chuỗi ngày (tối đa bằng mục tiêu); mục tiêu 0 lấy mặc định theo mã', async () => {
    state.data['/game/missions'] = [
      { code: 'CHECKIN_7', title: 'Điểm danh 7 ngày', rewardPoints: 10, progress: 0, goal: 7, completed: false, claimed: false },
      { code: 'REVIEW_3', title: 'Đánh giá', rewardPoints: 10, progress: 1, goal: 0, completed: false, claimed: false },
    ];
    state.data['/game/profile'] = PROFILE({ streakDays: 9 });
    const c = await mount();
    expect(c.textContent).toContain('7/7');
    expect(c.textContent).toContain('1/3');
  });

  it('nhiệm vụ chưa xong có "Làm ngay" dẫn đúng chỗ; mã lạ và nhiệm vụ đã nhận không có nút; thanh tiến độ có tên', async () => {
    state.data['/game/missions'] = [
      { code: 'FIRST_ORDER', title: 'Đơn đầu', rewardPoints: 5, progress: 0, goal: 1, completed: false, claimed: false },
      { code: 'REVIEW_3', title: 'Viết đánh giá', rewardPoints: 5, progress: 0, goal: 3, completed: false, claimed: false },
      { code: 'INVITE_3', title: 'Mời bạn', rewardPoints: 5, progress: 0, goal: 3, completed: false, claimed: false },
      { code: 'MYSTERY', title: 'Lạ', rewardPoints: 5, progress: 0, goal: 1, completed: false, claimed: false },
      { code: 'ZZ', title: 'Xong', rewardPoints: 5, progress: 1, goal: 1, completed: true, claimed: true },
    ];
    const c = await mount();
    const goButtons = Array.from(c.querySelectorAll('button')).filter((b) => b.textContent === 'Làm ngay');
    expect(goButtons).toHaveLength(3);
    click(btn(c, 'Làm ngay').closest('div')!.querySelector('button')!);
    expect(state.push).toHaveBeenLastCalledWith('/san-pham');
    click(goButtons[1]!);
    expect(state.push).toHaveBeenLastCalledWith('/tai-khoan/don-hang?tab=delivered');
    click(goButtons[2]!);
    expect(state.push).toHaveBeenLastCalledWith('/tai-khoan/vi-tubu');
    expect(c.querySelector('[role="progressbar"][aria-label="Viết đánh giá: 0/3"]')).not.toBeNull();
  });

  it('đạt theo tiến độ dù server chưa đánh dấu completed vẫn cho nhận', async () => {
    state.data['/game/missions'] = [{ code: 'INVITE_3', title: 'Mời 3 bạn', rewardPoints: 5, progress: 3, goal: 3, completed: false, claimed: false }];
    const c = await mount();
    expect(btn(c, 'Nhận thưởng')).not.toBeNull();
  });
});

describe('Vườn Xanh: quiz Sống Xanh', () => {
  it('hết quiz: lời chúc hoàn thành', async () => {
    state.data['/game/quiz/today'] = [];
    const c = await mount();
    expect(c.textContent).toContain('Bạn đã hoàn thành câu đố hôm nay 🎉');
  });

  it('nhiều câu: nhãn phân loại, Câu n/N, trả lời gọi API đúng id và lựa chọn, khoá đáp án, Câu tiếp theo sang câu kế, câu cuối Hoàn thành', async () => {
    state.posts['/game/quiz/q1/answer'] = () => ({ isCorrect: false, correct: 1, waterEarned: 0, explanation: 'Tre lớn nhanh' });
    state.posts['/game/quiz/q2/answer'] = () => ({ isCorrect: true, correct: 0, waterEarned: 5, explanation: null });
    const c = await mount();
    expect(c.textContent).toContain('🌳 Cây cối · Vừa · Câu 1/2');
    expect(c.textContent).toContain('+10💧');
    const first = btn(c, 'Sưa');
    act(() => {
      first.click();
      first.click();
    });
    await flush(8);
    expect(postsOf('/game/quiz/q1/answer')).toHaveLength(1);
    expect(postsOf('/game/quiz/q1/answer')[0]!.body).toEqual({ choice: 0 });
    expect(c.textContent).toContain('Chưa đúng — cùng học nhé 🌿');
    expect(c.textContent).toContain('Bạn có biết: Tre lớn nhanh');
    expect(btn(c, 'Tre').disabled).toBe(true);
    click(btn(c, 'Câu tiếp theo'));
    await flush(4);
    expect(c.textContent).toContain('♻️ Tái chế · Dễ · Câu 2/2');
    click(btn(c, 'Chai nhựa'));
    await flush(6);
    expect(c.textContent).toContain('Chính xác! +5💧');
    click(btn(c, 'Hoàn thành'));
    await flush(4);
    expect(c.textContent).toContain('Bạn đã hoàn thành câu đố hôm nay 🎉');
  });

  it('lỗi gửi đáp án: báo lỗi, chưa hiện đáp án, đáp án bật lại; phân loại lạ rơi về Thiên nhiên', async () => {
    state.data['/game/quiz/today'] = [{ ...QUIZ[0]!, category: 'la' }];
    state.posts['/game/quiz/q1/answer'] = () => {
      throw new Error('Hết lượt');
    };
    const c = await mount();
    expect(c.textContent).toContain('🌿 Thiên nhiên');
    click(btn(c, 'Sưa'));
    await flush(6);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Hết lượt');
    expect(c.textContent).not.toContain('Bạn có biết');
    expect(btn(c, 'Sưa').disabled).toBe(false);
  });
});

describe('Vườn Xanh: vòng quay may mắn', () => {
  const spinNow = async (c: HTMLElement) => {
    vi.useFakeTimers();
    click(btn(c, 'Quay ngay'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });
    vi.useRealTimers();
    await flush(4);
  };

  it('giá quay lấy từ spinCostPoints; quay gọi POST /game/spin một lần và hộp kết quả hiện giải', async () => {
    state.data['/game/profile'] = PROFILE({ spinCostPoints: 15 });
    state.posts['/game/spin'] = () => ({ prize: { id: 'p', name: '+50 Điểm Xanh', rewardType: 'POINTS', value: 50 } });
    const c = await mount();
    expect(btn(c, 'Quay ngay').textContent).toBe('Quay ngay (15 Điểm Xanh)');
    await spinNow(c);
    expect(postsOf('/game/spin')).toHaveLength(1);
    const sheet = document.querySelector('[role="dialog"]')!;
    expect(sheet.textContent).toContain('Chúc mừng!');
    expect(sheet.textContent).toContain('+50 Điểm Xanh đã vào tài khoản');
  });

  it('API chưa trả spinCostPoints: giá vòng quay mặc định 10.000 điểm', async () => {
    state.data['/game/profile'] = PROFILE({ spinCostPoints: undefined });
    const c = await mount();
    expect(btn(c, 'Quay ngay').textContent).toBe('Quay ngay (10.000 Điểm Xanh)');
  });

  it('trúng voucher: "Dùng ngay" đóng hộp rồi sang /san-pham; không trúng thì "Tiếc quá!"', async () => {
    state.posts['/game/spin'] = () => ({ prize: { id: 'p', name: 'Voucher 20k', rewardType: 'COUPON', value: 0, coupon: { code: 'WHEEL20', minOrder: 99_000, expiresAt: '2026-11-16T16:59:59.000Z' } } });
    const c = await mount();
    await spinNow(c);
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(sheet.textContent).toContain('WHEEL20');
    expect(sheet.textContent).toContain('Đơn tối thiểu 99.000đ');
    expect(sheet.textContent).toContain('Hạn dùng 16/11/2026');
    click(btn(sheet, 'Dùng ngay'));
    expect(state.push).toHaveBeenCalledWith('/san-pham');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    state.posts['/game/spin'] = () => ({ prize: { id: 'm', name: 'Chúc may mắn', rewardType: 'NONE', value: 0 } });
    await spinNow(c);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Tiếc quá!');
  });

  it('quay lỗi: báo lỗi, không có hộp kết quả', async () => {
    state.posts['/game/spin'] = () => {
      throw new Error('Không đủ điểm');
    };
    const c = await mount();
    await spinNow(c);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain('Không đủ điểm');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('Vườn Xanh: tác động xanh', () => {
  it('số cây góp quỹ, giọt nước đã góp, tối đa 5 mã kèm trạng thái, số cây còn lại', async () => {
    const c = await mount();
    const eco = Array.from(c.querySelectorAll('h2')).find((h) => h.textContent === 'Tác động xanh của bạn')!.parentElement!;
    expect(eco.textContent).toContain('Cây đã góp quỹ');
    expect(eco.textContent).toContain('Giọt nước đã góp');
    expect(eco.textContent).toContain('Cảm ơn bạn! Bạn đã góp 7 cây vào quỹ trồng cây của Tubu 🌿');
    expect(eco.textContent).toContain('TT-5');
    expect(eco.textContent).not.toContain('TT-6');
    expect(eco.textContent).toContain('Đã trồng');
    expect(eco.textContent).toContain('Đã góp quỹ');
    expect(eco.textContent).toContain('…và 2 cây khác');
  });

  it('chưa góp cây nào: lời mời chăm cây', async () => {
    state.data['/game/forest'] = { count: 0, plantedCount: 0, trees: [] };
    const c = await mount();
    expect(c.textContent).toContain('Chăm cây ảo đến khi thu hoạch để Tubu góp 1 cây vào quỹ trồng cây.');
  });
});

describe('Vườn Xanh: thông báo nổi nằm trên hộp xác nhận', () => {
  const BUY = '/game/tree/buy';
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  it('góp quỹ lỗi khi hộp xác nhận còn mở: thông báo lỗi nằm ngoài trang, sau hộp trong body và z-index cao hơn hộp', async () => {
    state.posts[BUY] = () => {
      throw new Error('Không đủ Điểm Xanh');
    };
    const c = await mount();
    click(btn(c, 'Góp quỹ trồng cây'));
    click(btn(dialog()!, 'Xác nhận'));
    await flush(6);
    expect(dialog()).not.toBeNull();
    const alert = document.querySelector<HTMLElement>('[role="alert"]')!;
    expect(alert.textContent).toContain('Không đủ Điểm Xanh');
    expect(c.contains(alert)).toBe(false);
    const bar = alert.closest('body > *') as HTMLElement;
    const sheet = dialog()!.parentElement as HTMLElement;
    expect(sheet.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const z = (el: HTMLElement) => Number(/(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(el.className)?.[1]);
    expect(z(bar)).toBeGreaterThan(z(sheet));
  });

  it('thông báo đặt trên thanh đáy kể cả khi có vùng an toàn của iPhone', async () => {
    state.posts[BUY] = () => {
      throw new Error('lỗi');
    };
    const c = await mount();
    click(btn(c, 'Góp quỹ trồng cây'));
    click(btn(dialog()!, 'Xác nhận'));
    await flush(6);
    const bar = document.querySelector('[role="alert"]')!.closest('body > *') as HTMLElement;
    expect(bar.className).toContain('env(safe-area-inset-bottom)');
  });
});

describe('Vườn Xanh: khung rộng và thanh tab', () => {
  it('thanh tab dính dưới thanh đầu trang (đo chiều cao header), không dính mép 0', async () => {
    const header = document.createElement('header');
    header.getBoundingClientRect = () => ({ height: 112 }) as DOMRect;
    document.body.prepend(header);
    try {
      const c = await mount();
      const bar = c.querySelector<HTMLElement>('[role="tablist"]')!.closest('.sticky') as HTMLElement;
      expect(bar.style.top).toBe('112px');
      expect(bar.className).not.toContain('top-0');
    } finally {
      header.remove();
    }
  });

  it('từ lg khung rộng và tab đang mở chia hai cột; tab ẩn vẫn hidden; điện thoại một cột', async () => {
    const c = await mount();
    const frame = panel(c, 'Hôm nay').parentElement as HTMLElement;
    expect(frame.className).toContain('lg:max-w-5xl');
    expect(frame.className).toContain('max-w-2xl');
    expect(panel(c, 'Hôm nay').className).toContain('lg:grid-cols-2');
    expect(panel(c, 'Hôm nay').className).toContain('flex-col');
    expect(panel(c, 'Vườn').className).toBe('hidden');
  });
});

describe('Vườn Xanh: hành động đổi Điểm Xanh làm mới đúng khoá', () => {
  let spy: MockInstance<QueryClient['invalidateQueries']>;
  const keys = () => spy.mock.calls.map((a) => JSON.stringify(a[0]?.queryKey));
  const arm = () => {
    spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    spy.mockClear();
  };
  afterEach(() => spy?.mockRestore());

  it('điểm danh làm mới game, me, loyalty và lịch điểm danh', async () => {
    state.posts['/me/daily-check-in'] = () => ({ points: { success: true, cycleDay: 1, streakDays: 1, pointsEarned: 1000, totalPoints: 1000, message: '' }, water: { seedsEarned: 10, streakDays: 4, totalSeeds: 1260, streakFrozeUsed: false, bonusNote: '' }, alreadyDone: false, pending: [] });
    const c = await mount();
    arm();
    click(btn(c, 'Điểm danh'));
    await flush(6);
    expect(keys()).toEqual(expect.arrayContaining(['["game"]', '["me"]', '["loyalty"]', '["loyalty-checkin"]']));
  });

  it('tưới cây làm mới game, me và loyalty', async () => {
    state.data['/game/profile'] = PROFILE({ lastCheckInAt: todayIso() });
    state.posts['/game/tree/water'] = () => ({ progress: 620, target: 1000, harvested: false, treesPlanted: 2 });
    const c = await mount();
    arm();
    click(btn(c, 'Tưới hết (1.250💧)'));
    await flush(6);
    expect(keys()).toEqual(expect.arrayContaining(['["game"]', '["me"]', '["loyalty"]']));
  });

  it('góp quỹ trồng cây làm mới game, me và loyalty', async () => {
    state.posts['/game/tree/buy'] = () => ({ certificateCode: 'TT-99', treeType: 'Sưa', cost: 20_000, pointsUsed: 20_000, pointsUsedConverted: 0 });
    const c = await mount();
    click(btn(c, 'Góp quỹ trồng cây'));
    arm();
    click(btn(document.querySelector<HTMLElement>('[role="dialog"]')!, 'Xác nhận'));
    await flush(8);
    expect(keys()).toEqual(expect.arrayContaining(['["game"]', '["me"]', '["loyalty"]']));
  });

  it('quay vòng quay làm mới game, me và loyalty', async () => {
    state.posts['/game/spin'] = () => ({ prize: { id: 'p', name: '+50 Điểm Xanh', rewardType: 'POINTS', value: 50 } });
    const c = await mount();
    arm();
    vi.useFakeTimers();
    click(btn(c, 'Quay ngay'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3700);
    });
    vi.useRealTimers();
    await flush(4);
    expect(keys()).toEqual(expect.arrayContaining(['["game"]', '["me"]', '["loyalty"]']));
  });

  it('nhận nhiệm vụ làm mới nhiệm vụ, me và loyalty (số dư Điểm Xanh ở Thanh toán)', async () => {
    state.posts['/game/missions/REVIEW_3/claim'] = () => ({ claimed: true, rewardPoints: 30, couponCode: null });
    const c = await mount();
    arm();
    click(btn(c, 'Nhận thưởng'));
    await flush(6);
    expect(keys()).toEqual(expect.arrayContaining(['["game","missions"]', '["me"]', '["loyalty"]']));
  });
});

describe('Vườn Xanh: giao diện điện thoại như Mini App', () => {
  it('nút phụ (Mua vé giữ lửa, Hứng giọt sương, Góp quỹ) là nút ZaUI secondary ở điện thoại', async () => {
    const c = await mount();
    for (const label of ['Mua (', 'Hứng giọt sương', 'Góp quỹ trồng cây']) {
      const btn = Array.from(c.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
      expect(btn, label).toBeTruthy();
      expect(btn!.className, label).toContain('max-md:bg-forest-50');
    }
  });

  it('thẻ khối không viền; dòng lối vào là thẻ viền mảnh không bóng', async () => {
    state.config = { waste: { enabled: true } };
    state.wasteReady = true;
    const c = await mount();
    const sections = Array.from(c.querySelectorAll('section')).filter((s) => s.querySelector('h2'));
    expect(sections.length).toBeGreaterThan(2);
    expect(sections.filter((s) => s.classList.contains('border'))).toEqual([]);
    expect(c.querySelector('a[href="/doi-rac"]')!.className).toContain('max-md:shadow-none');
  });

  it('trang bỏ đệm đỉnh và tiêu đề nằm trên thanh trắng', async () => {
    const c = await mount();
    expect(c.querySelector('main')!.className).toContain('max-md:pt-0');
    expect(c.querySelector('h1')!.closest('header')!.className).toContain('max-md:bg-[var(--color-bg-surface)]');
  });
});

describe('Vườn Xanh: tiêu đề khối như Mini App', () => {
  it('tiêu đề khối cỡ title-sm ở điện thoại', async () => {
    const c = await mount();
    const h = Array.from(c.querySelectorAll('h2')).find((x) => x.textContent === 'Nhiệm vụ')!;
    expect(h.className).toContain('max-md:text-[length:var(--type-title-sm-size)]');
  });
});
