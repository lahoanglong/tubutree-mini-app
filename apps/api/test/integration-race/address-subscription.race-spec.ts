import { randomInt } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { UsersService, ADDRESS_IN_USE_BY_SUBSCRIPTION } from '../../src/modules/users/users.service';
import { barrierOnFirstCalls, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * C-014 / A2-003 (Q-12, docs/2026-10-review): xoá địa chỉ đang gắn gói giao định kỳ ACTIVE/PAUSED trước
 * đây xoá cứng luôn gói (FK ON DELETE CASCADE). Nay phải chặn bằng lỗi tiếng Việt, và FK là RESTRICT để
 * cả khi xoá địa chỉ chạy song song với tạo gói cũng không có gói nào bị mất hay mồ côi.
 */
/** Gói hẹn ngày bắt đầu sau hôm nay: không sinh đơn đầu ngay (C-015), giữ đúng phạm vi các ca dưới đây. */
const LATER = new Date(Date.now() + 7 * 3600e3 + 3 * 864e5).toISOString().slice(0, 10);

describe('Xoá địa chỉ đang dùng cho gói định kỳ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let users: UsersService;
  let subs: SubscriptionsService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        UsersService,
        SubscriptionsService,
        WalletLedgerService,
        { provide: PricingService, useValue: {} },
        { provide: LoyaltyService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    users = moduleRef.get(UsersService);
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

  function expectAddressInUse(err: unknown, productName: string) {
    expect(err).toBeInstanceOf(BadRequestException);
    const res = (err as BadRequestException).getResponse() as { code?: string; message?: string };
    expect(res.code).toBe(ADDRESS_IN_USE_BY_SUBSCRIPTION);
    expect(res.message).toContain('Địa chỉ đang dùng cho gói giao định kỳ');
    expect(res.message).toContain(productName);
    expect(res.message).toContain('hãy đổi địa chỉ của gói trước');
  }

  it('FK subscriptions.addressId là RESTRICT, không còn CASCADE', async () => {
    const rows = await prisma.$queryRaw<{ confdeltype: string }[]>`
      SELECT confdeltype::text AS confdeltype FROM pg_constraint WHERE conname = 'subscriptions_addressId_fkey'`;
    expect(rows).toEqual([{ confdeltype: 'r' }]);
  });

  it.each(['ACTIVE', 'PAUSED'] as const)('gói %s: xoá địa chỉ bị chặn, gói và địa chỉ còn nguyên', async (status) => {
    const u = await createUser(prisma);
    const v = await variation();
    const addr = await address(u.id);
    const sub = await subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id, startDate: LATER });
    if (status === 'PAUSED') await subs.setStatus(u.id, sub.id, 'PAUSED');

    const err = await users.deleteAddress(u.id, addr.id).catch((e: unknown) => e);
    expectAddressInUse(err, v.product.name);

    expect(await prisma.address.count({ where: { id: addr.id } })).toBe(1);
    expect(await prisma.subscription.findUnique({ where: { id: sub.id } })).toEqual(
      expect.objectContaining({ status, addressId: addr.id }),
    );
  });

  it('chỉ còn gói đã huỷ: xoá địa chỉ được, gói huỷ đi theo như trước', async () => {
    const u = await createUser(prisma);
    const v = await variation();
    const addr = await address(u.id);
    const sub = await subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id, startDate: LATER });
    await subs.setStatus(u.id, sub.id, 'CANCELLED');

    await expect(users.deleteAddress(u.id, addr.id)).resolves.toEqual({ ok: true });
    expect(await prisma.address.count({ where: { id: addr.id } })).toBe(0);
    expect(await prisma.subscription.count({ where: { id: sub.id } })).toBe(0);
  });

  it('địa chỉ không gắn gói nào: xoá bình thường', async () => {
    const u = await createUser(prisma);
    const addr = await address(u.id);
    await expect(users.deleteAddress(u.id, addr.id)).resolves.toEqual({ ok: true });
    expect(await prisma.address.count({ where: { id: addr.id } })).toBe(0);
  });

  it('xoá địa chỉ song song với tạo gói (20 vòng): không gói nào bị mất hay mồ côi', async () => {
    for (let round = 0; round < 20; round++) {
      const u = await createUser(prisma);
      const v = await variation();
      const addr = await address(u.id);

      // Cả hai đều đã qua bước đọc địa chỉ (tạo gói: "địa chỉ hợp lệ"; xoá: "đúng chủ") trước khi bên
      // nào kịp ghi — ép đúng kẽ hở giữa kiểm và ghi thay vì trông vào may rủi lịch chạy.
      const barrier = barrierOnFirstCalls(prisma.address, 'findUnique', 2);
      const [created, deleted] = await Promise.allSettled([
        subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id, startDate: LATER }),
        users.deleteAddress(u.id, addr.id),
      ]);
      barrier.mockRestore();
      const ctx = `vòng ${round}: create=${created.status} delete=${deleted.status} ${summarize([created, deleted]).errors.join(' | ')}`;

      const addrLeft = await prisma.address.count({ where: { id: addr.id } });
      const subsLeft = await prisma.subscription.findMany({ where: { userId: u.id } });

      // Đúng một bên thắng, và bên thua nhận lỗi 400 rõ ràng (không phải lỗi FK thô 500).
      expect([created.status, deleted.status].sort()).toEqual(['fulfilled', 'rejected']);
      const loser = created.status === 'rejected' ? created : (deleted as PromiseRejectedResult);
      expect({ ctx, isBadRequest: (loser as PromiseRejectedResult).reason instanceof BadRequestException }).toEqual({
        ctx,
        isBadRequest: true,
      });

      if (created.status === 'fulfilled') {
        // Gói đã báo tạo thành công thì phải còn, cùng địa chỉ của nó.
        expect({ ctx, addrLeft, subIds: subsLeft.map((s) => s.id) }).toEqual({
          ctx,
          addrLeft: 1,
          subIds: [created.value.id],
        });
      } else {
        expect({ ctx, addrLeft, subs: subsLeft.length }).toEqual({ ctx, addrLeft: 0, subs: 0 });
      }
    }
  });

  it('tạo gói đã ghi nhưng chưa commit khi bắt đầu xoá (5 vòng): xoá chờ khoá rồi bị chặn, gói còn nguyên', async () => {
    const analytics = moduleRef.get(AnalyticsEventsService);
    for (let round = 0; round < 5; round++) {
      const u = await createUser(prisma);
      const v = await variation();
      const addr = await address(u.id);

      let inserted!: () => void;
      const insertedSignal = new Promise<void>((r) => (inserted = r));
      const original = analytics.record.bind(analytics);
      // record() chạy trong tx tạo gói NGAY SAU khi INSERT gói: giữ tx mở thêm một lúc để xoá chen vào.
      const spy = jest.spyOn(analytics, 'record').mockImplementation(async (...args) => {
        inserted();
        await new Promise((r) => setTimeout(r, 300));
        return original(...args);
      });
      const creating = subs.create(u.id, { variationId: v.id, quantity: 1, intervalWeeks: 4, addressId: addr.id, startDate: LATER });
      await insertedSignal;
      const deleting = users.deleteAddress(u.id, addr.id).catch((e: unknown) => e);
      const [sub, delErr] = await Promise.all([creating, deleting]);
      spy.mockRestore();

      expectAddressInUse(delErr, v.product.name);
      expect(await prisma.address.count({ where: { id: addr.id } })).toBe(1);
      expect(await prisma.subscription.findUnique({ where: { id: sub.id } })).toEqual(
        expect.objectContaining({ status: 'ACTIVE', addressId: addr.id }),
      );
    }
  });
});
