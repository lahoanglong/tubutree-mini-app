import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, deleteItData, randCode, warmPool } from './helpers';

type ReturnPage = { data: { id: string }[]; meta: { total: number } };
type RefundPage = { data: { id: string }[]; meta: { total: number } };

const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

/**
 * Ô tìm của admin ở danh sách đổi/trả và hoàn tiền khách: khớp mã đơn chính xác hoặc SĐT khách. Danh sách "Chờ nhận hàng về" là SQL
 * thô (`= ANY(text[])`) nên phải chạy trên Postgres thật; không có chuỗi tìm thì kết quả y như cũ.
 */
describe('Tìm theo mã đơn hoặc SĐT ở danh sách đổi/trả và hoàn tiền khách (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let refunds: CustomerRefundsService;
  const userIds: string[] = [];
  const productIds: string[] = [];

  beforeAll(async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify, notifySafe: notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    refunds = new CustomerRefundsService(prisma, { notify } as never);
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await moduleRef?.close();
  });

  async function approvedReturn(buyerPhone: string, status: 'APPROVED' | 'REQUESTED' = 'APPROVED') {
    const buyer = await createUser(prisma, { role: 'CUSTOMER', phone: buyerPhone });
    userIds.push(buyer.id);
    const tag = randCode(6);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', deliveredAt: new Date(), total: 100_000, subtotal: 100_000 });
    const product = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itsearch-${tag}`,
        name: `Hàng ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITS-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 5 } },
      },
      include: { variations: true },
    });
    productIds.push(product.id);
    const item = await prisma.orderItem.create({
      data: { orderId: order.id, variationId: product.variations[0]!.id, productName: 'Hàng', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 },
    });
    const req = await prisma.returnRequest.create({
      data: {
        orderId: order.id,
        userId: buyer.id,
        reason: 'Trả hàng',
        status,
        ...(status === 'APPROVED' ? { reviewedAt: new Date() } : {}),
        items: { create: { orderItemId: item.id, quantity: 1 } },
      },
    });
    return { buyer, order, req };
  }

  const ids = (page: unknown) => (page as ReturnPage).data.map((r) => r.id);

  it('"Chờ nhận hàng về" (SQL thô): mã đơn, mã đơn gõ thường và SĐT đủ khớp đúng yêu cầu; chuỗi không khớp ai thì rỗng; bỏ q thì như cũ', async () => {
    const mine = await approvedReturn(phone());
    const other = await approvedReturn(phone());

    const unfiltered = ids(await returns.listForAdmin('TO_RECEIVE', 1, 500));
    expect(unfiltered).toEqual(expect.arrayContaining([mine.req.id, other.req.id]));

    expect(ids(await returns.listForAdmin('TO_RECEIVE', 1, 50, undefined, mine.order.code))).toEqual([mine.req.id]);
    expect(ids(await returns.listForAdmin('TO_RECEIVE', 1, 50, undefined, mine.order.code.toLowerCase()))).toEqual([mine.req.id]);
    expect(ids(await returns.listForAdmin('TO_RECEIVE', 1, 50, undefined, mine.buyer.phone!))).toEqual([mine.req.id]);
    const none = (await returns.listForAdmin('TO_RECEIVE', 1, 50, undefined, 'KHONG-CO-MA-NAY-0')) as ReturnPage;
    expect(none.data).toEqual([]);
    expect(none.meta.total).toBe(0);
  });

  it('danh sách theo trạng thái (Prisma): REQUESTED lọc theo q và chỉ trả yêu cầu đúng trạng thái', async () => {
    const waiting = await approvedReturn(phone(), 'REQUESTED');
    const approved = await approvedReturn(waiting.buyer.phone!.replace(/\d$/, (d) => String((Number(d) + 1) % 10)), 'APPROVED');
    expect(ids(await returns.listForAdmin('REQUESTED', 1, 50, undefined, waiting.order.code))).toEqual([waiting.req.id]);
    expect(ids(await returns.listForAdmin('REQUESTED', 1, 50, undefined, approved.order.code))).toEqual([]);
    expect(ids(await returns.listForAdmin(undefined, 1, 50, undefined, approved.order.code))).toEqual([approved.req.id]);
  });

  async function refundRow(over: { phone: string; kind?: 'END_CUSTOMER' | 'RETURN' }) {
    const owner = await createUser(prisma, { role: 'CUSTOMER' });
    userIds.push(owner.id);
    const order = await createOrder(prisma, { userId: owner.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', total: 90_000 });
    return prisma.orderCustomerRefund.create({
      data: {
        orderId: order.id,
        orderCode: order.code,
        kind: over.kind ?? 'END_CUSTOMER',
        userId: null,
        phone: over.phone,
        recipientName: 'Khách cuối',
        amount: 90_000,
        method: 'MANUAL_TRANSFER',
        status: 'PENDING',
        reason: 'CANCELLED',
      },
    });
  }

  it('hoàn tiền khách: q theo mã đơn và SĐT; người xem bị che SĐT chỉ tìm được bằng đủ số', async () => {
    const mineNo = phone();
    const mine = await refundRow({ phone: mineNo });
    const other = await refundRow({ phone: phone() });

    const all = ids(await refunds.list('OPEN', 1, 500));
    expect(all).toEqual(expect.arrayContaining([mine.id, other.id]));

    expect(ids(await refunds.list('OPEN', 1, 50, undefined, { q: mine.orderCode }))).toEqual([mine.id]);
    expect(ids(await refunds.list('OPEN', 1, 50, undefined, { q: mine.orderCode.toLowerCase() }))).toEqual([mine.id]);
    expect(ids(await refunds.list('OPEN', 1, 50, undefined, { q: mineNo }))).toEqual([mine.id]);
    expect(ids(await refunds.list('OPEN', 1, 50, undefined, { q: mineNo.slice(0, 7) }))).toEqual(expect.arrayContaining([mine.id]));
    expect(ids(await refunds.list('OPEN', 1, 50, undefined, { q: mineNo.slice(0, 7), exactPhoneOnly: true }))).not.toContain(mine.id);
    expect(ids(await refunds.list('OPEN', 1, 50, undefined, { q: mineNo, exactPhoneOnly: true }))).toEqual([mine.id]);
    const none = (await refunds.list('OPEN', 1, 50, undefined, { q: 'KHONG-CO-MA-NAY-0' })) as RefundPage;
    expect(none.data).toEqual([]);
    expect(none.meta.total).toBe(0);
  });
});
