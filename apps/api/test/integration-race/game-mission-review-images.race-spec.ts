import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { GameService } from '../../src/modules/game/game.service';
import { createUser, randCode, warmPool } from './helpers';

/** R2-ENGAGE-7: nhiệm vụ REVIEW_3 hứa "Viết 3 đánh giá có ảnh" nên đánh giá không ảnh không được tính tiến độ. */
describe('Nhiệm vụ REVIEW_3 chỉ đếm đánh giá có ảnh (real Postgres)', () => {
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
      update: { goal: 3 },
      create: { id: `it-m-review3-${tag}`, code: 'REVIEW_3', title: 'Nhà phê bình', description: 'Viết 3 đánh giá có ảnh', rewardPoints: 15, goal: 3 },
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

  const progress = async (userId: string) =>
    (await game.getMissions(userId)).find((m) => m.code === 'REVIEW_3')!.progress;

  it('ba đánh giá không ảnh → tiến độ 0; thêm ảnh từng cái → tăng đúng số đánh giá có ảnh', async () => {
    const user = await createUser(prisma);
    const reviews = await Promise.all(
      productIds.slice(0, 3).map((productId) =>
        prisma.review.create({ data: { userId: user.id, productId, orderId: `it-order-${randCode(6)}`, rating: 5, images: [] } }),
      ),
    );
    expect(await progress(user.id)).toBe(0);

    await prisma.review.update({ where: { id: reviews[0]!.id }, data: { images: ['https://img.example/a.jpg'] } });
    expect(await progress(user.id)).toBe(1);

    await prisma.review.update({ where: { id: reviews[1]!.id }, data: { images: ['https://img.example/b.jpg', 'https://img.example/c.jpg'] } });
    expect(await progress(user.id)).toBe(2);
  });
});
