import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { SeasonPassService } from '../../src/modules/game/season-pass.service';
import { createOrder, createRealUser, randCode, setConfig } from './helpers';

/**
 * VX-01: phần thưởng Cao cấp chỉ mở khi khách có gói định kỳ ACTIVE đã giao ít nhất một đơn định kỳ (DELIVERED).
 * Trước đó chỉ cần một gói ACTIVE: hẹn ngày xa (chưa ra đơn) hoặc tự huỷ đơn đầu rồi huỷ gói vẫn nhận được.
 */
describe('SeasonPassService Cao cấp theo gói đã giao (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let pass: SeasonPassService;
  let variationId: string;
  const seasonId = `it-season-${randCode(6)}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RewardPointsService, SeasonPassService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    pass = moduleRef.get(SeasonPassService);
    await prisma.season.create({
      data: { id: seasonId, name: 'IT', startAt: new Date(Date.now() - 1000), endAt: new Date(Date.now() + 3600_000) },
    });
    await setConfig(prisma, 'loyalty.point_expire_months', 12);
    await setConfig(prisma, 'seasonpass.tiers', [
      { xp: 0, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 5 } },
      { xp: 0, free: { type: 'SEEDS', amount: 10 }, premium: { type: 'POINTS', amount: 7 } },
    ]);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT Brand', slug: `it-sp-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, affiliateRate: 10, stock: 5 },
    });
    variationId = v.id;
  });

  afterAll(async () => {
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await moduleRef.close();
  });

  async function member(opts: { orderStatus?: 'DELIVERED' | 'CANCELLED' | 'CONFIRMED' | null; nextRunAt?: Date }) {
    const u = await createRealUser(prisma);
    await prisma.userSeasonPass.create({ data: { userId: u.id, seasonId, xp: 100 } });
    const a = await prisma.address.create({
      data: {
        userId: u.id, recipient: 'Khach IT', phone: '0900000000', province: 'Ha Noi', district: '', ward: 'Phuong IT',
        street: '1 Duong IT', provinceCode: '01', districtCode: '', wardCode: '00001',
      },
    });
    const sub = await prisma.subscription.create({
      data: { userId: u.id, variationId, addressId: a.id, quantity: 1, intervalWeeks: 4, paymentMethod: 'COD', nextRunAt: opts.nextRunAt ?? new Date(Date.now() + 14 * 864e5) },
    });
    if (opts.orderStatus) {
      const o = await createOrder(prisma, { userId: u.id, status: opts.orderStatus, subscriptionId: sub.id, source: 'subscription' });
      await prisma.subscription.update({ where: { id: sub.id }, data: { lastOrderId: o.id } });
    }
    return { u, sub };
  }

  it('gói hẹn ngày chưa ra đơn: từ chối, getState không báo đủ điều kiện', async () => {
    const { u } = await member({ orderStatus: null });
    await expect(pass.claim(u.id, 0, 'premium')).rejects.toThrow('Cần có gói định kỳ đã giao');
    const st = await pass.getState(u.id);
    expect(st.active && st.premiumEligible).toBe(false);
    expect(await prisma.pointsTransaction.count({ where: { userId: u.id, refType: 'SEASONPASS' } })).toBe(0);
  });

  it('gói có đơn bị huỷ: từ chối', async () => {
    const { u } = await member({ orderStatus: 'CANCELLED' });
    await expect(pass.claim(u.id, 0, 'premium')).rejects.toThrow('Cần có gói định kỳ đã giao');
  });

  it('gói mới có đơn chưa giao: từ chối', async () => {
    const { u } = await member({ orderStatus: 'CONFIRMED' });
    await expect(pass.claim(u.id, 0, 'premium')).rejects.toThrow('Cần có gói định kỳ đã giao');
  });

  it('gói đã giao 1 đơn: được nhận; huỷ gói sau đó không đổi mốc đã nhận nhưng khoá các bậc chưa nhận', async () => {
    const { u, sub } = await member({ orderStatus: 'DELIVERED' });
    const st = await pass.getState(u.id);
    expect(st.active && st.premiumEligible).toBe(true);

    await expect(pass.claim(u.id, 0, 'premium')).resolves.toEqual({ claimed: true, reward: { type: 'POINTS', amount: 5 } });
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED' } });

    const row = await prisma.userSeasonPass.findUniqueOrThrow({ where: { userId_seasonId: { userId: u.id, seasonId } } });
    expect(row.claimedPremium).toEqual([0]);
    expect(await prisma.pointsTransaction.count({ where: { userId: u.id, refType: 'SEASONPASS' } })).toBe(1);
    await expect(pass.claim(u.id, 0, 'premium')).rejects.toThrow('Đã nhận rồi.');
    await expect(pass.claim(u.id, 1, 'premium')).rejects.toThrow('Cần có gói định kỳ đã giao');
  });
});
