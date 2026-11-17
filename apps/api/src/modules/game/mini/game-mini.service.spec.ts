import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  MINI_GAME_IDS,
  MINI_GAME_RULES,
  MINI_MAX_ROUNDS_PER_GAME_PER_DAY,
  MINI_ROUND_TTL_MS,
  type MiniGameId,
  type MiniMatchCard,
  type MiniProductCard,
  type MiniRoundContent,
} from '@tubutree/shared-types';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
import type { LoyaltyService } from '../../loyalty/loyalty.service';
import type { AnalyticsEventsService } from '../../analytics/analytics-events.service';
import type { DailyCheckInService } from '../../daily-check-in/daily-check-in.service';
import type { GameMiniContentService } from './game-mini-content.service';
import type { GameMiniRewardService } from './game-mini-reward.service';
import { deviceHash, matchCardId, readGuestRound, signGuestRound } from './game-mini-crypto';
import { GameMiniService } from './game-mini.service';
import { miniGameFlagKey } from './game-mini.settings';
import type { MiniContentRow } from './games';

const SECRET = 'secret-service-spec-0123456789';
/** 10:00 giờ VN ngày 17/11/2026. */
const NOW = new Date('2026-11-17T03:00:00.000Z');
const DAY = '2026-11-17';
const REAL_USER = { zaloId: 'z-real-1', phone: null, createdAt: new Date('2026-01-01T00:00:00.000Z') };
const GUEST_USER = { zaloId: 'guest_x', phone: null, createdAt: new Date('2026-01-01T00:00:00.000Z') };

type UserRow = typeof REAL_USER | { zaloId: string | null; phone: string | null; createdAt: Date };
interface Fixture {
  rows: MiniContentRow[];
  products: Map<string, MiniProductCard>;
  sortHazardous: boolean;
}

const card = (slug: string, inStock = true): MiniProductCard => ({
  slug,
  name: `Sản phẩm ${slug}`,
  imageUrl: 'https://anh.example.vn/san-pham.jpg',
  price: 59_000,
  inStock,
});

const n2 = (i: number) => String(i).padStart(2, '0');
const mk = (game: MiniGameId, id: string, payload: unknown, over: Partial<MiniContentRow> = {}): MiniContentRow => ({
  id,
  game,
  payload,
  explanation: `LOI-GIAI-THICH-${id}`,
  sourceUrl: `https://nguon.example.vn/${id}`,
  productSlug: null,
  ...over,
});

/** Nội dung hợp lệ đủ 10 mục mỗi game (Giỏ Đúng Việc: một đề và 6 sản phẩm còn hàng). */
function buildFixtures(): Record<MiniGameId, Fixture> {
  const choice = (game: 'daily_quiz' | 'origin', slugPrefix: string, linked: number[]): Fixture => {
    const rows = Array.from({ length: 12 }, (_, k) => {
      const i = k + 1;
      return mk(
        game,
        `${game}-${n2(i)}`,
        { prompt: `Câu ${game} số ${i}?`, options: ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'], answer: i % 4 },
        linked.includes(i) ? { productSlug: `${slugPrefix}-${i}` } : {},
      );
    });
    return { rows, products: new Map(linked.map((i) => [`${slugPrefix}-${i}`, card(`${slugPrefix}-${i}`)] as const)), sortHazardous: false };
  };
  const slugs = ['gio-dung-1', 'gio-dung-2', 'gio-dung-3', 'gio-sai-1', 'gio-sai-2', 'gio-sai-3'];
  return {
    sort: {
      rows: Array.from({ length: 12 }, (_, k) =>
        mk('sort', `sort-${n2(k + 1)}`, { label: `Vật số ${k + 1}`, bin: ['recycle', 'food', 'other'][k % 3], emoji: '🧴' }),
      ),
      products: new Map(),
      sortHazardous: true,
    },
    daily_quiz: choice('daily_quiz', 'sp-quiz', [2, 5, 8, 11]),
    origin: choice('origin', 'sp-origin', [3, 6, 9]),
    match: {
      rows: Array.from({ length: 12 }, (_, k) => mk('match', `match-${n2(k + 1)}`, { ingredient: `Nguyên liệu số ${k + 1}`, use: `Công dụng số ${k + 1}` })),
      products: new Map(),
      sortHazardous: false,
    },
    basket: {
      rows: [
        mk('basket', 'basket-01', {
          task: 'Rửa bình sữa cho bé',
          correct: slugs.slice(0, 3),
          wrong: slugs.slice(3).map((slug, i) => ({ slug, reason: `LY-DO-SAI-${i + 1}` })),
        }),
      ],
      products: new Map(slugs.map((s) => [s, card(s)] as const)),
      sortHazardous: false,
    },
  };
}

interface WorldOpts {
  cfg?: Record<string, unknown>;
  user?: UserRow | null;
}

/** Bộ đồ giả cho GameMiniService: DB, cấu hình theo map khoá, kho nội dung dựng từ fixture (byIds tra theo id như bản thật). */
function makeWorld(opts: WorldOpts = {}) {
  const cfg: Record<string, unknown> = {
    'game.mini.enabled': true,
    ...Object.fromEntries(MINI_GAME_IDS.map((g) => [miniGameFlagKey(g), true])),
    ...(opts.cfg ?? {}),
  };
  const fx = buildFixtures();
  const config = { get: jest.fn(async (key: string, fallback?: unknown) => (key in cfg ? cfg[key] : fallback)) };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'u1' }]),
    gamePlayRound: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: { slot: number | null; [field: string]: any } }) => ({
        id: 'round-1',
        slot: data.slot,
        contentIds: data.contentIds,
        issuedAt: data.issuedAt,
        expiresAt: data.expiresAt,
        dayKey: data.dayKey,
      })),
    },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(opts.user === undefined ? REAL_USER : opts.user) },
    gamePlayRound: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    gameDailyLedger: { findUnique: jest.fn().mockResolvedValue(null) },
    gameGlobalDaily: { findUnique: jest.fn().mockResolvedValue(null) },
    gameProfile: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1', streakDays: 5 }), create: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const content = {
    pool: jest.fn(async (game: MiniGameId) => ({
      rows: fx[game].rows,
      products: fx[game].products,
      usableCount: fx[game].rows.length,
      available: true,
      sortHazardous: fx[game].sortHazardous,
    })),
    byIds: jest.fn(async (game: MiniGameId, ids: readonly string[]) => {
      const out: MiniContentRow[] = [];
      for (const id of ids) {
        const found = fx[game].rows.find((r) => r.id === id);
        if (!found) return null;
        out.push(found);
      }
      return out;
    }),
    products: jest.fn(async (slugs: readonly string[]) => {
      const all = new Map<string, MiniProductCard>(MINI_GAME_IDS.flatMap((g) => [...fx[g].products]));
      return new Map(slugs.filter((x) => all.has(x)).map((x) => [x, all.get(x)!] as const));
    }),
  };
  const reward = { settle: jest.fn().mockResolvedValue({ slot: 1, water: 10, points: 10, capped: [], totalSeeds: 90 }) };
  const loyalty = { pointsExpiresAt: jest.fn().mockResolvedValue(new Date('2027-11-17T00:00:00.000Z')) };
  const analytics = { recordBestEffort: jest.fn().mockResolvedValue(undefined) };
  const dailyCheckIn = {
    run: jest.fn().mockResolvedValue({ points: { delta: 1 }, water: { streakDays: 4 }, alreadyDone: false, pending: [] }),
  };
  const env = { get: jest.fn((key: string) => (key === 'JWT_ACCESS_SECRET' ? SECRET : undefined)) };
  const service = new GameMiniService(
    prisma as unknown as PrismaService,
    config as unknown as SystemConfigService,
    loyalty as unknown as LoyaltyService,
    env as unknown as ConfigService,
    content as unknown as GameMiniContentService,
    reward as unknown as GameMiniRewardService,
    analytics as unknown as AnalyticsEventsService,
    dailyCheckIn as unknown as DailyCheckInService,
  );
  return { service, fx, config, prisma, tx, content, reward, loyalty, analytics, dailyCheckIn };
}
type World = ReturnType<typeof makeWorld>;

async function httpError(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e;
    throw e;
  }
  throw new Error('Mong đợi HttpException nhưng lời gọi không ném lỗi');
}

async function expectMini(p: Promise<unknown>, status: number, code: string) {
  const e = await httpError(p);
  expect(e.getStatus()).toBe(status);
  expect(e.getResponse()).toMatchObject({ code });
}

function expectNoDbTouch(w: World) {
  expect(w.prisma.$transaction).not.toHaveBeenCalled();
  expect(w.tx.gamePlayRound.create).not.toHaveBeenCalled();
  expect(w.prisma.gamePlayRound.create).not.toHaveBeenCalled();
  expect(w.prisma.gamePlayRound.findUnique).not.toHaveBeenCalled();
  expect(w.prisma.user.findUnique).not.toHaveBeenCalled();
  expect(w.reward.settle).not.toHaveBeenCalled();
}

/** Ván đã lưu của tài khoản u1, phát 30 giây trước `NOW`, giữ ô thưởng số 1. */
function roundOf(w: World, game: MiniGameId, over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    userId: 'u1',
    game,
    dayKey: DAY,
    slot: 1,
    contentIds: w.fx[game].rows.slice(0, MINI_GAME_RULES[game].items).map((r) => r.id),
    issuedAt: new Date(NOW.getTime() - 30_000),
    expiresAt: new Date(NOW.getTime() + MINI_ROUND_TTL_MS - 30_000),
    submittedAt: null,
    ...over,
  };
}

/** Bài nộp bỏ trống đúng dạng của từng game: hợp lệ về hình dạng, 0 câu đúng. */
const BLANK: Record<MiniGameId, unknown[]> = {
  sort: Array(10).fill(null),
  daily_quiz: Array(3).fill(null),
  origin: Array(5).fill(null),
  match: [],
  basket: [],
};

const PERFECT: Record<MiniGameId, (rows: MiniContentRow[], roundKey: string) => unknown[]> = {
  sort: (rows) => rows.map((r) => (r.payload as { bin: string }).bin),
  daily_quiz: (rows) => rows.map((r) => (r.payload as { answer: number }).answer),
  origin: (rows) => rows.map((r) => (r.payload as { answer: number }).answer),
  match: (rows, key) => rows.map((r) => [matchCardId(SECRET, key, r.id, 'ingredient'), matchCardId(SECRET, key, r.id, 'use')]),
  basket: (rows) => (rows[0]!.payload as { correct: string[] }).correct,
};

/** Mọi khoá của mọi object lồng nhau (quét đệ quy qua mảng và object), kèm chính các object để kiểm cặp khoá. */
function scan(node: unknown, keys = new Set<string>(), objects: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) {
    for (const item of node) scan(item, keys, objects);
  } else if (node !== null && typeof node === 'object') {
    objects.push(node as Record<string, unknown>);
    for (const [k, v] of Object.entries(node)) {
      keys.add(k);
      scan(v, keys, objects);
    }
  }
  return { keys, objects };
}

const PRODUCT_KEYS = ['slug', 'name', 'imageUrl', 'price', 'inStock'];
/** Khoá JSON mà `content` của `start` được phép có, theo từng game. Khoá ngoài danh sách này là rò rỉ hoặc đổi hợp đồng. */
const KEY_WHITELIST: Record<MiniGameId, string[]> = {
  sort: ['game', 'bins', 'items', 'id', 'label', 'emoji'],
  daily_quiz: ['game', 'items', 'id', 'prompt', 'options', 'product', ...PRODUCT_KEYS],
  origin: ['game', 'items', 'id', 'prompt', 'options', 'product', ...PRODUCT_KEYS],
  match: ['game', 'cards', 'cardId', 'label', 'side'],
  basket: ['game', 'task', 'id', 'products', ...PRODUCT_KEYS],
};
/** Khoá mà fixture phải làm xuất hiện, để phép quét không "xanh vì rỗng". */
const KEYS_THAT_MUST_APPEAR: Record<MiniGameId, string[]> = {
  sort: ['bins', 'items', 'id', 'label', 'emoji'],
  daily_quiz: ['items', 'prompt', 'options', 'product', 'slug', 'price'],
  origin: ['items', 'prompt', 'options', 'product', 'slug', 'price'],
  match: ['cards', 'cardId', 'label', 'side'],
  basket: ['task', 'id', 'products', 'slug', 'price'],
};
const ANSWER_KEYS = ['answer', 'bin', 'correct', 'wrong', 'reason', 'expected', 'explanation', 'sourceUrl'];

describe('GameMiniService: cờ tắt thì 404 GAME_DISABLED', () => {
  it('today: cờ chung tắt', async () => {
    const w = makeWorld({ cfg: { 'game.mini.enabled': false } });
    await expectMini(w.service.today('u1', NOW), 404, 'GAME_DISABLED');
    expect(w.content.pool).not.toHaveBeenCalled();
    expect(w.prisma.gamePlayRound.findMany).not.toHaveBeenCalled();
  });

  it('today: chưa có khoá cờ chung trong DB (mặc định tắt) cũng 404', async () => {
    const w = makeWorld({ cfg: { 'game.mini.enabled': undefined } });
    await expectMini(w.service.today(null, NOW), 404, 'GAME_DISABLED');
  });

  it('start: cờ chung tắt, kể cả khi cờ game bật', async () => {
    const w = makeWorld({ cfg: { 'game.mini.enabled': false } });
    await expectMini(w.service.start('u1', 'sort', NOW), 404, 'GAME_DISABLED');
    expect(w.content.pool).not.toHaveBeenCalled();
    expectNoDbTouch(w);
  });

  it('submit: cờ chung tắt', async () => {
    const w = makeWorld({ cfg: { 'game.mini.enabled': false } });
    await expectMini(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW), 404, 'GAME_DISABLED');
    expectNoDbTouch(w);
  });

  it.each(MINI_GAME_IDS)('start và submit: cờ của riêng game %s tắt (cờ chung và game khác vẫn bật)', async (game) => {
    const w = makeWorld({ cfg: { [miniGameFlagKey(game)]: false } });
    await expectMini(w.service.start('u1', game, NOW), 404, 'GAME_DISABLED');
    await expectMini(w.service.start(null, game, NOW), 404, 'GAME_DISABLED');
    await expectMini(w.service.submit('u1', game, { roundId: 'r1', answers: BLANK[game] }, NOW), 404, 'GAME_DISABLED');
    await expectMini(w.service.submit(null, game, { token: 'm1.a.b', answers: BLANK[game] }, NOW), 404, 'GAME_DISABLED');
    expect(w.content.pool).not.toHaveBeenCalled();
    expectNoDbTouch(w);
  });

  it.each(['arcade', 'SORT', 'sort ', 'constructor', '__proto__', ''])('game lạ %j: 404 GAME_DISABLED như game tắt, không đọc cấu hình hay DB', async (game) => {
    const w = makeWorld();
    await expectMini(w.service.start('u1', game, NOW), 404, 'GAME_DISABLED');
    await expectMini(w.service.submit('u1', game, { roundId: 'r1', answers: [] }, NOW), 404, 'GAME_DISABLED');
    expect(w.config.get).not.toHaveBeenCalled();
    expect(w.content.pool).not.toHaveBeenCalled();
    expectNoDbTouch(w);
  });

  it('cờ bật bằng chuỗi "false" hoặc số 1 vẫn là tắt (chỉ true hoặc "true" mới bật)', async () => {
    const w = makeWorld({ cfg: { 'game.mini.enabled': 'false' } });
    await expectMini(w.service.start(null, 'sort', NOW), 404, 'GAME_DISABLED');
    const w2 = makeWorld({ cfg: { 'game.mini.enabled': 1 } });
    await expectMini(w2.service.start(null, 'sort', NOW), 404, 'GAME_DISABLED');
  });
});

describe('GameMiniService.today', () => {
  it('khách: chỉ liệt kê game đang bật và đủ nội dung, không thưởng (NOT_LOGGED_IN), lượt thưởng còn lại 0', async () => {
    const w = makeWorld({ cfg: { [miniGameFlagKey('origin')]: false } });
    w.content.pool.mockImplementation(async (game: MiniGameId) => ({
      rows: [],
      products: new Map(),
      usableCount: 0,
      available: game !== 'match',
      sortHazardous: false,
    }));
    const res = await w.service.today(null, NOW);
    expect(res.dayKey).toBe(DAY);
    expect(res.games.map((g) => g.game)).toEqual(['sort', 'daily_quiz', 'basket']);
    expect(res.rewardEligible).toBe(false);
    expect(res.noRewardReason).toBe('NOT_LOGGED_IN');
    for (const g of res.games) {
      expect(g.rewardedRoundsLeft).toBe(0);
      expect(g.items).toBe(MINI_GAME_RULES[g.game].items);
      expect(g.timeLimitMs).toBe(MINI_GAME_RULES[g.game].timeLimitMs);
    }
    expect(res.games.find((g) => g.game === 'daily_quiz')!.rewardedRoundsPerDay).toBe(1);
    expect(res.games.find((g) => g.game === 'sort')!.rewardedRoundsPerDay).toBe(2);
    expect(w.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(w.prisma.gamePlayRound.findMany).not.toHaveBeenCalled();
    expect(w.content.pool).not.toHaveBeenCalledWith('origin', DAY);
  });

  it('không trả nội dung hay đáp án nào', async () => {
    const w = makeWorld();
    const json = JSON.stringify(await w.service.today(null, NOW));
    expect(json).not.toContain('LOI-GIAI-THICH');
    expect(json).not.toContain('"answer"');
    expect(json).not.toContain('"items":[{"id"');
  });

  it('người thật: trừ ô đã giữ khỏi lượt còn lại, đếm ván đã nộp, báo Đố Xanh đã xong, trần tài khoản đã chạm', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findMany.mockResolvedValue([
      { game: 'sort', slot: 1, submittedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) },
      { game: 'sort', slot: null, submittedAt: null, expiresAt: new Date(NOW.getTime() + 60_000) },
      { game: 'daily_quiz', slot: 1, submittedAt: NOW, expiresAt: new Date(NOW.getTime() + 60_000) },
    ]);
    w.prisma.gameDailyLedger.findUnique.mockResolvedValue({ waterFromGames: 40, pointsFromGames: 10 });
    w.prisma.gameGlobalDaily.findUnique.mockResolvedValue({ pointsMinted: 200_000 });
    const res = await w.service.today('u1', NOW);
    expect(res.rewardEligible).toBe(true);
    expect(res.noRewardReason).toBeNull();
    const sort = res.games.find((g) => g.game === 'sort')!;
    expect(sort).toMatchObject({ rewardedRoundsPerDay: 2, rewardedRoundsLeft: 1, playedToday: 1 });
    expect(res.games.find((g) => g.game === 'daily_quiz')).toMatchObject({ rewardedRoundsLeft: 0, playedToday: 1 });
    expect(res.games.find((g) => g.game === 'match')).toMatchObject({ rewardedRoundsLeft: 2, playedToday: 0 });
    expect(res.dailyQuizDoneToday).toBe(true);
    expect(res.caps).toEqual({
      waterUsed: 40,
      waterCap: 40,
      pointsUsed: 10,
      pointsCap: 100,
      accountCapReached: true,
      pointsBudgetExhausted: true,
    });
  });

  it('ván bỏ dở đã quá hạn không còn giữ ô thưởng', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findMany.mockResolvedValue([
      { game: 'sort', slot: 1, submittedAt: null, expiresAt: new Date(NOW.getTime() - 1) },
      { game: 'sort', slot: 2, submittedAt: null, expiresAt: new Date(NOW.getTime() + 1) },
    ]);
    const res = await w.service.today('u1', NOW);
    expect(res.games.find((g) => g.game === 'sort')!.rewardedRoundsLeft).toBe(1);
  });

  it('tài khoản giả (zaloId guest_) không thưởng: NOT_REAL_USER, lượt còn lại 0', async () => {
    const w = makeWorld({ user: GUEST_USER });
    const res = await w.service.today('u1', NOW);
    expect(res.rewardEligible).toBe(false);
    expect(res.noRewardReason).toBe('NOT_REAL_USER');
    expect(res.games.every((g) => g.rewardedRoundsLeft === 0)).toBe(true);
  });
});

describe('GameMiniService.start: khách chưa đăng nhập', () => {
  it('trả roundId null và token ký, không thưởng (NOT_LOGGED_IN), và không ghi hay đọc DB', async () => {
    const w = makeWorld();
    const res = await w.service.start(null, 'sort', NOW);
    expect(res.roundId).toBeNull();
    expect(typeof res.token).toBe('string');
    expect(res.token!.length).toBeGreaterThan(10);
    expect(res.rewarded).toBe(false);
    expect(res.noRewardReason).toBe('NOT_LOGGED_IN');
    expect(res.game).toBe('sort');
    expect(res.issuedAt).toBe(NOW.toISOString());
    expect(res.expiresAt).toBe(new Date(NOW.getTime() + MINI_ROUND_TTL_MS).toISOString());
    expectNoDbTouch(w);
    expect(w.prisma.gameProfile.findUnique).not.toHaveBeenCalled();
  });

  it.each(MINI_GAME_IDS)('%s: token đọc lại được bằng đúng secret và khớp danh sách mục đã phát', async (game) => {
    const w = makeWorld();
    const res = await w.service.start(null, game, NOW);
    const guest = readGuestRound(res.token, SECRET)!;
    expect(guest.game).toBe(game);
    expect(guest.issuedAt).toBe(NOW.getTime());
    expect(guest.contentIds).toHaveLength(MINI_GAME_RULES[game].items);
    if (res.content.game === 'basket') expect(guest.contentIds).toEqual([res.content.task.id]);
    else if (res.content.game === 'match') expect(guest.contentIds).toHaveLength(res.content.cards.length / 2);
    else expect(guest.contentIds).toEqual(res.content.items.map((i) => i.id));
    expect(readGuestRound(res.token, 'secret-khac-hoan-toan')).toBeNull();
  });

  it('ghi sự kiện game_round_started của khách (userId null, không ô thưởng)', async () => {
    const w = makeWorld();
    await w.service.start(null, 'match', NOW);
    expect(w.analytics.recordBestEffort).toHaveBeenCalledWith({
      eventName: 'game_round_started',
      userId: null,
      platform: 'system',
      props: { game: 'match', slot: null, rewarded: false },
    });
  });
});

describe('GameMiniService.start: nội dung không lộ đáp án (test 7)', () => {
  describe.each([
    ['khách', null],
    ['tài khoản đăng nhập', 'u1'],
  ] as const)('%s', (_label, userId) => {
    it.each(MINI_GAME_IDS)('%s: tập khoá JSON của content nằm trong danh sách trắng và không có khoá đáp án', async (game) => {
      const w = makeWorld();
      const res = await w.service.start(userId, game, NOW);
      expect(res.content.game).toBe(game);
      const { keys, objects } = scan(res.content);

      expect([...keys].filter((k) => !KEY_WHITELIST[game].includes(k))).toEqual([]);
      for (const must of KEYS_THAT_MUST_APPEAR[game]) expect(keys).toContain(must);
      for (const forbidden of ANSWER_KEYS) expect(keys).not.toContain(forbidden);
      // "use" chỉ nguy hiểm khi đi cùng "ingredient" trong một object (payload gốc của Ghép Cặp); thẻ phát đi chỉ có side.
      expect(objects.filter((o) => 'ingredient' in o && 'use' in o)).toEqual([]);
      expect(keys).not.toContain('ingredient');
      expect(keys).not.toContain('use');
    });

    it.each(MINI_GAME_IDS)('%s: chuỗi JSON không chứa lời giải thích, nguồn hay lý do của bất kỳ mục nào', async (game) => {
      const w = makeWorld();
      const json = JSON.stringify((await w.service.start(userId, game, NOW)).content);
      for (const r of w.fx[game].rows) {
        expect(json).not.toContain(r.explanation);
        expect(json).not.toContain(r.sourceUrl);
      }
      expect(json).not.toContain('LY-DO-SAI');
      if (game === 'match') for (const r of w.fx.match.rows) expect(json).not.toContain(r.id);
    });
  });

});

describe('GameMiniService.start: tài khoản đăng nhập', () => {
  it('người thật còn lượt: giữ ô thưởng số 1, ghi ván với đúng danh sách mục, trả roundId và không trả token', async () => {
    const w = makeWorld();
    const res = await w.service.start('u1', 'sort', NOW);
    expect(res).toMatchObject({ game: 'sort', roundId: 'round-1', token: null, rewarded: true, noRewardReason: null });
    const data = w.tx.gamePlayRound.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ userId: 'u1', game: 'sort', dayKey: DAY, slot: 1, issuedAt: NOW });
    expect(data.expiresAt).toEqual(new Date(NOW.getTime() + MINI_ROUND_TTL_MS));
    if (res.content.game !== 'sort') throw new Error('sai game');
    expect(data.contentIds).toEqual(res.content.items.map((i) => i.id));
    expect(w.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(w.tx.gamePlayRound.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', game: 'sort', dayKey: DAY, slot: { not: null }, submittedAt: null, expiresAt: { lte: NOW } },
      data: { slot: null },
    });
    expect(w.analytics.recordBestEffort).toHaveBeenCalledWith({
      eventName: 'game_round_started',
      userId: 'u1',
      platform: 'system',
      props: { game: 'sort', slot: 1, rewarded: true },
    });
  });

  it('ô đã giữ thì lấy ô trống nhỏ nhất kế tiếp; hết ô thì ván không thưởng (NO_REWARDED_ROUNDS_LEFT) nhưng vẫn lưu', async () => {
    const w = makeWorld();
    w.tx.gamePlayRound.findMany.mockResolvedValue([{ slot: 1 }]);
    expect((await w.service.start('u1', 'sort', NOW)).rewarded).toBe(true);
    expect(w.tx.gamePlayRound.create.mock.calls[0]![0].data.slot).toBe(2);

    w.tx.gamePlayRound.create.mockClear();
    w.tx.gamePlayRound.findMany.mockResolvedValue([{ slot: 1 }, { slot: 2 }]);
    const full = await w.service.start('u1', 'sort', NOW);
    expect(full).toMatchObject({ rewarded: false, noRewardReason: 'NO_REWARDED_ROUNDS_LEFT', roundId: 'round-1' });
    expect(w.tx.gamePlayRound.create.mock.calls[0]![0].data.slot).toBeNull();
  });

  it('Đố Xanh: chỉ 1 ô thưởng mỗi ngày dù cấu hình cho 2 ván', async () => {
    const w = makeWorld({ cfg: { 'game.mini.rounds_per_game_per_day': 2 } });
    w.tx.gamePlayRound.findMany.mockResolvedValue([{ slot: 1 }]);
    const res = await w.service.start('u1', 'daily_quiz', NOW);
    expect(res).toMatchObject({ rewarded: false, noRewardReason: 'NO_REWARDED_ROUNDS_LEFT' });
    expect(w.tx.gamePlayRound.create.mock.calls[0]![0].data.slot).toBeNull();
  });

  it('cấu hình 0 ván có thưởng: ván vẫn phát nhưng không giữ ô', async () => {
    const w = makeWorld({ cfg: { 'game.mini.rounds_per_game_per_day': 0 } });
    const res = await w.service.start('u1', 'sort', NOW);
    expect(res).toMatchObject({ rewarded: false, noRewardReason: 'NO_REWARDED_ROUNDS_LEFT' });
    expect(w.tx.gamePlayRound.updateMany).not.toHaveBeenCalled();
  });

  it('tài khoản giả (zaloId guest_): ván vẫn lưu, không giữ ô thưởng, lý do NOT_REAL_USER', async () => {
    const w = makeWorld({ user: GUEST_USER });
    const res = await w.service.start('u1', 'sort', NOW);
    expect(res).toMatchObject({ roundId: 'round-1', rewarded: false, noRewardReason: 'NOT_REAL_USER' });
    expect(w.tx.gamePlayRound.create.mock.calls[0]![0].data.slot).toBeNull();
  });

  it('tài khoản mới hơn mức tối thiểu: ACCOUNT_TOO_NEW', async () => {
    const w = makeWorld({
      cfg: { 'game.mini.min_account_age_hours': 24 },
      user: { zaloId: 'z-real-2', phone: null, createdAt: new Date(NOW.getTime() - 3_600_000) },
    });
    const res = await w.service.start('u1', 'sort', NOW);
    expect(res).toMatchObject({ rewarded: false, noRewardReason: 'ACCOUNT_TOO_NEW' });
  });

  it('đủ 60 ván bắt đầu trong ngày thì 429 ROUND_LIMIT và không ghi ván', async () => {
    const w = makeWorld();
    w.tx.gamePlayRound.count.mockResolvedValue(MINI_MAX_ROUNDS_PER_GAME_PER_DAY);
    await expectMini(w.service.start('u1', 'sort', NOW), 429, 'ROUND_LIMIT');
    expect(w.tx.gamePlayRound.create).not.toHaveBeenCalled();
  });

  it('còn ván chưa nộp, chưa hết hạn của game này: trả lại đúng ván đó (cùng mục, cùng ô), không ghi ván mới', async () => {
    const w = makeWorld();
    const ids = w.fx.sort.rows.slice(0, 10).map((r) => r.id);
    const issuedAt = new Date(NOW.getTime() - 60_000);
    w.tx.gamePlayRound.findFirst.mockResolvedValue({
      id: 'open-1',
      slot: 1,
      contentIds: ids,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + MINI_ROUND_TTL_MS),
      dayKey: DAY,
    });
    const res = await w.service.start('u1', 'sort', NOW);
    expect(res).toMatchObject({ roundId: 'open-1', rewarded: true, issuedAt: issuedAt.toISOString() });
    if (res.content.game !== 'sort') throw new Error('sai game');
    expect(res.content.items.map((i) => i.id)).toEqual(ids);
    expect(w.tx.gamePlayRound.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', game: 'sort', submittedAt: null, expiresAt: { gt: NOW } } }),
    );
    expect(w.tx.gamePlayRound.create).not.toHaveBeenCalled();
  });

  it('kho thiếu nội dung: 404 GAME_NO_CONTENT, không ghi ván', async () => {
    const w = makeWorld();
    w.content.pool.mockResolvedValue({ rows: [], products: new Map(), usableCount: 0, available: false, sortHazardous: false });
    await expectMini(w.service.start('u1', 'sort', NOW), 404, 'GAME_NO_CONTENT');
    expectNoDbTouch(w);
  });

  it('kho báo đủ nhưng chọn không ra mục (vd còn 5 vật Đúng Thùng): 404 GAME_NO_CONTENT', async () => {
    const w = makeWorld();
    w.content.pool.mockResolvedValue({ rows: buildFixtures().sort.rows.slice(0, 5), products: new Map(), usableCount: 5, available: true, sortHazardous: false });
    await expectMini(w.service.start(null, 'sort', NOW), 404, 'GAME_NO_CONTENT');
    await expectMini(w.service.start('u1', 'sort', NOW), 404, 'GAME_NO_CONTENT');
  });

  it('Ghép Cặp: mã thẻ phát đi suy từ id ván đã lưu (để lúc nộp chấm lại được)', async () => {
    const w = makeWorld();
    const res = await w.service.start('u1', 'match', NOW);
    if (res.content.game !== 'match') throw new Error('sai game');
    const ids = w.tx.gamePlayRound.create.mock.calls[0]![0].data.contentIds as string[];
    const expected = ids.flatMap((id) => [matchCardId(SECRET, 'round-1', id, 'ingredient'), matchCardId(SECRET, 'round-1', id, 'use')]);
    expect(res.content.cards.map((c) => c.cardId).sort()).toEqual(expected.sort());
  });
});

describe('GameMiniService.submit: lỗi và không bao giờ chấm thưởng', () => {
  it('thiếu cả roundId lẫn token: 400 ROUND_TOKEN_INVALID', async () => {
    const w = makeWorld();
    await expectMini(w.service.submit('u1', 'sort', { answers: BLANK.sort }, NOW), 400, 'ROUND_TOKEN_INVALID');
    await expectMini(w.service.submit(null, 'sort', { roundId: null, token: null, answers: [] }, NOW), 400, 'ROUND_TOKEN_INVALID');
    await expectMini(w.service.submit('u1', 'sort', { roundId: '', token: '', answers: [] }, NOW), 400, 'ROUND_TOKEN_INVALID');
    expect(w.reward.settle).not.toHaveBeenCalled();
    expect(w.prisma.gamePlayRound.findUnique).not.toHaveBeenCalled();
  });

  it('có roundId mà không có tài khoản: 401 LOGIN_REQUIRED, không tra ván', async () => {
    const w = makeWorld();
    await expectMini(w.service.submit(null, 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW), 401, 'LOGIN_REQUIRED');
    expect(w.prisma.gamePlayRound.findUnique).not.toHaveBeenCalled();
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('ván không tồn tại: 404 ROUND_NOT_FOUND', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(null);
    await expectMini(w.service.submit('u1', 'sort', { roundId: 'khong-co', answers: BLANK.sort }, NOW), 404, 'ROUND_NOT_FOUND');
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('ván của người khác trả cùng mã và cùng câu với ván không có (không lộ id ván tồn tại)', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort', { userId: 'nguoi-khac' }));
    const other = await httpError(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW));
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(null);
    const missing = await httpError(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW));
    expect(other.getStatus()).toBe(404);
    expect(other.getResponse()).toMatchObject({ code: 'ROUND_NOT_FOUND' });
    expect(other.getResponse()).toEqual(missing.getResponse());
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('ván của game khác (nộp nhầm đường dẫn game): cũng 404 ROUND_NOT_FOUND', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'match'));
    await expectMini(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW), 404, 'ROUND_NOT_FOUND');
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('ván đã nộp: 409 ROUND_SUBMITTED', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort', { submittedAt: new Date(NOW.getTime() - 1000) }));
    await expectMini(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW), 409, 'ROUND_SUBMITTED');
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('nộp dưới 5 giây: 400 ROUND_TOO_FAST', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort', { issuedAt: new Date(NOW.getTime() - 4_999) }));
    await expectMini(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW), 400, 'ROUND_TOO_FAST');
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('nộp quá 10 phút: 400 ROUND_EXPIRED', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort', { issuedAt: new Date(NOW.getTime() - MINI_ROUND_TTL_MS - 1) }));
    await expectMini(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW), 400, 'ROUND_EXPIRED');
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('đúng mốc 5 giây và đúng mốc 10 phút vẫn chấm (biên không bị chặn nhầm)', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort', { issuedAt: new Date(NOW.getTime() - 5_000) }));
    await expect(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW)).resolves.toMatchObject({ durationMs: 5_000 });
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort', { issuedAt: new Date(NOW.getTime() - MINI_ROUND_TTL_MS) }));
    await expect(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW)).resolves.toMatchObject({ durationMs: MINI_ROUND_TTL_MS });
  });

  it.each([
    ['sai độ dài', ['recycle']],
    ['thùng lạ', [...BLANK.sort.slice(1), 'plastic']],
    ['không phải mảng phần tử hợp lệ', Array(10).fill(7)],
  ])('answers sai dạng (%s): 400 ANSWERS_INVALID, không chấm thưởng', async (_n, answers) => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort'));
    await expectMini(w.service.submit('u1', 'sort', { roundId: 'r1', answers }, NOW), 400, 'ANSWERS_INVALID');
    expect(w.reward.settle).not.toHaveBeenCalled();
    expect(w.analytics.recordBestEffort).not.toHaveBeenCalled();
  });

  it('Ghép Cặp: thẻ lạ hoặc thẻ dùng lại là sai dạng (400), không phải trả lời sai', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'match'));
    const known = matchCardId(SECRET, 'r1', 'match-01', 'ingredient');
    await expectMini(w.service.submit('u1', 'match', { roundId: 'r1', answers: [[known, 'the-la']] }, NOW), 400, 'ANSWERS_INVALID');
    await expectMini(w.service.submit('u1', 'match', { roundId: 'r1', answers: [[known, matchCardId(SECRET, 'r1', 'match-01', 'use')], [known, matchCardId(SECRET, 'r1', 'match-02', 'use')]] }, NOW), 400, 'ANSWERS_INVALID');
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('mục của ván không còn đọc được (byIds trả null): 404 GAME_NO_CONTENT, không chấm thưởng', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort'));
    w.content.byIds.mockResolvedValue(null);
    await expectMini(w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW), 404, 'GAME_NO_CONTENT');
    expect(w.reward.settle).not.toHaveBeenCalled();
  });

  it('khi có cả roundId lẫn token thì đi đường ván đã lưu (token bị bỏ qua)', async () => {
    const w = makeWorld();
    await expectMini(w.service.submit(null, 'sort', { roundId: 'r1', token: 'm1.a.b', answers: [] }, NOW), 401, 'LOGIN_REQUIRED');
  });
});

describe('GameMiniService.submit: người dùng thật, ván đã lưu', () => {
  it('chấm theo mục đã phát, tính thưởng cơ bản, gọi settle đúng một lần với đủ tham số và trả kết quả của settle', async () => {
    const w = makeWorld();
    const round = roundOf(w, 'sort');
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(round);
    w.reward.settle.mockResolvedValue({ slot: 1, water: 7, points: 10, capped: ['account_water'], totalSeeds: 123 });
    const answers = PERFECT.sort(w.fx.sort.rows.slice(0, 10), 'r1');
    const res = await w.service.submit('u1', 'sort', { roundId: 'r1', answers, deviceId: 'thiet-bi-abcdef12' }, NOW);

    expect(w.reward.settle).toHaveBeenCalledTimes(1);
    expect(w.reward.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        roundId: 'r1',
        userId: 'u1',
        game: 'sort',
        dayKey: DAY,
        now: NOW,
        correct: 10,
        total: 10,
        correctIds: round.contentIds,
        base: { water: 10, points: 10 },
        deviceHash: deviceHash(SECRET, 'thiet-bi-abcdef12'),
        pointsExpiresAt: new Date('2027-11-17T00:00:00.000Z'),
        settings: expect.objectContaining({ waterCap: 40, pointsCap: 100, accountsPerDevice: 2, globalBudget: 200_000, tankCapacity: 1000 }),
      }),
    );
    expect(w.loyalty.pointsExpiresAt).toHaveBeenCalledWith(NOW);
    expect(res).toMatchObject({
      game: 'sort',
      roundId: 'r1',
      correct: 10,
      total: 10,
      durationMs: 30_000,
      rewarded: true,
      noRewardReason: null,
      baseWater: 10,
      basePoints: 10,
      water: 7,
      points: 10,
      capped: ['account_water'],
      totalSeeds: 123,
      checkIn: null,
    });
    expect(res.review.game).toBe('sort');
    expect(res.review.items).toHaveLength(10);
    expect(w.analytics.recordBestEffort).toHaveBeenCalledWith({
      eventName: 'game_round_completed',
      userId: 'u1',
      platform: 'system',
      props: { game: 'sort', correct: 10, total: 10, durationMs: 30_000, water: 7, points: 10, capped: ['account_water'], rewarded: true },
    });
    expect(w.analytics.recordBestEffort).toHaveBeenCalledWith({
      eventName: 'game_cap_hit',
      userId: 'u1',
      platform: 'system',
      props: { game: 'sort', cap: 'account_water' },
    });
  });

  it('không gửi deviceId thì deviceHash là null', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort'));
    await w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW);
    expect(w.reward.settle.mock.calls[0]![0].deviceHash).toBeNull();
  });

  it('ván không có ô thưởng (slot null): thưởng cơ bản 0, không tính hạn điểm; kết quả NO_REWARDED_ROUNDS_LEFT', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort', { slot: null }));
    w.reward.settle.mockResolvedValue({ slot: null, water: 0, points: 0, capped: [], totalSeeds: null });
    const res = await w.service.submit('u1', 'sort', { roundId: 'r1', answers: PERFECT.sort(w.fx.sort.rows.slice(0, 10), 'r1') }, NOW);
    expect(w.reward.settle.mock.calls[0]![0].base).toEqual({ water: 0, points: 0 });
    expect(w.loyalty.pointsExpiresAt).not.toHaveBeenCalled();
    expect(res).toMatchObject({ rewarded: false, noRewardReason: 'NO_REWARDED_ROUNDS_LEFT', baseWater: 0, basePoints: 0, correct: 10 });
  });

  it('chỉ đúng một phần: thưởng nước theo số câu, chưa đủ 80% thì không có điểm và không tính hạn điểm', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort'));
    const answers = PERFECT.sort(w.fx.sort.rows.slice(0, 10), 'r1').map((a, i) => (i < 5 ? a : null));
    const res = await w.service.submit('u1', 'sort', { roundId: 'r1', answers }, NOW);
    expect(res).toMatchObject({ correct: 5, total: 10, baseWater: 9, basePoints: 0 });
    expect(w.reward.settle.mock.calls[0]![0].base).toEqual({ water: 9, points: 0 });
    expect(w.loyalty.pointsExpiresAt).not.toHaveBeenCalled();
  });

  it.each(MINI_GAME_IDS)('%s: nộp đáp án đúng hết thì chấm đủ, mã thẻ và danh sách mục khớp với ván đã phát', async (game) => {
    const w = makeWorld();
    const round = roundOf(w, game);
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(round);
    const rows = round.contentIds.map((id) => w.fx[game].rows.find((r) => r.id === id)!);
    const res = await w.service.submit('u1', game, { roundId: 'r1', answers: PERFECT[game](rows, 'r1') }, NOW);
    expect(res.correct).toBe(MINI_GAME_RULES[game].items === 1 ? 3 : MINI_GAME_RULES[game].items);
    expect(res.review.game).toBe(game);
    expect(w.reward.settle).toHaveBeenCalledTimes(1);
  });
});

describe('GameMiniService.submit: người dùng không thật', () => {
  it('zaloId guest_x không có SĐT: vẫn gọi settle nhưng với base {water:0, points:0} dù ván giữ ô thưởng', async () => {
    const w = makeWorld({ user: GUEST_USER });
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort', { slot: 1 }));
    w.reward.settle.mockResolvedValue({ slot: 1, water: 0, points: 0, capped: [], totalSeeds: null });
    const res = await w.service.submit('u1', 'sort', { roundId: 'r1', answers: PERFECT.sort(w.fx.sort.rows.slice(0, 10), 'r1') }, NOW);
    expect(w.reward.settle).toHaveBeenCalledTimes(1);
    expect(w.reward.settle.mock.calls[0]![0].base).toEqual({ water: 0, points: 0 });
    expect(w.loyalty.pointsExpiresAt).not.toHaveBeenCalled();
    expect(res).toMatchObject({ rewarded: false, noRewardReason: 'NOT_REAL_USER', baseWater: 0, basePoints: 0, correct: 10 });
  });

  it('không tạo hồ sơ Vườn Xanh cho tài khoản không thật (không có nước để cộng)', async () => {
    const w = makeWorld({ user: GUEST_USER });
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort'));
    await w.service.submit('u1', 'sort', { roundId: 'r1', answers: BLANK.sort }, NOW);
    expect(w.prisma.gameProfile.findUnique).not.toHaveBeenCalled();
    expect(w.prisma.gameProfile.create).not.toHaveBeenCalled();
  });

  it('có SĐT thì là người thật dù zaloId mang tiền tố guest_', async () => {
    const w = makeWorld({ user: { zaloId: 'guest_x', phone: '0901234567', createdAt: GUEST_USER.createdAt } });
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'sort'));
    await w.service.submit('u1', 'sort', { roundId: 'r1', answers: PERFECT.sort(w.fx.sort.rows.slice(0, 10), 'r1') }, NOW);
    expect(w.reward.settle.mock.calls[0]![0].base).toEqual({ water: 10, points: 10 });
  });
});

describe('GameMiniService.submit: điểm danh sau Đố Xanh', () => {
  const submitQuiz = (w: World, answers: unknown[] = BLANK.daily_quiz) => {
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'daily_quiz'));
    return w.service.submit('u1', 'daily_quiz', { roundId: 'r1', answers }, NOW);
  };

  it('Đố Xanh của người thật: gọi dailyCheckIn.run đúng 1 lần với userId, mỗi lần nộp một lần', async () => {
    const w = makeWorld();
    await submitQuiz(w);
    expect(w.dailyCheckIn.run).toHaveBeenCalledTimes(1);
    expect(w.dailyCheckIn.run).toHaveBeenCalledWith('u1');
    await submitQuiz(w);
    expect(w.dailyCheckIn.run).toHaveBeenCalledTimes(2);
  });

  it.each(MINI_GAME_IDS.filter((g) => g !== 'daily_quiz'))('%s không gọi dailyCheckIn.run và checkIn là null', async (game) => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, game));
    const res = await w.service.submit('u1', game, { roundId: 'r1', answers: BLANK[game] }, NOW);
    expect(w.dailyCheckIn.run).not.toHaveBeenCalled();
    expect(res.checkIn).toBeNull();
  });

  it('điểm danh mới xong lần này: done, newlyCheckedIn, chuỗi ngày lấy từ kết quả Vườn Xanh', async () => {
    const w = makeWorld();
    const res = await submitQuiz(w);
    expect(res.checkIn).toEqual({ done: true, newlyCheckedIn: true, streakDays: 4 });
  });

  it('đã điểm danh từ trước: done nhưng không phải lần đầu, chuỗi ngày đọc từ hồ sơ game', async () => {
    const w = makeWorld();
    w.dailyCheckIn.run.mockResolvedValue({ points: null, water: null, alreadyDone: true, pending: [] });
    const res = await submitQuiz(w);
    expect(res.checkIn).toEqual({ done: true, newlyCheckedIn: false, streakDays: 5 });
    expect(w.prisma.gameProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'u1' }, select: { streakDays: true } });
  });

  it('còn phần thiếu (pending không rỗng): done false', async () => {
    const w = makeWorld();
    w.dailyCheckIn.run.mockResolvedValue({ points: { delta: 1 }, water: null, alreadyDone: false, pending: ['water'] });
    const res = await submitQuiz(w);
    expect(res.checkIn).toMatchObject({ done: false, newlyCheckedIn: true });
  });

  it('dailyCheckIn.run ném lỗi: checkIn {done:false,...}, submit vẫn trả kết quả và đã settle', async () => {
    const w = makeWorld();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    w.dailyCheckIn.run.mockRejectedValue(new Error('cổng điểm danh sập'));
    const res = await submitQuiz(w);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('điểm danh chưa xong'));
    warn.mockRestore();
    expect(res.checkIn).toEqual({ done: false, newlyCheckedIn: false, streakDays: null });
    expect(res.roundId).toBe('r1');
    expect(w.reward.settle).toHaveBeenCalledTimes(1);
    expect(w.analytics.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ eventName: 'game_round_completed' }));
  });

  it('người không thật làm Đố Xanh: không điểm danh (Điểm Xanh chỉ dành cho tài khoản Zalo thật)', async () => {
    const w = makeWorld({ user: GUEST_USER });
    const res = await submitQuiz(w);
    expect(w.dailyCheckIn.run).not.toHaveBeenCalled();
    expect(res.checkIn).toBeNull();
  });

  it('ván không còn ô thưởng nhưng là người thật: vẫn điểm danh (điểm danh không phụ thuộc ô thưởng)', async () => {
    const w = makeWorld();
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'daily_quiz', { slot: null }));
    w.reward.settle.mockResolvedValue({ slot: null, water: 0, points: 0, capped: [], totalSeeds: null });
    const res = await w.service.submit('u1', 'daily_quiz', { roundId: 'r1', answers: BLANK.daily_quiz }, NOW);
    expect(w.dailyCheckIn.run).toHaveBeenCalledTimes(1);
    expect(res.checkIn).not.toBeNull();
  });

  it('điểm danh chỉ chạy sau khi settle xong (không điểm danh cho ván bị từ chối)', async () => {
    const w = makeWorld();
    w.reward.settle.mockRejectedValue(new Error('ván đã nộp ở nơi khác'));
    w.prisma.gamePlayRound.findUnique.mockResolvedValue(roundOf(w, 'daily_quiz'));
    await expect(w.service.submit('u1', 'daily_quiz', { roundId: 'r1', answers: BLANK.daily_quiz }, NOW)).rejects.toThrow('ván đã nộp');
    expect(w.dailyCheckIn.run).not.toHaveBeenCalled();
  });
});

describe('GameMiniService.submit: khách nộp bằng token', () => {
  const startGuest = async (w: World, game: MiniGameId) => {
    const res = await w.service.start(null, game, NOW);
    return { res, token: res.token!, guest: readGuestRound(res.token, SECRET)! };
  };
  const later = (ms: number) => new Date(NOW.getTime() + ms);

  it.each(MINI_GAME_IDS)('%s: khứ hồi start → submit chấm được, không ghi DB, không thưởng, không gọi settle', async (game) => {
    const w = makeWorld();
    const { token, guest } = await startGuest(w, game);
    const rows = guest.contentIds.map((id) => w.fx[game].rows.find((r) => r.id === id)!);
    const answers = PERFECT[game](rows, guest.nonce);
    const res = await w.service.submit(null, game, { token, answers }, later(10_000));
    expect(res).toMatchObject({
      game,
      roundId: null,
      rewarded: false,
      noRewardReason: 'NOT_LOGGED_IN',
      baseWater: 0,
      basePoints: 0,
      water: 0,
      points: 0,
      capped: [],
      totalSeeds: null,
      checkIn: null,
      durationMs: 10_000,
    });
    expect(res.correct).toBe(game === 'basket' ? 3 : MINI_GAME_RULES[game].items);
    expect(res.review.game).toBe(game);
    expect(w.reward.settle).not.toHaveBeenCalled();
    expect(w.tx.gamePlayRound.create).not.toHaveBeenCalled();
    expect(w.prisma.gamePlayRound.findUnique).not.toHaveBeenCalled();
    expect(w.dailyCheckIn.run).not.toHaveBeenCalled();
  });

  it('Ghép Cặp: ghép theo nhãn trên thẻ đã phát (không biết id) cho đủ 6 cặp đúng, nghĩa là nonce trong token dùng lại được', async () => {
    const w = makeWorld();
    const { res, token, guest } = await startGuest(w, 'match');
    if (res.content.game !== 'match') throw new Error('sai game');
    const cards: MiniMatchCard[] = res.content.cards;
    const pairs = guest.contentIds.map((id) => {
      const p = w.fx.match.rows.find((r) => r.id === id)!.payload as { ingredient: string; use: string };
      return [cards.find((c) => c.side === 'ingredient' && c.label === p.ingredient)!.cardId, cards.find((c) => c.side === 'use' && c.label === p.use)!.cardId];
    });
    const out = await w.service.submit(null, 'match', { token, answers: pairs }, later(20_000));
    expect(out.correct).toBe(6);
  });

  it('người đã đăng nhập nhưng nộp bằng token khách: vẫn không thưởng, không settle, ghi sự kiện theo userId', async () => {
    const w = makeWorld();
    const { token } = await startGuest(w, 'sort');
    const res = await w.service.submit('u1', 'sort', { token, answers: BLANK.sort }, later(10_000));
    expect(res).toMatchObject({ roundId: null, rewarded: false, noRewardReason: 'NOT_LOGGED_IN' });
    expect(w.reward.settle).not.toHaveBeenCalled();
    expect(w.analytics.recordBestEffort).toHaveBeenCalledWith({
      eventName: 'game_round_completed',
      userId: 'u1',
      platform: 'system',
      props: { game: 'sort', correct: 0, total: 10, durationMs: 10_000, water: 0, points: 0, capped: [], rewarded: false },
    });
  });

  it('token của game khác: 400 ROUND_TOKEN_INVALID', async () => {
    const w = makeWorld();
    const { token } = await startGuest(w, 'sort');
    await expectMini(w.service.submit(null, 'origin', { token, answers: BLANK.origin }, later(10_000)), 400, 'ROUND_TOKEN_INVALID');
  });

  it('token bị sửa hoặc ký bằng secret khác hoặc không phải chuỗi mã: 400 ROUND_TOKEN_INVALID', async () => {
    const w = makeWorld();
    const { token } = await startGuest(w, 'sort');
    const [v, body, sig] = token.split('.') as [string, string, string];
    const tampered = `${v}.${body.slice(0, -1)}${body.endsWith('A') ? 'B' : 'A'}.${sig}`;
    const foreign = signGuestRound({ game: 'sort', issuedAt: NOW.getTime(), contentIds: ['sort-01'] }, 'secret-khac-hoan-toan').token;
    for (const bad of [tampered, foreign, 'khong-phai-token']) {
      await expectMini(w.service.submit(null, 'sort', { token: bad, answers: BLANK.sort }, later(10_000)), 400, 'ROUND_TOKEN_INVALID');
    }
    expect(w.content.byIds).not.toHaveBeenCalled();
  });

  it('nộp dưới 5 giây: 400 ROUND_TOO_FAST; quá 10 phút: 400 ROUND_EXPIRED', async () => {
    const w = makeWorld();
    const { token } = await startGuest(w, 'sort');
    await expectMini(w.service.submit(null, 'sort', { token, answers: BLANK.sort }, later(4_999)), 400, 'ROUND_TOO_FAST');
    await expectMini(w.service.submit(null, 'sort', { token, answers: BLANK.sort }, later(MINI_ROUND_TTL_MS + 1)), 400, 'ROUND_EXPIRED');
    await expect(w.service.submit(null, 'sort', { token, answers: BLANK.sort }, later(5_000))).resolves.toMatchObject({ durationMs: 5_000 });
  });

  it('bài nộp sai dạng: 400 ANSWERS_INVALID', async () => {
    const w = makeWorld();
    const { token } = await startGuest(w, 'sort');
    await expectMini(w.service.submit(null, 'sort', { token, answers: ['recycle'] }, later(10_000)), 400, 'ANSWERS_INVALID');
  });

  it('mục trong token không còn đọc được: 400 ROUND_TOKEN_INVALID', async () => {
    const w = makeWorld();
    const { token } = await startGuest(w, 'sort');
    w.content.byIds.mockResolvedValue(null);
    await expectMini(w.service.submit(null, 'sort', { token, answers: BLANK.sort }, later(10_000)), 400, 'ROUND_TOKEN_INVALID');
  });

  it('không tìm được mục nào của token trong kho (id lạ đã ký): 400, không chấm', async () => {
    const w = makeWorld();
    const signed = signGuestRound({ game: 'sort', issuedAt: NOW.getTime(), contentIds: ['khong-co-1', 'khong-co-2'] }, SECRET).token;
    await expectMini(w.service.submit(null, 'sort', { token: signed, answers: [null, null] }, later(10_000)), 400, 'ROUND_TOKEN_INVALID');
  });
});

describe('GameMiniService: kiểu nội dung trả về khớp hợp đồng', () => {
  it.each(MINI_GAME_IDS)('%s: content.game trùng game và số mục đúng luật', async (game) => {
    const w = makeWorld();
    const res = await w.service.start(null, game, NOW);
    const content: MiniRoundContent = res.content;
    expect(content.game).toBe(game);
    if (content.game === 'sort' || content.game === 'daily_quiz' || content.game === 'origin') {
      expect(content.items).toHaveLength(MINI_GAME_RULES[game].items);
    } else if (content.game === 'match') {
      expect(content.cards).toHaveLength(MINI_GAME_RULES.match.items * 2);
    } else {
      expect(content.task.products).toHaveLength(6);
    }
  });
});
