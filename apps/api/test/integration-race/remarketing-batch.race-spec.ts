import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RemarketingService } from '../../src/modules/lifecycle/remarketing.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * OPS-04 trên Postgres THẬT: lô 200 của nhắc giỏ bỏ quên / nhắc voucher chỉ gồm việc còn phải làm. 200 giỏ đã nhắc (còn nằm
 * trong cửa sổ 6–72 giờ) và 200 coupon USER_GROUP thiếu scopeMeta.userId không được chiếm chỗ của giỏ/coupon cần nhắc.
 */
const HOUR = 3_600_000;
const BULK = 200;

describe('Remarketing batch không bị việc đã xong chiếm chỗ (real Postgres)', () => {
  let prisma: PrismaService;
  let svc: RemarketingService;
  let notify: jest.Mock;
  const tag = randCode(8);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await setConfig(prisma, 'remarketing.cart_abandon_min_hours', 6);
    await setConfig(prisma, 'remarketing.cart_abandon_max_hours', 72);
  });

  beforeEach(() => {
    notify = jest.fn().mockResolvedValue(undefined);
    svc = new RemarketingService(prisma, new SystemConfigService(prisma), { notify } as unknown as NotificationsService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function variation() {
    const product = await prisma.product.create({
      data: { pancakeId: `rm-p-${tag}`, brand: 'IT', slug: `rm-sp-${tag.toLowerCase()}`, name: `SP RM ${tag}`, description: 'IT', basePrice: 50_000, isActive: true, approvalStatus: 'APPROVED', thumbnail: 'https://img.test/x.jpg' },
    });
    return prisma.variation.create({
      data: { pancakeId: `rm-v-${tag}`, productId: product.id, sku: `RM-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 50_000, stock: 100, isActive: true },
    });
  }

  it('200 giỏ đã nhắc không chặn giỏ mới: giỏ cần nhắc vẫn được nhắc', async () => {
    const v = await variation();
    const now = Date.now();
    const updatedAt = new Date(now - 20 * HOUR);
    const remindedAt = new Date(now - 10 * HOUR);
    const userIds: string[] = [];
    for (let i = 0; i < BULK + 1; i += 20) {
      const part = await Promise.all(Array.from({ length: Math.min(20, BULK + 1 - i) }, () => createUser(prisma)));
      userIds.push(...part.map((u) => u.id));
    }
    const fresh = userIds.pop()!;
    for (const userId of userIds) {
      const cart = await prisma.cart.create({ data: { userId, updatedAt, abandonRemindedAt: remindedAt } });
      await prisma.cartItem.create({ data: { cartId: cart.id, variationId: v.id, quantity: 1 } });
    }
    // Mới hơn 200 giỏ kia nên orderBy updatedAt asc xếp sau cùng: chỉ việc lọc giỏ đã nhắc trong truy vấn mới đưa nó vào lô.
    // Mốc nhắc cũ hơn updatedAt = khách sửa giỏ sau lần nhắc trước, nên vẫn phải được nhắc lại.
    const cart = await prisma.cart.create({ data: { userId: fresh, updatedAt: new Date(now - 8 * HOUR), abandonRemindedAt: new Date(now - 30 * HOUR) } });
    await prisma.cartItem.create({ data: { cartId: cart.id, variationId: v.id, quantity: 2 } });

    await svc.sendCartAbandonReminders();

    const calls = notify.mock.calls.filter((c) => c[1] === 'CART_ABANDONED');
    expect(calls.map((c) => c[0])).toContain(fresh);
    expect(calls.map((c) => c[0])).not.toContain(userIds[0]);
  }, 120_000);

  it('200 coupon USER_GROUP thiếu scopeMeta.userId không chặn coupon cá nhân sắp hết hạn', async () => {
    const endAt = new Date(Date.now() + 24 * HOUR);
    const base = { type: 'AMOUNT' as const, value: 10_000, startAt: new Date(Date.now() - 24 * HOUR), endAt, scope: 'USER_GROUP' as const, usageLimit: 1 };
    await prisma.coupon.createMany({
      data: Array.from({ length: BULK + 1 }, (_, i) => ({ ...base, code: `RM-BAD-${tag}-${i}`, scopeMeta: i % 2 ? {} : { reason: 'x' } })),
    });
    const u = await createUser(prisma);
    await prisma.coupon.create({ data: { ...base, endAt: new Date(Date.now() + 48 * HOUR), code: `RM-OK-${tag}`, scopeMeta: { userId: u.id } } });

    await svc.sendVoucherExpiryReminders();

    const calls = notify.mock.calls.filter((c) => c[1] === 'VOUCHER_EXPIRING');
    expect(calls.map((c) => c[0])).toContain(u.id);
  }, 120_000);
});
