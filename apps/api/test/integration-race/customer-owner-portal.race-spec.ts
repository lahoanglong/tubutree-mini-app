import type { INestApplication } from '@nestjs/common';
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
import { MerchantController } from '../../src/modules/merchant/merchant.controller';
import { MerchantService } from '../../src/modules/merchant/merchant.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

const DAY = 86_400_000;

/**
 * Chủ gian hàng vai trò CUSTOMER còn phiếu đối soát vào Cổng người bán qua HTTP thật (guard thật, Postgres thật): đúng 4 route
 * (xem gian hàng, hàng trả về, nhận hàng trả, bảng kê) và chỉ khi gian hàng có phiếu; mọi route khác vẫn 403.
 */
describe('Cổng người bán cho chủ CUSTOMER còn phiếu đối soát (real Postgres, HTTP)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let base: string;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let settlement: MerchantFulfilmentService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      controllers: [MerchantController],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        MerchantService,
        MerchantFulfilmentService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { headers: Record<string, string>; user?: unknown } } }) => {
          const req = ctx.switchToHttp().getRequest();
          const [sub, role] = (req.headers['x-test-user'] ?? '').split(':');
          if (!sub || !role) return false;
          req.user = { sub, role };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 1);
    returns = moduleRef.get(OrderReturnsService);
    settlement = moduleRef.get(MerchantFulfilmentService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const call = async (user: { id: string; role: string }, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}/merchant${path}`, {
      method,
      headers: { 'x-test-user': `${user.id}:${user.role}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- phản hồi nhiều dạng (đối tượng hoặc mảng), mỗi test tự khẳng định phần cần
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };

  /** Chủ có gian hàng CTV đã tắt cờ, một đơn COD tự giao đã giao, có phiếu SALE đã trả (khi `payouts`), khách trả một quả và admin duyệt. */
  async function setup(opts: { role: 'CUSTOMER' | 'AFFILIATE'; payouts: boolean }) {
    const owner = await createUser(prisma, { role: 'AFFILIATE' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'CTV', isPartner: true, slug: `itco-${tag}`, title: `Vườn IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'MERCHANT',
        brand: 'IT',
        slug: `itco-${tag}`,
        name: `Bưởi ${tag}`,
        description: 'IT',
        basePrice: 50_000,
        variations: { create: { sku: `ITCO-${tag}`, name: 'Quả', attributes: {}, retailPrice: 50_000, stock: 10 } },
      },
      include: { variations: true },
    });
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: buyer.id,
      status: 'DELIVERED',
      deliveredAt: new Date(Date.now() - 2 * DAY),
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: store.id,
      merchantCommissionPct: 0.15,
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 100_000,
      shippingFee: 30_000,
      total: 130_000,
      items: { create: { variationId: product.variations[0]!.id, productName: 'Bưởi', variationName: 'Quả', unitPrice: 50_000, quantity: 2, total: 100_000 } },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    if (opts.payouts) {
      const sale = await settlement.createPayout('admin-it', store.id);
      await settlement.markPayoutPaid('admin-it', sale.id, 'FT-IT');
    }
    const r = await returns.request(buyer.id, order.code, { reasonCode: 'OTHER', reason: 'Một quả bị dập khi nhận', items: [{ orderItemId: item.id, quantity: 1 }] });
    await returns.review(admin.id, r.id, { approve: true });
    await prisma.product.updateMany({ where: { storefrontId: store.id }, data: { isActive: false } });
    await prisma.storefront.update({ where: { id: store.id }, data: { isPartner: false } });
    await prisma.user.update({ where: { id: owner.id }, data: { role: opts.role } });
    return { owner: { id: owner.id, role: opts.role as string }, store, order, item, request: r };
  }
  const stockOf = async (orderId: string) => {
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    return (await prisma.variation.findUniqueOrThrow({ where: { id: item.variationId! } })).stock;
  };
  const slipOf = (storeId: string) => prisma.merchantPayout.findMany({ where: { storefrontId: storeId }, include: { lines: true }, orderBy: { createdAt: 'asc' } });
  const slipSummary = (s: Awaited<ReturnType<typeof slipOf>>) =>
    s.map((p) => ({ status: p.status, lines: p.lines.map((l) => `${l.kind}:${l.amount}`).sort() }));

  it('CUSTOMER chủ gian hàng có phiếu: xem gian hàng, danh sách, nhận hàng trả (kho +1, phiếu như chủ AFFILIATE) và bảng kê', async () => {
    const c = await setup({ role: 'CUSTOMER', payouts: true });
    const a = await setup({ role: 'AFFILIATE', payouts: true });
    const before = await stockOf(c.order.id);

    const store = await call(c.owner, 'GET', '/store');
    expect(store.status).toBe(200);
    expect(store.json).toMatchObject({ id: c.store.id, hasPayouts: true });
    const list = await call(c.owner, 'GET', '/returns');
    expect(list.status).toBe(200);
    expect(list.json.map((x: { id: string }) => x.id)).toEqual([c.request.id]);
    const slipBefore = slipSummary(await slipOf(c.store.id));

    const received = await call(c.owner, 'POST', `/returns/${c.request.id}/received`);
    expect(received.status).toBeLessThan(300);
    expect(received.json.receivedAt).toBeTruthy();
    expect(await stockOf(c.order.id)).toBe(before + 1);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: c.request.id } })).receivedBy).toBe(c.owner.id);

    const aReceived = await call(a.owner, 'POST', `/returns/${a.request.id}/received`);
    expect(aReceived.status).toBeLessThan(300);
    expect(slipSummary(await slipOf(c.store.id))).toEqual(slipBefore);
    expect(slipSummary(await slipOf(c.store.id))).toEqual(slipSummary(await slipOf(a.store.id)));

    const statement = await call(c.owner, 'GET', '/settlement');
    expect(statement.status).toBe(200);
  });

  it('CUSTOMER chủ gian hàng KHÔNG có phiếu: 4 route đều 403, không cộng kho', async () => {
    const c = await setup({ role: 'CUSTOMER', payouts: false });
    const before = await stockOf(c.order.id);
    for (const [m, p] of [['GET', '/store'], ['GET', '/returns'], ['POST', `/returns/${c.request.id}/received`], ['GET', '/settlement']] as const) {
      expect((await call(c.owner, m, p)).status).toBe(403);
    }
    expect(await stockOf(c.order.id)).toBe(before);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: c.request.id } })).receivedAt).toBeNull();
  });

  it('CUSTOMER không có gian hàng: 403 và không tạo gian hàng', async () => {
    const u = await createUser(prisma, { role: 'CUSTOMER' });
    const user = { id: u.id, role: 'CUSTOMER' };
    for (const [m, p] of [['GET', '/store'], ['GET', '/returns'], ['POST', '/returns/x/received'], ['GET', '/settlement']] as const) {
      expect((await call(user, m, p)).status).toBe(403);
    }
    expect(await prisma.storefront.count({ where: { ownerUserId: u.id } })).toBe(0);
  });

  it('CUSTOMER chủ gian hàng có phiếu vẫn 403 ở mọi route khác của /merchant', async () => {
    const c = await setup({ role: 'CUSTOMER', payouts: true });
    const calls: [string, string, unknown?][] = [
      ['POST', '/products', { name: 'x', description: 'x', basePrice: 1000, stock: 1 }],
      ['GET', '/products'],
      ['PATCH', '/products/x', {}],
      ['DELETE', '/products/x'],
      ['PUT', '/store', { title: 'Đổi tên' }],
      ['POST', '/store/publish', { isPublished: true }],
      ['POST', '/store/pause', { paused: true }],
      ['GET', '/fulfil-orders'],
      ['POST', `/fulfil-orders/${c.order.id}/accept`],
      ['POST', `/fulfil-orders/${c.order.id}/cancel`, { reason: 'x' }],
      ['GET', '/orders'],
      ['PUT', `/orders/${c.order.id}/status`, { status: 'CANCELLED' }],
      ['POST', '/resell-products', { productId: 'x' }],
      ['DELETE', '/resell-products/x'],
      ['GET', '/pancake-variations/ABC'],
    ];
    for (const [m, p, b] of calls) expect([m, p, (await call(c.owner, m, p, b)).status]).toEqual([m, p, 403]);
    expect((await prisma.storefront.findUniqueOrThrow({ where: { id: c.store.id } })).title).toBe(c.store.title);
    expect(await prisma.product.count({ where: { storefrontId: c.store.id } })).toBe(1);
  });

  it('CUSTOMER khác (cũng có gian hàng và phiếu) không nhận được hàng trả của gian hàng người khác', async () => {
    const victim = await setup({ role: 'CUSTOMER', payouts: true });
    const other = await setup({ role: 'CUSTOMER', payouts: true });
    const before = await stockOf(victim.order.id);
    const res = await call(other.owner, 'POST', `/returns/${victim.request.id}/received`);
    expect(res.status).toBe(404);
    expect(await stockOf(victim.order.id)).toBe(before);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: victim.request.id } })).receivedAt).toBeNull();
    expect((await call(other.owner, 'GET', '/returns')).json.map((x: { id: string }) => x.id)).not.toContain(victim.request.id);
  });
});
