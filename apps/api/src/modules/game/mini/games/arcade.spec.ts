import { MINI_GAME_RULES, conveyorEncode, mergeReplay, mergeTier } from '@tubutree/shared-types';
import type { PrismaService } from '../../../../prisma/prisma.service';
import { GameMiniContentService } from '../game-mini-content.service';
import { ARCADE_CONTENT_ID, arcadeRow } from './arcade';
import { ecoMergeGame } from './eco-merge';
import { CONVEYOR_CATALOG, CONVEYOR_GOLDEN_COUNT, conveyorItems, greenConveyorGame } from './green-conveyor';
import type { MiniBuildCtx } from './game-def';

const ctx = (arcadeSeed: number): MiniBuildCtx => ({
  rng: () => 0.5,
  dayKey: '2026-11-28',
  products: new Map(),
  sortHazardous: false,
  cardId: (id, side) => `${side}:${id}`,
  arcadeSeed,
});

describe('kho nội dung của game thao tác: mục ảo, không đọc DB', () => {
  const prisma = new Proxy({}, {
    get: () => {
      throw new Error('không được đọc DB cho game thao tác');
    },
  }) as unknown as PrismaService;
  const svc = new GameMiniContentService(prisma);

  it.each(['eco_merge', 'green_conveyor'] as const)('%s: kho luôn đủ, một mục ảo; byIds chỉ nhận đúng mã mục của luật hiện hành', async (game) => {
    await expect(svc.pool(game, '2026-11-28')).resolves.toEqual({ rows: [arcadeRow(game)], products: new Map(), usableCount: 1, available: true, sortHazardous: false });
    await expect(svc.byIds(game, [ARCADE_CONTENT_ID[game]])).resolves.toEqual([arcadeRow(game)]);
    await expect(svc.byIds(game, [`${ARCADE_CONTENT_ID[game]}x`])).resolves.toBeNull();
    await expect(svc.byIds(game, [ARCADE_CONTENT_ID[game], ARCADE_CONTENT_ID[game]])).resolves.toBeNull();
    await expect(svc.byIds(game, [])).resolves.toBeNull();
  });

  it('mục ảo của game này không dùng được cho game kia', async () => {
    await expect(svc.byIds('eco_merge', [ARCADE_CONTENT_ID.green_conveyor])).resolves.toBeNull();
  });
});

describe('ecoMergeGame', () => {
  const rows = [arcadeRow('eco_merge')];

  it('phát hạt giống của ván và luật bàn, không có gì khác', () => {
    expect(ecoMergeGame.build(rows, ctx(123))).toEqual({ game: 'eco_merge', seed: 123, size: 4, goal: 256, maxMoves: 2000 });
    expect(ecoMergeGame.pick(rows, ctx(1))).toEqual(rows);
  });

  it('chấm bằng cách chơi lại: đúng = bậc cao nhất, chưa đi nước nào thì 0', () => {
    const seed = 99;
    const path = 'ldrdldrdldrdldrdldrd';
    const replay = mergeReplay(seed, path)!;
    const parsed = ecoMergeGame.parseAnswers([path], rows, ctx(seed))!;
    const g = ecoMergeGame.grade(rows, parsed, ctx(seed));
    expect(g.correct).toBe(mergeTier(replay.maxTile));
    expect(g.total).toBe(MINI_GAME_RULES.eco_merge.items);
    expect(g.correctIds).toEqual([]);
    expect(g.review).toEqual({ game: 'eco_merge', score: replay.score, maxTile: replay.maxTile, moves: replay.moves, won: replay.won });
    const empty = ecoMergeGame.grade(rows, ecoMergeGame.parseAnswers([''], rows, ctx(seed))!, ctx(seed));
    expect(empty.correct).toBe(0);
  });

  it.each([[[]], [['l', 'r']], [['lx']], [[1]], [['l'.repeat(2001)]]])('bài nộp sai dạng %j: null', (answers) => {
    expect(ecoMergeGame.parseAnswers(answers, rows, ctx(1))).toBeNull();
  });

  it('không có mục nội dung để admin thêm', () => {
    expect(ecoMergeGame.payloadError({})).toMatch(/luật cài sẵn/);
  });
});

describe('greenConveyorGame', () => {
  const rows = [arcadeRow('green_conveyor')];

  it('dãy món dựng lại được từ hạt giống: 24 món, mỗi thùng 8, 3 món vàng sau món thứ 4, không lặp món liền kề', () => {
    for (const seed of [1, 2, 3, 42, 4_294_967_295]) {
      const items = conveyorItems(seed);
      expect(conveyorItems(seed)).toEqual(items);
      expect(items).toHaveLength(24);
      for (const bin of ['recycle', 'organic', 'refill'] as const) expect(items.filter((i) => i.bin === bin)).toHaveLength(8);
      const golden = items.flatMap((it, i) => (it.golden ? [i] : []));
      expect(golden).toHaveLength(CONVEYOR_GOLDEN_COUNT);
      expect(Math.min(...golden)).toBeGreaterThanOrEqual(4);
      for (let i = 1; i < items.length; i++) expect(items[i]!.label).not.toBe(items[i - 1]!.label);
      for (const it of items) expect(CONVEYOR_CATALOG.find((c) => c.label === it.label)?.bin).toBe(it.bin);
    }
    expect(conveyorItems(1)).not.toEqual(conveyorItems(2));
  });

  it('chấm lại từ hạt giống của ván (khách không tự đặt được món hay thùng)', () => {
    const seed = 777;
    const content = greenConveyorGame.build(rows, ctx(seed));
    if (content.game !== 'green_conveyor') throw new Error('sai game');
    expect(content.items).toEqual(conveyorItems(seed));
    const perfect = conveyorEncode(content.items.map((i) => i.bin));
    const g = greenConveyorGame.grade(rows, greenConveyorGame.parseAnswers([perfect], rows, ctx(seed))!, ctx(seed));
    expect(g).toMatchObject({ correct: 24, total: 24, correctIds: [] });
    expect(g.review).toMatchObject({ game: 'green_conveyor', bestCombo: 24, golden: 3, missed: 0 });
    const otherSeed = greenConveyorGame.grade(rows, greenConveyorGame.parseAnswers([perfect], rows, ctx(seed + 1))!, ctx(seed + 1));
    expect(otherSeed.correct).toBeLessThan(24);
  });

  it.each([[[]], [['r'.repeat(23)]], [['x'.repeat(24)]], [['r'.repeat(24), 'r']], [[24]]])('bài nộp sai dạng %j: null', (answers) => {
    expect(greenConveyorGame.parseAnswers(answers, rows, ctx(1))).toBeNull();
  });
});
