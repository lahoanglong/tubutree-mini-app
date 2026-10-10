import { randomInt } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import {
  SubscriptionsService,
  SUBSCRIPTION_DUPLICATE,
} from '../../src/modules/subscriptions/subscriptions.service';
import { barrierOnFirstCalls, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * C-057 / A2-011 (Q-13, docs/2026-10-review): bấm đúp "Đặt định kỳ" từng tạo 2 gói, mỗi kỳ cron sinh
 * 2 đơn COD. Nay mỗi (user, variation, địa chỉ) chỉ có tối đa 1 gói ACTIVE/PAUSED: chặn bằng partial
 * unique index trên Postgres, gửi lại cùng yêu cầu thì nhận lại đúng gói đã có.
 */
describe('Chống trùng gói giao định kỳ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let subs: SubscriptionsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        SubscriptionsService,
        { provide: PricingService, useValue: {} },
        { provide: LoyaltyService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    subs = moduleRef.get(SubscriptionsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-sp-${tag.toLowerCase()}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 100_000,
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `it-v-${tag}`,
        productId: product.id,
        sku: `IT-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        affiliateRate: 10,
        stock: 50,
      },
      include: { product: true },
    });
  }

  async function address(userId: string) {
    return prisma.address.create({
      data: {
        userId,
        recipient: 'Khach IT',
        phone: randomPhone(),
        province: 'Ha Noi',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '01',
        districtCode: '',
        wardCode: '00001',
      },
    });
  }

  function expectDuplicate(err: unknown, productName: string) {
    expect(err).toBeInstanceOf(ConflictException);
    const res = (err as ConflictException).getResponse() as { code?: string; message?: string; subscriptionId?: string };
    expect(res.code).toBe(SUBSCRIPTION_DUPLICATE);
    expect(res.message).toContain(productName);
    return res;
  }

  it('có partial unique index (userId, variationId, addressId) chỉ cho gói ACTIVE/PAUSED', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'subscriptions' AND indexname = 'subscriptions_user_variation_address_open_key'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX/);
    expect(rows[0].indexdef).toMatch(/"userId", "variationId", "addressId"/);
    expect(rows[0].indexdef).toMatch(/ACTIVE/);
    expect(rows[0].indexdef).toMatch(/PAUSED/);
  });

  it('5 request tạo gói song song (10 vòng): đúng 1 gói, cả 5 nhận lại cùng gói đó', async () => {
    // Bước đọc lại NGOÀI transaction chỉ chạy sau khi index trả P2002: đếm để chắc chính DB đã chặn.
    const reread = jest.spyOn(prisma.subscription, 'findFirst');
    for (let round = 0; round < 10; round++) {
      const u = await createUser(prisma);
      const v = await variation();
      const addr = await address(u.id);
      const dto = { variationId: v.id, quantity: 2, intervalWeeks: 4, addressId: addr.id };

      // Cả 5 đều qua bước đọc địa chỉ trước khi bên nào kịp ghi: ép đúng kẽ hở kiểm-rồi-ghi.
      const barrier = barrierOnFirstCalls(prisma.address, 'findUnique', 5);
      const results = await Promise.allSettled(Array.from({ length: 5 }, () => subs.create(u.id, dto)));
      barrier.mockRestore();
      const { fulfilled, errors } = summarize(results);
      const ctx = `vòng ${round}: ${errors.join(' | ')}`;

      const rows = await prisma.subscription.findMany({ where: { userId: u.id } });
      expect({ ctx, subs: rows.length, ok: fulfilled.length }).toEqual({ ctx, subs: 1, ok: 5 });
      expect(new Set(fulfilled.map((f) => f.value.id))).toEqual(new Set([rows[0].id]));
      expect(rows[0]).toEqual(expect.objectContaining({ status: 'ACTIVE', quantity: 2, intervalWeeks: 4 }));
    }
    expect(reread.mock.calls.length).toBeGreaterThan(0);
    reread.mockRestore();
  });

  it('gửi lại tuần tự cùng yêu cầu: trả lại gói cũ, không tạo thêm', async () => {
    const u = await createUser(prisma);
    const v = await variation();
    const addr = await address(u.id);
    const dto = { variationId: v.id, quantity: 1, intervalWeeks: 6, addressId: addr.id };
    const first = await subs.create(u.id, dto);
    const again = await subs.create(u.id, dto);
    expect(again.id).toBe(first.id);
    expect(await prisma.subscription.count({ where: { userId: u.id } })).toBe(1);
  });

  it('cùng SP khác địa chỉ: được tạo gói thứ hai', async () => {
    const u = await createUser(prisma);
    const v = await variation();
    const a1 = await address(u.id);
    const a2 = await address(u.id);
    const s1 = await subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: a1.id });
    const s2 = await subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: a2.id });
    expect(s2.id).not.toBe(s1.id);
    expect(await prisma.subscription.count({ where: { userId: u.id, status: 'ACTIVE' } })).toBe(2);
  });

  it('đã có gói cùng địa chỉ nhưng khác số lượng/chu kỳ: 409, không tạo thêm, gói cũ giữ nguyên', async () => {
    const u = await createUser(prisma);
    const v = await variation();
    const addr = await address(u.id);
    const s1 = await subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id });
    const err = await subs
      .create(u.id, { variationId: v.id, quantity: 3, intervalWeeks: 8, addressId: addr.id })
      .catch((e: unknown) => e);
    const res = expectDuplicate(err, v.product.name);
    expect(res.subscriptionId).toBe(s1.id);
    expect(await prisma.subscription.findMany({ where: { userId: u.id } })).toEqual([
      expect.objectContaining({ id: s1.id, quantity: 1, intervalWeeks: 4, status: 'ACTIVE' }),
    ]);
  });

  it('gói cùng địa chỉ đang TẠM DỪNG: 409 nhắc bật lại gói cũ, không tạo thêm', async () => {
    const u = await createUser(prisma);
    const v = await variation();
    const addr = await address(u.id);
    const dto = { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id };
    const s1 = await subs.create(u.id, dto);
    await subs.setStatus(u.id, s1.id, 'PAUSED');
    const err = await subs.create(u.id, dto).catch((e: unknown) => e);
    const res = expectDuplicate(err, v.product.name);
    expect(res.message).toContain('tạm dừng');
    expect(await prisma.subscription.count({ where: { userId: u.id } })).toBe(1);
  });

  it('gói cũ đã huỷ: tạo gói mới bình thường', async () => {
    const u = await createUser(prisma);
    const v = await variation();
    const addr = await address(u.id);
    const dto = { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id };
    const s1 = await subs.create(u.id, dto);
    await subs.setStatus(u.id, s1.id, 'CANCELLED');
    const s2 = await subs.create(u.id, dto);
    expect(s2.id).not.toBe(s1.id);
    expect(s2.status).toBe('ACTIVE');
  });

  it('bật lại gói đã huỷ khi đã có gói mới cùng SP + địa chỉ: 409 rõ ràng (không 500)', async () => {
    const u = await createUser(prisma);
    const v = await variation();
    const addr = await address(u.id);
    const dto = { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id };
    const old = await subs.create(u.id, dto);
    await subs.setStatus(u.id, old.id, 'CANCELLED');
    const fresh = await subs.create(u.id, dto);
    const err = await subs.setStatus(u.id, old.id, 'ACTIVE').catch((e: unknown) => e);
    const res = expectDuplicate(err, v.product.name);
    expect(res.subscriptionId).toBe(fresh.id);
    expect(await prisma.subscription.findUnique({ where: { id: old.id } })).toEqual(
      expect.objectContaining({ status: 'CANCELLED' }),
    );
  });
});
