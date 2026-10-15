import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createUser, randCode, warmPool } from './helpers';

/** CTV đã mở gian hàng rồi được duyệt làm đại lý/đối tác phải đăng được sản phẩm riêng (gian hàng nâng CTV → MERCHANT). */
describe('CTV được duyệt làm đối tác (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let merchant: MerchantService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, notifications, none, none, none, none, none);
    merchant = new MerchantService(prisma, {} as OrderStatusService, notifications);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function ctvWithStore() {
    const tag = randCode(8).toLowerCase();
    const user = await createUser(prisma, { role: 'AFFILIATE' });
    const store = await prisma.storefront.create({
      data: {
        type: 'CTV', slug: `itup-${tag}`, subdomain: `itup-${tag}`, ownerUserId: user.id, title: 'Shop CTV', isPublished: true,
        collections: { create: { title: 'Sản phẩm nổi bật', sortOrder: 0 } },
      },
    });
    return { user, store, tag };
  }

  const checkOwnProducts = (userId: string) => merchant.checkPancakeVariation(userId, `khong-co-${randCode(6)}`);

  it('duyệt hồ sơ đại lý nâng gian hàng CTV sẵn có lên MERCHANT, giữ slug và bộ sưu tập, rồi đăng được sản phẩm', async () => {
    const { user, store, tag } = await ctvWithStore();
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${tag}`, name: `Bậc ${tag}`, minOrderVolume: 0, discountRules: {} } });
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const app = await prisma.dealerApplication.create({
      data: { userId: user.id, businessName: 'DN IT', ownerName: 'IT', phone: '0900000000', address: 'HN', cccdFrontUrl: 'a', cccdBackUrl: 'b' },
    });

    await admin.reviewDealerApplication(adminUser.id, app.id, true, tier.id);

    const after = await prisma.storefront.findUniqueOrThrow({ where: { id: store.id }, include: { collections: true } });
    expect(after.type).toBe('MERCHANT');
    expect(after.slug).toBe(store.slug);
    expect(after.collections).toHaveLength(1);
    await expect(checkOwnProducts(user.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tài khoản đã là DEALER nhưng còn gian hàng CTV: getOrCreateStore tự nâng lên MERCHANT', async () => {
    const { user, store } = await ctvWithStore();
    await prisma.user.update({ where: { id: user.id }, data: { role: 'DEALER' } });

    const got = await merchant.getOrCreateStore(user.id);

    expect(got.id).toBe(store.id);
    expect(got.type).toBe('MERCHANT');
    expect((await prisma.storefront.findUniqueOrThrow({ where: { id: store.id } })).type).toBe('MERCHANT');
    await expect(checkOwnProducts(user.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('CTV thường (chưa được duyệt) vẫn bị chặn đăng sản phẩm riêng', async () => {
    const { user } = await ctvWithStore();
    await expect(checkOwnProducts(user.id)).rejects.toMatchObject({ status: 403 });
  });
});
