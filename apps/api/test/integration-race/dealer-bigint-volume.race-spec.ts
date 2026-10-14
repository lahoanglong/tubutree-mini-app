import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { BrandService } from '../../src/modules/brand/brand.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createDealer, createOrder, createUser, warmPool } from './helpers';

/**
 * C-055: ngưỡng thưởng / doanh số kỳ của đại lý vượt Int 32-bit (2.147.483.647) trước đây ra
 * "value out of range for type integer" → 500. Chạy trên Postgres thật vì lỗi nằm ở kiểu cột.
 */
describe('Dealer reward threshold / volume above Int32 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let brand: BrandService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const BIG = 3_000_000_000;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        BrandService,
        { provide: NotificationsService, useValue: { notify } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    dealer = moduleRef.get(DealerService);
    brand = moduleRef.get(BrandService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('admin creates/updates/lists a DealerReward with threshold 3 billion; API payload is a plain number', async () => {
    const created = await brand.createDealerReward({ type: 'TOUR', title: `Tour 3 tỷ ${Date.now()}`, threshold: BIG, period: 'YEAR' });
    expect(created.threshold).toBe(BIG);
    expect(JSON.parse(JSON.stringify(created)).threshold).toBe(BIG);

    const updated = await brand.updateDealerReward(created.id, { threshold: BIG + 1 });
    expect(updated.threshold).toBe(BIG + 1);

    const listed = (await brand.listDealerRewards()).find((r) => r.id === created.id);
    expect(listed?.threshold).toBe(BIG + 1);
    expect(JSON.parse(JSON.stringify(listed)).threshold).toBe(BIG + 1);

    const tag = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const b = await prisma.brand.create({ data: { slug: `it-brand-${tag}`, name: `IT Brand ${tag}`, isPublished: true } });
    const brandReward = await brand.createDealerReward({ brandId: b.id, type: 'GIFT', title: 'Quà 3 tỷ', threshold: BIG });
    const page = JSON.parse(JSON.stringify(await brand.getPublicBySlug(b.slug)));
    expect(page.dealerRewards.find((r: { id: string }) => r.id === brandReward.id)?.threshold).toBe(BIG);

    await prisma.dealerReward.deleteMany({ where: { id: { in: [created.id, brandReward.id] } } });
    await prisma.brand.delete({ where: { id: b.id } });
  });

  it('dealer with settled volume 3.2 billion claims a 3-billion reward; admin approves; every payload serializes', async () => {
    const d = await createUser(prisma, { role: 'DEALER' });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const reward = await brand.createDealerReward({ type: 'TOUR', title: `Tour IT big ${d.id}`, threshold: BIG, period: 'QUARTER' });
    for (let i = 0; i < 2; i++) {
      await createOrder(prisma, {
        userId: d.id,
        type: 'DEALER',
        status: 'DELIVERED',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'PAID',
        total: 1_600_000_000,
        subtotal: 1_600_000_000,
      });
    }

    const progress = (await dealer.rewardsProgress(d.id)).rewards;
    const row = progress.find((r: { id: string; isCurrentPeriod: boolean }) => r.id === reward.id && r.isCurrentPeriod);
    expect(row).toMatchObject({ threshold: BIG, volume: 3_200_000_000, achieved: true, toGo: 0, canClaim: true });
    expect(() => JSON.stringify(progress)).not.toThrow();

    const res = await dealer.claimReward(d.id, reward.id);
    expect(res.alreadyClaimed).toBe(false);
    expect(res.claim.volumeAtClaim).toBe(3_200_000_000);
    expect(res.reward.threshold).toBe(BIG);
    expect(JSON.parse(JSON.stringify(res)).currentVolume).toBe(3_200_000_000);

    const page = await dealer.listRewardClaims(undefined, 1, 50);
    const mine = page.data.find((c: { id: string }) => c.id === res.claim.id);
    expect(mine).toMatchObject({ threshold: BIG, volumeAtClaim: 3_200_000_000 });
    expect(() => JSON.stringify(page)).not.toThrow();

    const approved = await dealer.approveRewardClaim(admin.id, res.claim.id);
    expect(approved).toMatchObject({ status: 'APPROVED', threshold: BIG, volumeAtClaim: 3_200_000_000 });
    const paid = await dealer.markRewardClaimPaid(admin.id, res.claim.id);
    expect(JSON.parse(JSON.stringify(paid)).volumeAtClaim).toBe(3_200_000_000);
    expect(notify.mock.calls.some((c) => c[1] === 'DEALER_REWARD_CLAIM_NEW' && c[2].volume === (3_200_000_000).toLocaleString('vi-VN'))).toBe(true);
  });

  it('dealer order whose total exceeds the per-order cap is rejected with 400, not a DB overflow 500', async () => {
    const d = await createDealer(prisma);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-dl-${d.id}`,
        brand: 'IT Brand',
        slug: `it-sp-dl-${d.id.toLowerCase()}`,
        name: `SP đại lý ${d.id}`,
        description: 'IT',
        basePrice: 100_000,
        approvalStatus: 'APPROVED',
      },
    });
    const { id: variationId } = await prisma.variation.create({
      data: {
        pancakeId: `it-v-dl-${d.id}`,
        productId: product.id,
        sku: `IT-DL-${d.id}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        affiliateRate: 10,
        stock: 10,
      },
    });
    const ordersBefore = await prisma.order.count({ where: { userId: d.id } });

    await expect(
      dealer.placeOrder(d.id, { items: [{ variationId, quantity: 100_000 }], paymentMethod: 'PREPAID' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      dealer.placeOrder(d.id, { items: [{ variationId, quantity: 100_000 }], paymentMethod: 'CREDIT' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.order.count({ where: { userId: d.id } })).toBe(ordersBefore);
  });
});
