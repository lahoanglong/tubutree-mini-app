import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { createOrder, createRealUser, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * R2-ENGAGE-7: nhiệm vụ REVIEW_3 hứa "Viết 3 đánh giá có ảnh" nên đánh giá không ảnh không được tính tiến độ. Mỗi lần mua
 * được một đánh giá nên tiến độ đếm theo SẢN PHẨM khác nhau: mua cùng một sản phẩm ba lần không xong nhiệm vụ.
 */
describe('Nhiệm vụ REVIEW_3 đếm sản phẩm khác nhau đã đánh giá có ảnh (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
  const tag = randCode(6).toLowerCase();
  const productIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, AnalyticsEventsService, LoyaltyService, GameService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    game = moduleRef.get(GameService);
    await prisma.mission.upsert({
      where: { code: 'REVIEW_3' },
      update: { goal: 3, isRepeatable: false },
      create: { id: `it-m-review3-${tag}`, code: 'REVIEW_3', title: 'Nhà phê bình', description: 'Viết 3 đánh giá có ảnh', rewardPoints: 15, goal: 3, isRepeatable: false },
    });
    for (let i = 0; i < 4; i += 1) {
      const p = await prisma.product.create({
        data: { brand: 'IT Brand', slug: `it-rv-${i}-${tag}`, name: `IT review ${i} ${tag}`, description: 'IT', basePrice: 100_000 },
      });
      productIds.push(p.id);
    }
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await moduleRef?.close();
  });

  const review3 = async (userId: string) => (await game.getMissions(userId)).find((m) => m.code === 'REVIEW_3')!;
  const progress = async (userId: string) => (await review3(userId)).progress;
  const PHOTO = ['https://img.example/p.jpg'];
  /** Đơn đã giao từ 30 ngày trước: qua hạn đổi/trả nên đánh giá của đơn được tính vào nhiệm vụ. */
  const settledOrderId = async (userId: string) => (await createOrder(prisma, { userId, status: 'DELIVERED', deliveredAt: new Date(Date.now() - 30 * 864e5) })).id;
  /** Một lần mua nữa của sản phẩm, đánh giá có ảnh (mỗi đơn một dòng đánh giá). */
  const photoReview = async (userId: string, productId: string) =>
    prisma.review.create({ data: { userId, productId, orderId: await settledOrderId(userId), rating: 5, images: PHOTO } });

  it('ba đánh giá không ảnh → tiến độ 0; thêm ảnh từng cái → tăng đúng số đánh giá có ảnh', async () => {
    const user = await createRealUser(prisma);
    const reviews = await Promise.all(
      productIds.slice(0, 3).map((productId) =>
        settledOrderId(user.id).then((orderId) => prisma.review.create({ data: { userId: user.id, productId, orderId, rating: 5, images: [] } })),
      ),
    );
    expect(await progress(user.id)).toBe(0);

    await prisma.review.update({ where: { id: reviews[0]!.id }, data: { images: ['https://img.example/a.jpg'] } });
    expect(await progress(user.id)).toBe(1);

    await prisma.review.update({ where: { id: reviews[1]!.id }, data: { images: ['https://img.example/b.jpg', 'https://img.example/c.jpg'] } });
    expect(await progress(user.id)).toBe(2);
  });

  it('ba đánh giá có ảnh cho CÙNG một sản phẩm (ba lần mua) → tiến độ 1, không nhận được thưởng; thêm sản phẩm khác mới tăng', async () => {
    const user = await createRealUser(prisma);
    for (let i = 0; i < 3; i += 1) await photoReview(user.id, productIds[0]!);
    expect(await prisma.review.count({ where: { userId: user.id } })).toBe(3);
    expect(await review3(user.id)).toMatchObject({ progress: 1, goal: 3, completed: false, claimed: false });
    await expect(game.claimMission(user.id, 'REVIEW_3')).rejects.toThrow('Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.');

    await photoReview(user.id, productIds[1]!);
    expect(await progress(user.id)).toBe(2);
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: { startsWith: 'MISSION:REVIEW_3' } } })).toBe(0);
  });

  it('ba sản phẩm khác nhau → tiến độ 3; năm lượt nhận đồng thời chỉ cộng thưởng một lần', async () => {
    const user = await createRealUser(prisma);
    for (const productId of productIds.slice(0, 3)) await photoReview(user.id, productId);
    await photoReview(user.id, productIds[0]!);
    expect(await review3(user.id)).toMatchObject({ progress: 3, goal: 3, completed: true, claimed: false });

    const mission = await prisma.mission.findUniqueOrThrow({ where: { code: 'REVIEW_3' } });
    const res = summarize(await Promise.allSettled(Array.from({ length: 5 }, () => game.claimMission(user.id, 'REVIEW_3'))));
    expect(res.fulfilled).toHaveLength(1);
    expect(res.errors).toHaveLength(4);
    for (const e of res.errors) expect(e).toContain('Bạn đã nhận thưởng nhiệm vụ này rồi.');
    const credits = await prisma.pointsTransaction.findMany({ where: { userId: user.id, reason: { startsWith: 'MISSION:REVIEW_3' } } });
    expect(credits.map((c) => c.delta)).toEqual([mission.rewardPoints]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(mission.rewardPoints);
    expect(await review3(user.id)).toMatchObject({ progress: 3, completed: true, claimed: true });
  });

  it('đã nhận khi còn đếm theo dòng (ba đánh giá cùng một sản phẩm) → vẫn hiện xong 3/3 và đã nhận; nhận lại báo đã nhận, không cộng', async () => {
    const user = await createRealUser(prisma);
    for (let i = 0; i < 3; i += 1) await photoReview(user.id, productIds[0]!);
    const mission = await prisma.mission.findUniqueOrThrow({ where: { code: 'REVIEW_3' } });
    await prisma.missionProgress.create({
      data: { userId: user.id, missionId: mission.id, cycleKey: '0', progress: 3, goal: 3, completedAt: new Date() },
    });

    expect(await review3(user.id)).toMatchObject({ progress: 3, goal: 3, completed: true, claimed: true });
    await expect(game.claimMission(user.id, 'REVIEW_3')).rejects.toThrow('Bạn đã nhận thưởng nhiệm vụ này rồi.');
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: { startsWith: 'MISSION:REVIEW_3' } } })).toBe(0);
  });

  it('khách vãng lai đủ điều kiện nhưng không nhận được: 5 lượt song song đều bị từ chối, không ghi "đã nhận", không cộng điểm; có SĐT rồi nhận được đúng một lần', async () => {
    const guest = await createUser(prisma, { zaloId: `guest_it_${randCode(10)}` });
    for (const productId of productIds.slice(0, 3)) await photoReview(guest.id, productId);
    expect(await review3(guest.id)).toMatchObject({ progress: 3, completed: true, claimed: false, pointsBlocked: 'GUEST' });

    const denied = summarize(await Promise.allSettled(Array.from({ length: 5 }, () => game.claimMission(guest.id, 'REVIEW_3'))));
    expect(denied.fulfilled).toHaveLength(0);
    for (const e of denied.errors) expect(e).toContain('Đăng nhập Zalo để nhận Điểm Xanh');
    const mission = await prisma.mission.findUniqueOrThrow({ where: { code: 'REVIEW_3' } });
    expect(await prisma.missionProgress.count({ where: { userId: guest.id, missionId: mission.id } })).toBe(0);
    expect(await prisma.pointsTransaction.count({ where: { userId: guest.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: guest.id } })).pointsBalance).toBe(0);

    await prisma.user.update({ where: { id: guest.id }, data: { phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } });
    const ok = summarize(await Promise.allSettled(Array.from({ length: 5 }, () => game.claimMission(guest.id, 'REVIEW_3'))));
    expect(ok.fulfilled).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: guest.id } })).pointsBalance).toBe(mission.rewardPoints);
    expect(await review3(guest.id)).toMatchObject({ claimed: true });
    expect(await review3(guest.id)).not.toHaveProperty('pointsBlocked');
  });
});
