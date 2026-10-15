import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/** Lời báo đúng ngữ cảnh cho đối tác: huỷ lại đơn đã huỷ, và chạm đơn của gian hàng khác (không lộ đơn có tồn tại). */
describe('Lời báo cho đối tác (real Postgres)', () => {
  let prisma: PrismaService;
  let fulfilment: MerchantFulfilmentService;
  let merchant: MerchantService;
  const setStatus = jest.fn();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
    fulfilment = new MerchantFulfilmentService(prisma, { setStatus } as unknown as OrderStatusService, notifications, new SystemConfigService(prisma));
    merchant = new MerchantService(prisma, { setStatus } as unknown as OrderStatusService, notifications);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function shop() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itcp-${tag}`, title: `Gian hàng ${tag}`, ownerUserId: owner.id, commissionPct: 0.15, isPublished: true },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id, fulfilment: 'MERCHANT', brand: 'IT', slug: `itcp-p-${tag}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000,
        variations: { create: { sku: `ITCP-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 40 } },
      },
      include: { variations: true },
    });
    return { owner, store, variationId: product.variations[0]!.id };
  }

  async function selfShipOrder(s: Awaited<ReturnType<typeof shop>>, status: 'CANCELLED' | 'CONFIRMED') {
    const buyer = await createUser(prisma);
    return createOrder(prisma, {
      userId: buyer.id,
      status,
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: s.store.id,
      paymentMethod: 'COD',
      subtotal: 100_000,
      total: 100_000,
      items: { create: { variationId: s.variationId, productName: 'SP IT', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 } },
    });
  }

  beforeEach(() => setStatus.mockReset());

  it('huỷ lại đơn đã CANCELLED → 409 "Đơn này đã được huỷ."', async () => {
    const s = await shop();
    const order = await selfShipOrder(s, 'CANCELLED');
    await expect(fulfilment.cancel(s.owner.id, order.id, 'nhầm')).rejects.toMatchObject({
      status: 409,
      message: 'Đơn này đã được huỷ.',
    });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('đơn đã gửi đi (SHIPPING) vẫn báo "Đơn đã gửi đi thì không huỷ được"', async () => {
    const s = await shop();
    const order = await selfShipOrder(s, 'CONFIRMED');
    await prisma.order.update({ where: { id: order.id }, data: { status: 'SHIPPING' } });
    await expect(fulfilment.cancel(s.owner.id, order.id, 'nhầm')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Đơn đã gửi đi thì không huỷ được'),
    });
  });

  it('đối tác B đổi trạng thái đơn tự giao của đối tác A → 404 "Không tìm thấy đơn của gian hàng bạn."', async () => {
    const a = await shop();
    const b = await shop();
    const order = await selfShipOrder(a, 'CONFIRMED');
    await expect(merchant.updateMerchantOrderStatus(b.owner.id, order.id, 'DELIVERED')).rejects.toMatchObject({
      status: 404,
      message: 'Không tìm thấy đơn của gian hàng bạn.',
    });
    await expect(merchant.updateMerchantOrderStatus(b.owner.id, 'khong-ton-tai', 'DELIVERED')).rejects.toMatchObject({
      status: 404,
      message: 'Không tìm thấy đơn của gian hàng bạn.',
    });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('đơn của chính gian hàng vẫn bị chặn 403 (kho Tubu xử lý giao nhận), không đổi trạng thái', async () => {
    const a = await shop();
    const order = await selfShipOrder(a, 'CONFIRMED');
    await expect(merchant.updateMerchantOrderStatus(a.owner.id, order.id, 'DELIVERED')).rejects.toMatchObject({ status: 403 });
    expect(setStatus).not.toHaveBeenCalled();
  });
});
