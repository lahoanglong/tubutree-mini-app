import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const TOO_EARLY = 'Chưa đủ điều kiện để nhận thưởng nhiệm vụ này.';

/**
 * Thưởng nhiệm vụ trả bằng điểm dùng ngay được, nên FIRST_ORDER và REVIEW_3 chỉ tính đơn đã qua hạn đổi/trả
 * (returns.window_days) và không có yêu cầu trả chờ duyệt: nếu không khách nhận thưởng rồi trả đơn mà vẫn giữ điểm.
 */
describe('Nhiệm vụ FIRST_ORDER, REVIEW_3 chờ hết hạn đổi/trả (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let game: GameService;
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
    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    const tag = randCode(6).toLowerCase();
    for (const m of [
      { code: 'FIRST_ORDER', title: 'Đơn hàng đầu tiên', description: 'Nhận đơn đầu tiên', rewardPoints: 20, goal: 1 },
      { code: 'REVIEW_3', title: 'Nhà phê bình', description: 'Viết 3 đánh giá có ảnh', rewardPoints: 15, goal: 3 },
    ]) {
      await prisma.mission.upsert({
        where: { code: m.code },
        update: { goal: m.goal, isRepeatable: false, rewardPoints: m.rewardPoints, rewardCoupon: null },
        create: { id: `it-mw-${m.code}-${tag}`, ...m, isRepeatable: false },
      });
    }
    for (let i = 0; i < 3; i += 1) {
      const p = await prisma.product.create({
        data: { brand: 'IT Brand', slug: `it-mw-${i}-${tag}`, name: `IT mission window ${i} ${tag}`, description: 'IT', basePrice: 100_000 },
      });
      productIds.push(p.id);
    }
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await moduleRef?.close();
  });

  const mission = async (userId: string, code: string) => (await game.getMissions(userId)).find((m) => m.code === code)!;
  const delivered = (userId: string, days: number) => createOrder(prisma, { userId, status: 'DELIVERED', deliveredAt: ago(days) });

  it('FIRST_ORDER: đơn giao 1 ngày trước, cửa sổ 7 ngày → không nhận được; thẻ báo chờ hết hạn đổi/trả', async () => {
    const user = await createUser(prisma);
    await delivered(user.id, 1);

    expect(await mission(user.id, 'FIRST_ORDER')).toMatchObject({ progress: 0, completed: false, claimed: false });
    expect((await mission(user.id, 'FIRST_ORDER')).description).toContain('đổi/trả');
    await expect(game.claimMission(user.id, 'FIRST_ORDER')).rejects.toThrow(TOO_EARLY);
    expect(await prisma.pointsTransaction.count({ where: { userId: user.id, reason: { startsWith: 'MISSION:' } } })).toBe(0);
  });

  it('FIRST_ORDER: đơn giao 8 ngày trước → nhận được, mô tả không thêm chữ chờ', async () => {
    const user = await createUser(prisma);
    await delivered(user.id, 8);

    const card = await mission(user.id, 'FIRST_ORDER');
    expect(card).toMatchObject({ progress: 1, completed: true, claimed: false });
    expect(card.description ?? '').not.toContain('đổi/trả');
    await expect(game.claimMission(user.id, 'FIRST_ORDER')).resolves.toMatchObject({ claimed: true, rewardPoints: 20 });
  });

  it('FIRST_ORDER: đơn đã qua hạn nhưng đang có yêu cầu trả chờ duyệt → chưa nhận; từ chối yêu cầu thì nhận được', async () => {
    const user = await createUser(prisma);
    const order = await delivered(user.id, 20);
    const req = await prisma.returnRequest.create({ data: { orderId: order.id, userId: user.id, reason: 'Không còn nhu cầu' } });

    await expect(game.claimMission(user.id, 'FIRST_ORDER')).rejects.toThrow(TOO_EARLY);
    await prisma.returnRequest.update({ where: { id: req.id }, data: { status: 'REJECTED' } });
    await expect(game.claimMission(user.id, 'FIRST_ORDER')).resolves.toMatchObject({ claimed: true });
  });

  it('FIRST_ORDER: đơn đã trả (RETURNED) không tính', async () => {
    const user = await createUser(prisma);
    await createOrder(prisma, { userId: user.id, status: 'RETURNED', deliveredAt: ago(20) });
    await expect(game.claimMission(user.id, 'FIRST_ORDER')).rejects.toThrow(TOO_EARLY);
  });

  it('REVIEW_3: chỉ tính đánh giá có ảnh của đơn đã qua hạn đổi/trả', async () => {
    const user = await createUser(prisma);
    const PHOTO = ['https://res.cloudinary.com/it/p.jpg'];
    const review = async (productId: string, days: number) =>
      prisma.review.create({ data: { userId: user.id, productId, orderId: (await delivered(user.id, days)).id, rating: 5, images: PHOTO } });
    await review(productIds[0]!, 30);
    await review(productIds[1]!, 30);
    await review(productIds[2]!, 2);

    expect(await mission(user.id, 'REVIEW_3')).toMatchObject({ progress: 2, completed: false });
    expect((await mission(user.id, 'REVIEW_3')).description).toContain('đổi/trả');
    await expect(game.claimMission(user.id, 'REVIEW_3')).rejects.toThrow(TOO_EARLY);

    // Hết hạn đổi/trả của đơn thứ ba thì đánh giá đó được tính.
    await prisma.order.updateMany({ where: { userId: user.id }, data: { deliveredAt: ago(30) } });
    expect(await mission(user.id, 'REVIEW_3')).toMatchObject({ progress: 3, completed: true });
    await expect(game.claimMission(user.id, 'REVIEW_3')).resolves.toMatchObject({ claimed: true, rewardPoints: 15 });
  });

  it('REVIEW_3: đánh giá của sản phẩm đã bị trả một phần trên đơn (đơn vẫn giao, đã qua hạn) không tính', async () => {
    const user = await createUser(prisma);
    const PHOTO = ['https://res.cloudinary.com/it/p.jpg'];
    const orders = [] as { id: string }[];
    for (let i = 0; i < 3; i += 1) {
      const order = await delivered(user.id, 30);
      orders.push(order);
      await prisma.review.create({ data: { userId: user.id, productId: productIds[i]!, orderId: order.id, rating: 5, images: PHOTO } });
    }
    expect(await mission(user.id, 'REVIEW_3')).toMatchObject({ progress: 3, completed: true });

    const variation = await prisma.variation.create({
      data: { pancakeId: `it-mw-v-${randCode(8)}`, productId: productIds[1]!, sku: `MW-${randCode(8)}`, name: 'Chai', attributes: {}, retailPrice: 100_000, stock: 5 },
    });
    const item = await prisma.orderItem.create({
      data: { orderId: orders[1]!.id, variationId: variation.id, productName: 'IT', variationName: 'Chai', unitPrice: 100_000, quantity: 1, total: 100_000, paidTotal: 100_000 },
    });
    const req = await prisma.returnRequest.create({ data: { orderId: orders[1]!.id, userId: user.id, reason: 'Hỏng', status: 'APPROVED' } });
    await prisma.returnRequestItem.create({ data: { returnRequestId: req.id, orderItemId: item.id, quantity: 1 } });

    expect(await mission(user.id, 'REVIEW_3')).toMatchObject({ progress: 2, completed: false });
    await expect(game.claimMission(user.id, 'REVIEW_3')).rejects.toThrow(TOO_EARLY);
  });

  it('REVIEW_3: đánh giá của đơn đã trả (RETURNED) không tính', async () => {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, status: 'RETURNED', deliveredAt: ago(30) });
    await prisma.review.create({ data: { userId: user.id, productId: productIds[0]!, orderId: order.id, rating: 5, images: ['https://res.cloudinary.com/it/p.jpg'] } });
    expect(await mission(user.id, 'REVIEW_3')).toMatchObject({ progress: 0 });
  });
});
