import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { OpsInboxService, type InboxKey } from '../../src/modules/ops/ops-inbox.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 86_400_000;

/**
 * R4-ADMIN-7 trên Postgres THẬT: việc admin phải làm với đối tác (xác nhận hàng ký gửi takeover, lập phiếu đối soát,
 * đánh dấu đã chuyển/đã thu) hiện ở "Việc cần xử lý", và số đếm khớp đúng các danh sách admin mở ra khi bấm vào.
 */
describe('Việc cần xử lý với đối tác (real Postgres)', () => {
  let prisma: PrismaService;
  let fulfilment: MerchantFulfilmentService;
  let inbox: OpsInboxService;
  let admin: AdminService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.commission_pct', 0.15);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    fulfilment = new MerchantFulfilmentService(prisma, undefined as never, notifications, new SystemConfigService(prisma));
    inbox = new OpsInboxService(prisma, fulfilment);
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, notifications, none, none, none, none, none);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const counts = async () => {
    const res = await inbox.counts({ role: 'ADMIN' });
    return (k: InboxKey) => res.items.find((i) => i.key === k)?.count ?? 0;
  };

  async function shop() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `ittodo-${tag}`, title: `Gian hàng ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'MERCHANT',
        brand: 'IT',
        slug: `ittodo-p-${tag}`,
        name: `Sản phẩm ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITTODO-${tag}`, pancakeId: `ittodo-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 40 } },
      },
      include: { variations: true },
    });
    return { store, variationId: product.variations[0]!.id, productId: product.id };
  }

  async function deliveredOrder(s: Awaited<ReturnType<typeof shop>>, deliveredDaysAgo: number) {
    const buyer = await createUser(prisma, { role: 'CUSTOMER' });
    return createOrder(prisma, {
      userId: buyer.id,
      status: 'DELIVERED',
      deliveredAt: new Date(Date.now() - deliveredDaysAgo * DAY),
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: s.store.id,
      merchantCommissionPct: 0.15,
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 100_000,
      total: 100_000,
      items: { create: { variationId: s.variationId, productName: 'SP IT', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 } },
    });
  }

  const link = (s: Awaited<ReturnType<typeof shop>>, extra: Record<string, unknown>) =>
    prisma.merchantPancakeLink.create({
      data: { storefrontId: s.store.id, productId: s.productId, variationId: s.variationId, linkedAt: new Date(Date.now() - 30 * DAY), ...extra },
    });

  it('liên kết takeover chưa xác nhận được đếm và lọc ra ở màn Duyệt SP đối tác; xác nhận rồi thì hết', async () => {
    const before = await counts();
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const pending = await shop();
    const plain = await shop();
    const confirmed = await shop();
    const gone = await shop();
    const pendingLink = await link(pending, { takeover: true });
    await link(plain, { takeover: false });
    await link(confirmed, { takeover: true, consignmentConfirmedAt: new Date(), consignmentConfirmedBy: adminUser.id });
    await link(gone, { takeover: true, unlinkedAt: new Date() });

    const after = await counts();
    expect(after('consignmentPending') - before('consignmentPending')).toBe(1);

    const listed = await admin.listLinkedMerchantProducts(1, 100, 'PENDING');
    const ids = listed.data.map((l) => l.id);
    expect(ids).toContain(pendingLink.id);
    expect(listed.data.every((l) => l.takeover && l.consignmentConfirmedAt === null)).toBe(true);
    expect(listed.meta.total).toBe(after('consignmentPending'));

    await fulfilment.confirmConsignment(adminUser.id, pendingLink.id);
    const done = await counts();
    expect(done('consignmentPending')).toBe(before('consignmentPending'));
    expect((await admin.listLinkedMerchantProducts(1, 100, 'PENDING')).data.map((l) => l.id)).not.toContain(pendingLink.id);
  });

  it('khoản đủ hạn chờ lập phiếu → phiếu chờ chuyển/thu → đã chuyển: ba số đi đúng và khớp danh sách phiếu', async () => {
    const before = await counts();
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop();
    const fresh = await shop();
    await deliveredOrder(s, 10);
    await deliveredOrder(fresh, 2);

    const afterSale = await counts();
    expect(afterSale('merchantToSettle') - before('merchantToSettle')).toBe(1);
    expect(afterSale('merchantPayoutsPending') - before('merchantPayoutsPending')).toBe(0);

    const payout = await fulfilment.createPayout(adminUser.id, s.store.id);
    const afterSlip = await counts();
    expect(afterSlip('merchantToSettle') - before('merchantToSettle')).toBe(0);
    expect(afterSlip('merchantPayoutsPending') - before('merchantPayoutsPending')).toBe(1);

    const pendingSlips = await fulfilment.listPayouts(undefined, 1, 100, 'PENDING');
    expect(pendingSlips.data.map((p) => p.id)).toContain(payout.id);
    expect(pendingSlips.data.every((p) => p.status === 'PENDING')).toBe(true);
    expect(pendingSlips.meta.total).toBe(afterSlip('merchantPayoutsPending'));

    await fulfilment.markPayoutPaid(adminUser.id, payout.id, 'FT-IT-1');
    const paid = await counts();
    expect(paid('merchantPayoutsPending')).toBe(before('merchantPayoutsPending'));
    expect((await fulfilment.listPayouts(undefined, 1, 100, 'PENDING')).data.map((p) => p.id)).not.toContain(payout.id);

    await fulfilment.listPayouts(s.store.id, 1, 20).then((all) => expect(all.data.map((p) => p.id)).toContain(payout.id));
  });

  it('nhân viên (CSKH/KHO) không thấy các việc đối tác', async () => {
    const staff = await inbox.counts({ role: 'STAFF', staffPermissions: ['CSKH', 'KHO'] });
    const keys = staff.items.map((i) => i.key);
    expect(keys).not.toContain('consignmentPending');
    expect(keys).not.toContain('merchantToSettle');
    expect(keys).not.toContain('merchantPayoutsPending');
  });
});
