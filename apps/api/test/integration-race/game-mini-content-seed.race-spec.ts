import { execFile, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { MINI_GAME_RULES, type MiniGameId } from '@tubutree/shared-types';
import { activeCounts, loadGameMiniPack, seedGameMini, type GameMiniPack } from '../../prisma/seed-game-mini';
import { seedGameQuiz } from '../../prisma/seed-game-quiz';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { GameMiniContentService, LEGACY_QUIZ_PREFIX } from '../../src/modules/game/mini/game-mini-content.service';
import { MINI_GAMES, type MiniBuildCtx, type MiniContentRow } from '../../src/modules/game/mini/games';
import { readBasketPayload } from '../../src/modules/game/mini/games/basket';
import { readChoicePayload } from '../../src/modules/game/mini/games/choice';
import { readSortPayload } from '../../src/modules/game/mini/games/sort';

/**
 * `prisma/seed-game-mini.ts` trên Postgres THẬT, mỗi nhóm một DB riêng `tubutree_it_gmseed_*` vừa `prisma migrate deploy` (DB
 * `tubutree_it` dùng chung đã có mục game của spec khác). Chỉ tạo mới theo `id`, cập nhật khi `version` của gói lớn hơn của DB,
 * không đè sửa tay của admin, câu cũ chỉ gắn nguồn khi còn trống; sau seed, kho của từng game đủ để chơi trọn một ván.
 */
const run = promisify(execFile);
const API_ROOT = join(__dirname, '../..');
const BASE_URL = new URL(process.env.DATABASE_URL!);
const SUFFIX = `${process.pid}_${Date.now().toString(36)}`;

const scratch = (tag: string) => {
  const name = `tubutree_it_gmseed_${tag}_${SUFFIX}`;
  const url = new URL(BASE_URL.toString());
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
};
const A = scratch('a');
const B = scratch('b');
const clientFor = (url: string) => new PrismaClient({ datasources: { db: { url } } });

const GAMES: MiniGameId[] = ['sort', 'daily_quiz', 'match', 'origin', 'basket'];
const pack = loadGameMiniPack();
const clone = (): GameMiniPack => JSON.parse(JSON.stringify(pack)) as GameMiniPack;
const totalItems = GAMES.reduce((n, g) => n + pack.games[g].length, 0) + pack.matcher.length;
const DAY = '2026-11-18';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function correctAnswers(game: MiniGameId, rows: MiniContentRow[], ctx: MiniBuildCtx): unknown[] {
  switch (game) {
    case 'sort':
      return rows.map((r) => readSortPayload(r.payload)!.bin);
    case 'daily_quiz':
    case 'origin':
      return rows.map((r) => readChoicePayload(r.payload)!.answer);
    case 'match':
      return rows.map((r) => [ctx.cardId(r.id, 'ingredient'), ctx.cardId(r.id, 'use')]);
    case 'basket':
      return readBasketPayload(rows[0]!.payload)!.correct;
  }
}

describe('seed-game-mini trên DB vừa migrate (real Postgres)', () => {
  let admin: PrismaClient;
  let pa: PrismaClient;
  let pb: PrismaClient;
  let pb2: PrismaClient;

  beforeAll(async () => {
    admin = new PrismaClient();
    for (const db of [A, B]) await admin.$executeRawUnsafe(`CREATE DATABASE "${db.name}"`);
    await Promise.all([A, B].map((db) => run('npx', ['prisma', 'migrate', 'deploy'], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: db.url } })));
    pa = clientFor(A.url);
    pb = clientFor(B.url);
    pb2 = clientFor(B.url);
    await seedGameQuiz(pa);
    await seedGameQuiz(pb);
  }, 240_000);

  afterAll(async () => {
    await Promise.all([pa, pb, pb2].map((p) => p?.$disconnect()));
    for (const db of [A, B]) await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`);
    await admin?.$disconnect();
  }, 60_000);

  const rowsByGame = async (p: PrismaClient) =>
    Object.fromEntries(
      await Promise.all(
        GAMES.map(
          async (g) =>
            [g, { total: await p.gameContentItem.count({ where: { game: g } }), active: await p.gameContentItem.count({ where: { game: g, active: true } }) }] as const,
        ),
      ),
    );
  const expectedRows = Object.fromEntries(GAMES.map((g) => [g, { total: pack.games[g].length, active: pack.games[g].filter((i) => i.active).length }]));

  describe('DB A: lệnh thật, chạy lại, sửa tay của admin, nâng version trong gói', () => {
    it('lệnh `tsx prisma/seed-game-mini.ts` thoát 0, tạo đủ mục, gắn nguồn câu cũ còn trống, mục tắt vẫn tắt', async () => {
      await pa.gameQuiz.update({ where: { id: 'nq_dat_3' }, data: { sourceUrl: 'https://admin.example.org/nguon-admin' } });

      const res = spawnSync('npx', ['tsx', 'prisma/seed-game-mini.ts'], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: A.url }, encoding: 'utf-8' });

      expect(res.stderr).not.toMatch(/Error/);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(`[seed-game-mini] sort: +${pack.games.sort.length} mới, 0 cập nhật theo version, 0 giữ nguyên`);
      expect(res.stdout).toContain(`[seed-game-mini] matcher: +${pack.matcher.length} mới (tắt), 0 cập nhật theo version (tắt lại), 0 giữ nguyên`);
      expect(res.stdout).toContain(`[seed-game-mini] game_quizzes: gắn nguồn ${pack.legacy.length - 1}/${pack.legacy.length} câu cũ`);
      expect(await rowsByGame(pa)).toEqual(expectedRows);

      const inactive = await pa.gameContentItem.findMany({ where: { active: false }, select: { id: true }, orderBy: { id: 'asc' } });
      const expectedInactive = [...GAMES.flatMap((g) => pack.games[g].filter((i) => !i.active).map((i) => i.id)), ...pack.matcher.map((i) => i.id)].sort();
      expect(inactive.map((r) => r.id).sort()).toEqual(expectedInactive);

      const legacy = await pa.gameQuiz.findMany({ where: { id: { in: pack.legacy.map((l) => l.id) } }, select: { id: true, sourceUrl: true } });
      const byId = new Map(legacy.map((l) => [l.id, l.sourceUrl]));
      for (const l of pack.legacy) expect(byId.get(l.id)).toBe(l.id === 'nq_dat_3' ? 'https://admin.example.org/nguon-admin' : l.sourceUrl);
      expect(await pa.gameQuiz.count({ where: { sourceUrl: { not: null }, id: { notIn: pack.legacy.map((l) => l.id) } } })).toBe(0);
    });

    it('một mục mẫu: đủ cột, kind theo game, ngày kiểm nguồn, version 1', async () => {
      const item = pack.games.origin.find((i) => i.active && i.productSlug) ?? pack.games.origin[0]!;
      const row = await pa.gameContentItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(row).toMatchObject({
        game: 'origin',
        kind: 'origin_question',
        payload: item.payload,
        explanation: item.explanation,
        sourceUrl: item.sourceUrl,
        productSlug: item.productSlug ?? null,
        active: item.active,
        version: 1,
      });
      expect(row.sourceCheckedAt?.toISOString().slice(0, 10)).toBe(item.sourceCheckedAt);
    });

    it('chạy lại lần hai: 0 mới, 0 cập nhật, không đổi dòng nào', async () => {
      const before = await pa.gameContentItem.findMany({ orderBy: { id: 'asc' } });
      const result = await seedGameMini(pa);
      expect(result.games.map((g) => [g.game, g.created, g.updated])).toEqual(GAMES.map((g) => [g, 0, 0]));
      expect(result.matcher).toMatchObject({ created: 0, updated: 0 });
      expect(result.legacy.filled).toBe(0);
      expect(await pa.gameContentItem.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    });

    it('admin sửa lời giải thích (version 2) và tắt một mục: seed không đè', async () => {
      const [edited, disabled] = pack.games.sort.filter((i) => i.active);
      await pa.gameContentItem.update({ where: { id: edited!.id }, data: { explanation: 'Admin đã sửa câu này.', version: 2 } });
      await pa.gameContentItem.update({ where: { id: disabled!.id }, data: { active: false, version: 2 } });

      const result = await seedGameMini(pa);

      expect(result.games.find((g) => g.game === 'sort')).toMatchObject({ created: 0, updated: 0 });
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: edited!.id } })).toMatchObject({
        explanation: 'Admin đã sửa câu này.',
        version: 2,
        active: true,
      });
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: disabled!.id } })).toMatchObject({ active: false, version: 2 });
    });

    it('gói nâng version: cập nhật mục có version nhỏ hơn, giữ mục admin đã nâng bằng, giữ trạng thái tắt của admin', async () => {
      const [edited, disabled, plain] = pack.games.sort.filter((i) => i.active);
      const next = clone();
      for (const id of [edited!.id, disabled!.id, plain!.id]) {
        const item = next.games.sort.find((i) => i.id === id)!;
        item.version = 2;
        item.explanation = `${item.explanation.slice(0, 150)} (bản 2)`;
      }

      const result = await seedGameMini(pa, next);

      expect(result.games.find((g) => g.game === 'sort')).toMatchObject({ created: 0, updated: 1 });
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: plain!.id } })).toMatchObject({
        version: 2,
        active: true,
        explanation: expect.stringContaining('(bản 2)'),
      });
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: edited!.id } })).toMatchObject({ explanation: 'Admin đã sửa câu này.' });
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: disabled!.id } })).toMatchObject({ active: false });

      const higher = clone();
      higher.games.sort.find((i) => i.id === disabled!.id)!.version = 3;
      await seedGameMini(pa, higher);
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: disabled!.id } })).toMatchObject({ active: false, version: 3 });
    });

    it('gói tắt một mục ở version mới: DB tắt theo; gói bật lại ở version sau không tự bật mục đã tắt', async () => {
      const target = pack.games.match.find((i) => i.active)!;
      const off = clone();
      Object.assign(off.games.match.find((i) => i.id === target.id)!, { version: 2, active: false, inactiveReason: 'Chuyên gia yêu cầu sửa nguồn.' });
      await seedGameMini(pa, off);
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ active: false, version: 2 });

      const on = clone();
      on.games.match.find((i) => i.id === target.id)!.version = 3;
      await seedGameMini(pa, on);
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ active: false, version: 3 });
    });

    it('admin chỉ tắt mục (màn admin không tăng version khi đổi bật/tắt), gói nâng version 2 với active=true: nội dung mới, vẫn tắt', async () => {
      const target = pack.games.origin.filter((i) => i.active)[1]!;
      await pa.gameContentItem.update({ where: { id: target.id }, data: { active: false } });
      const next = clone();
      const item = next.games.origin.find((i) => i.id === target.id)!;
      item.version = 2;
      item.explanation = `${item.explanation.slice(0, 150)} (bản 2)`;

      const result = await seedGameMini(pa, next);

      expect(result.games.find((g) => g.game === 'origin')).toMatchObject({ updated: 1 });
      expect(await pa.gameContentItem.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
        active: false,
        version: 2,
        explanation: expect.stringContaining('(bản 2)'),
      });
    });

    it('câu cũ admin đã sửa chữ: không gắn nguồn, báo trong `changed`; câu chưa sửa vẫn gắn', async () => {
      const [edited, untouched] = pack.legacy;
      await pa.gameQuiz.update({ where: { id: edited!.id }, data: { sourceUrl: null, question: 'Câu admin đã viết lại?' } });
      await pa.gameQuiz.update({ where: { id: untouched!.id }, data: { sourceUrl: null } });

      const result = await seedGameMini(pa);

      expect(result.legacy).toMatchObject({ filled: 1, missing: [], changed: [edited!.id] });
      expect((await pa.gameQuiz.findUniqueOrThrow({ where: { id: edited!.id } })).sourceUrl).toBeNull();
      expect((await pa.gameQuiz.findUniqueOrThrow({ where: { id: untouched!.id } })).sourceUrl).toBe(untouched!.sourceUrl);
    });

    it('gói có lỗi: không ghi dòng nào', async () => {
      const bad = clone();
      bad.games.sort.push({ ...bad.games.sort[0]!, id: 'gm-sort-moi-loi', explanation: 'Diệt khuẩn 99,9%.' });
      await expect(seedGameMini(pa, bad)).rejects.toThrow(/không ghi gì/);
      expect(await pa.gameContentItem.count({ where: { id: 'gm-sort-moi-loi' } })).toBe(0);
    });
  });

  describe('DB B: hai lần seed song song, rồi chơi trên kho thật', () => {
    it('cùng lúc hai kết nối: không lỗi, không trùng, tổng mới đúng bằng số mục, câu cũ gắn đúng một lần', async () => {
      const [r1, r2] = await Promise.all([seedGameMini(pb), seedGameMini(pb2)]);
      const created = (r: typeof r1) => r.games.reduce((n, g) => n + g.created, 0) + r.matcher.created;
      expect(created(r1) + created(r2)).toBe(totalItems);
      expect(r1.legacy.filled + r2.legacy.filled).toBe(pack.legacy.length);
      expect(await pb.gameContentItem.count()).toBe(totalItems);
      expect(await rowsByGame(pb)).toEqual(expectedRows);
    });

    it('kho thật của từng game: đủ để hiện và chơi trọn một ván với đáp án đúng', async () => {
      const slugs = [
        ...new Set(
          GAMES.flatMap((g) => pack.games[g].filter((i) => i.active)).flatMap((i) => {
            const basket = readBasketPayload(i.payload);
            return basket ? [...basket.correct, ...basket.wrong.map((w) => w.slug)] : i.productSlug ? [i.productSlug] : [];
          }),
        ),
      ];
      for (const slug of slugs) {
        const name = pack.products.find((p) => p.slug === slug)!.name;
        await pb.product.create({
          data: {
            brand: 'IT',
            slug,
            name,
            description: 'IT',
            basePrice: 50_000,
            images: [],
            variations: { create: { sku: `gmseed-${slug}`, name, attributes: {}, retailPrice: 50_000, stock: 5 } },
          },
        });
      }

      const content = new GameMiniContentService(pb as unknown as PrismaService);
      const counts = activeCounts(pack);
      for (const game of GAMES) {
        const pool = await content.pool(game, DAY);
        expect(`${game} ${pool.available}`).toBe(`${game} true`);
        expect(pool.rows).toHaveLength(counts[game].active);
        if (game === 'daily_quiz') expect(pool.rows.filter((r) => r.id.startsWith(LEGACY_QUIZ_PREFIX))).toHaveLength(pack.legacy.length);

        const def = MINI_GAMES[game];
        const ctx: MiniBuildCtx = {
          rng: seeded(7),
          dayKey: DAY,
          products: pool.products,
          sortHazardous: pool.sortHazardous,
          cardId: (id, side) => `${side}:${id}`,
        };
        const rows = def.pick(pool.rows, ctx)!;
        expect(rows).toHaveLength(game === 'basket' ? 1 : MINI_GAME_RULES[game].items);
        def.build(rows, ctx);

        const issued = (await content.byIds(game, rows.map((r) => r.id)))!;
        expect(issued.map((r) => r.id)).toEqual(rows.map((r) => r.id));
        const answers = def.parseAnswers(correctAnswers(game, issued, ctx), issued, ctx);
        expect(answers).not.toBeNull();
        const grade = def.grade(issued, answers, ctx);
        expect(`${game} ${grade.correct}/${grade.total}`).toBe(`${game} ${grade.total}/${grade.total}`);
      }
    });
  });
});
