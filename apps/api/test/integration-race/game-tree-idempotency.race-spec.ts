import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { treeCertificateCodeFor } from '../../src/modules/game/tree-purchase-key';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * OQ-5: POST /game/tree/buy có Idempotency-Key tuỳ chọn. Bấm đôi (hai request cùng key, thường chạy song song)
 * chỉ được trừ Điểm Xanh và ghi cây MỘT lần, mọi request trả cùng mã chứng nhận. Chạy trên Postgres thật vì
 * thứ chặn kẻ thua là khoá dòng user + kiểm tra tồn tại bên trong transaction, không phải pre-check.
 */
describe('góp quỹ trồng cây với Idempotency-Key (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  const touched: string[] = [];
  const PRICE = 50;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    await setConfig(prisma, 'game.tree_points_price', PRICE);
    await setConfig(prisma, 'returns.window_days', 7);
  });

  afterEach(async () => {
    expect(await findPointsLotDrift(prisma, touched)).toEqual([]);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** User có số dư hai lô khớp sổ, điểm cũ (không bị khoá bởi đơn mới giao). */
  async function holder(standard: number, converted = 0) {
    const u = await createUser(prisma, { pointsBalance: standard, pointsConvertedBalance: converted });
    touched.push(u.id);
    const old = new Date(Date.now() - 30 * 864e5);
    const rows = [
      { delta: standard, lot: 'STANDARD' as const, reason: 'IT_SEED_STANDARD' },
      { delta: converted, lot: 'CONVERTED' as const, reason: 'IT_SEED_CONVERTED' },
    ].filter((r) => r.delta !== 0);
    await prisma.pointsTransaction.createMany({ data: rows.map((r) => ({ userId: u.id, refType: 'IT', createdAt: old, ...r })) });
    return u;
  }

  const lots = (userId: string) =>
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true, pointsConvertedBalance: true } });
  const treeCount = (userId: string) => prisma.plantedTree.count({ where: { userId } });
  const buyRows = (userId: string) =>
    prisma.pointsTransaction.findMany({
      where: { userId, reason: { startsWith: 'GAME_BUY_TREE:' } },
      select: { reason: true, lot: true, delta: true, refType: true },
    });
  let keySeq = 0;
  const newKey = (tag = 'k') => `pe1a-${tag}-${Date.now().toString(36)}-${(keySeq++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  it('8 request song song cùng key → đúng 1 cây, trừ đúng 50 một lần, mọi request trả cùng kết quả', async () => {
    const u = await holder(500);
    const key = newKey();
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => game.buyTree(u.id, key)));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    expect(s.fulfilled).toHaveLength(8);
    const values = s.fulfilled.map((r) => r.value);
    expect(new Set(values.map((v) => v.certificateCode)).size).toBe(1);
    for (const v of values) expect(v).toEqual(values[0]);
    expect(values[0]).toMatchObject({ cost: PRICE, pointsUsed: PRICE, pointsUsedConverted: 0 });
    expect(values[0]!.certificateCode).toBe(treeCertificateCodeFor(u.id, key));

    expect(await lots(u.id)).toEqual({ pointsBalance: 450, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(1);
    expect(await buyRows(u.id)).toEqual([
      { reason: `GAME_BUY_TREE:${values[0]!.certificateCode}`, lot: 'STANDARD', delta: -PRICE, refType: 'GAME' },
    ]);
  });

  it('lặp 10 vòng (user mới mỗi vòng) → vòng nào cũng đúng 1 lượt', async () => {
    for (let round = 0; round < 10; round++) {
      const u = await holder(500);
      const key = newKey('loop');
      const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => game.buyTree(u.id, key))));
      expect(s.errors).toEqual([]);
      expect(new Set(s.fulfilled.map((r) => r.value.certificateCode)).size).toBe(1);
      expect(await lots(u.id)).toEqual({ pointsBalance: 450, pointsConvertedBalance: 0 });
      expect(await treeCount(u.id)).toBe(1);
    }
  });

  it('gọi lại tuần tự sau khi lượt đầu xong → trả đúng kết quả cũ, không trừ thêm', async () => {
    const u = await holder(500);
    const key = newKey();
    const first = await game.buyTree(u.id, key);
    const again = await game.buyTree(u.id, key);
    const third = await game.buyTree(u.id, key);
    expect(again).toEqual(first);
    expect(third).toEqual(first);
    expect(await lots(u.id)).toEqual({ pointsBalance: 450, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(1);
  });

  it('tiêu hai lô (20 thường + 100 quy đổi): song song cùng key → mọi request báo đúng 30 điểm quy đổi, hai dòng sổ một lần', async () => {
    const u = await holder(20, 100);
    const key = newKey();
    const s = summarize(await Promise.allSettled(Array.from({ length: 5 }, () => game.buyTree(u.id, key))));
    expect(s.errors).toEqual([]);
    for (const r of s.fulfilled) expect(r.value).toMatchObject({ cost: PRICE, pointsUsed: PRICE, pointsUsedConverted: 30 });
    const replay = await game.buyTree(u.id, key);
    expect(replay).toEqual(s.fulfilled[0]!.value);
    expect(await lots(u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 70 });
    expect((await buyRows(u.id)).map((r) => [r.lot, r.delta]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      ['CONVERTED', -30],
      ['STANDARD', -20],
    ]);
    expect(await treeCount(u.id)).toBe(1);
  });

  it('key khác nhau song song → mỗi key một lượt, mã khác nhau, trừ đúng tổng', async () => {
    const u = await holder(500);
    const keys = Array.from({ length: 5 }, () => newKey('multi'));
    const s = summarize(await Promise.allSettled(keys.map((k) => game.buyTree(u.id, k))));
    expect(s.errors).toEqual([]);
    expect(new Set(s.fulfilled.map((r) => r.value.certificateCode)).size).toBe(5);
    expect(await lots(u.id)).toEqual({ pointsBalance: 500 - 5 * PRICE, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(5);
  });

  it('mỗi key song song nhiều lần xen kẽ (3 key × 4 request) → đúng 3 lượt', async () => {
    const u = await holder(500);
    const keys = [newKey('mix'), newKey('mix'), newKey('mix')];
    const calls = Array.from({ length: 12 }, (_, i) => game.buyTree(u.id, keys[i % 3]!));
    const s = summarize(await Promise.allSettled(calls));
    expect(s.errors).toEqual([]);
    expect(new Set(s.fulfilled.map((r) => r.value.certificateCode)).size).toBe(3);
    expect(await lots(u.id)).toEqual({ pointsBalance: 500 - 3 * PRICE, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(3);
  });

  it('không đủ điểm: song song cùng key → toàn bộ 400, không để lại cây hay dòng sổ; nạp thêm rồi dùng lại key thì góp được đúng một lần', async () => {
    const u = await holder(30);
    const key = newKey('poor');
    const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => game.buyTree(u.id, key))));
    expect(s.fulfilled).toHaveLength(0);
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    expect(await lots(u.id)).toEqual({ pointsBalance: 30, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(0);
    expect(await buyRows(u.id)).toEqual([]);

    await prisma.user.update({ where: { id: u.id }, data: { pointsBalance: { increment: 100 } } });
    await prisma.pointsTransaction.create({ data: { userId: u.id, delta: 100, lot: 'STANDARD', reason: 'IT_TOPUP', refType: 'IT', createdAt: new Date(Date.now() - 864e5) } });
    const retry = summarize(await Promise.allSettled(Array.from({ length: 4 }, () => game.buyTree(u.id, key))));
    expect(retry.errors).toEqual([]);
    expect(new Set(retry.fulfilled.map((r) => r.value.certificateCode)).size).toBe(1);
    expect(await lots(u.id)).toEqual({ pointsBalance: 80, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(1);
  });

  it('số dư chỉ đủ 1 lượt + 6 request song song cùng key → 1 lượt thành công, cả 6 cùng nhận mã (không có request nào 400)', async () => {
    const u = await holder(PRICE);
    const key = newKey('exact');
    const s = summarize(await Promise.allSettled(Array.from({ length: 6 }, () => game.buyTree(u.id, key))));
    expect(s.errors).toEqual([]);
    expect(new Set(s.fulfilled.map((r) => r.value.certificateCode)).size).toBe(1);
    expect(await lots(u.id)).toEqual({ pointsBalance: 0, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(1);
  });

  it('hai user khác nhau dùng CÙNG key song song → hai lượt độc lập, mã khác nhau, mỗi người bị trừ đúng một lần', async () => {
    const a = await holder(200);
    const b = await holder(200);
    const key = newKey('shared');
    const calls = [a.id, b.id, a.id, b.id, a.id, b.id].map((id) => game.buyTree(id, key));
    const s = summarize(await Promise.allSettled(calls));
    expect(s.errors).toEqual([]);
    const byUser = (uid: string) => s.fulfilled.filter((_, i) => [a.id, b.id, a.id, b.id, a.id, b.id][i] === uid).map((r) => r.value);
    const ra = byUser(a.id);
    const rb = byUser(b.id);
    expect(new Set(ra.map((v) => v.certificateCode)).size).toBe(1);
    expect(new Set(rb.map((v) => v.certificateCode)).size).toBe(1);
    expect(ra[0]!.certificateCode).not.toBe(rb[0]!.certificateCode);
    expect(await lots(a.id)).toEqual({ pointsBalance: 150, pointsConvertedBalance: 0 });
    expect(await lots(b.id)).toEqual({ pointsBalance: 150, pointsConvertedBalance: 0 });
    expect(await treeCount(a.id)).toBe(1);
    expect(await treeCount(b.id)).toBe(1);
    expect((await buyRows(a.id)).map((r) => r.reason)).toEqual([`GAME_BUY_TREE:${ra[0]!.certificateCode}`]);
    expect((await buyRows(b.id)).map((r) => r.reason)).toEqual([`GAME_BUY_TREE:${rb[0]!.certificateCode}`]);
  });

  it('key của user A không chạm bản ghi user B: mã suy ra từ key đã thuộc B → A nhận 400, A không bị trừ, bản ghi của B nguyên vẹn', async () => {
    const a = await holder(200);
    const b = await holder(200);
    const key = newKey('collide');
    const code = treeCertificateCodeFor(a.id, key);
    await prisma.plantedTree.create({ data: { userId: b.id, certificateCode: code, treeType: 'Cây của B' } });
    await prisma.pointsTransaction.create({
      data: { userId: b.id, delta: -PRICE, lot: 'STANDARD', reason: `GAME_BUY_TREE:${code}`, refType: 'GAME' },
    });
    await prisma.user.update({ where: { id: b.id }, data: { pointsBalance: { decrement: PRICE } } });

    const err = await game.buyTree(a.id, key).then(() => new Error('không ném lỗi'), (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).not.toMatch(/Cây của B/);
    expect(await lots(a.id)).toEqual({ pointsBalance: 200, pointsConvertedBalance: 0 });
    expect(await treeCount(a.id)).toBe(0);
    expect(await lots(b.id)).toEqual({ pointsBalance: 150, pointsConvertedBalance: 0 });
    expect(await prisma.plantedTree.findUniqueOrThrow({ where: { certificateCode: code } })).toMatchObject({
      userId: b.id,
      treeType: 'Cây của B',
    });
  });

  it('không có key: hành vi như cũ, mỗi request một lượt với mã ngẫu nhiên', async () => {
    const u = await holder(500);
    const s = summarize(await Promise.allSettled(Array.from({ length: 3 }, () => game.buyTree(u.id))));
    expect(s.errors).toEqual([]);
    expect(new Set(s.fulfilled.map((r) => r.value.certificateCode)).size).toBe(3);
    for (const r of s.fulfilled) expect(r.value.certificateCode).toMatch(/^TUBU-[0-9A-F]{8}$/);
    expect(await lots(u.id)).toEqual({ pointsBalance: 350, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(3);
  });

  it('key sai định dạng → 400 trước khi đụng DB, không trừ gì', async () => {
    const u = await holder(500);
    await expect(game.buyTree(u.id, 'ngan')).rejects.toBeInstanceOf(BadRequestException);
    await expect(game.buyTree(u.id, 'co khoang trang 123')).rejects.toBeInstanceOf(BadRequestException);
    expect(await lots(u.id)).toEqual({ pointsBalance: 500, pointsConvertedBalance: 0 });
    expect(await treeCount(u.id)).toBe(0);
  });
});
