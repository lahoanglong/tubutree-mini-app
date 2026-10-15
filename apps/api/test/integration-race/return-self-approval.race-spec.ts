import { type CanActivate, type ExecutionContext, type INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { ReturnsAdminController } from '../../src/modules/orders/returns-admin.controller';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

const DAY = 86_400_000;

/** Giả JwtAuthGuard: tin header x-test-user (id người dùng), gắn payload như JwtStrategy (sub = user id). */
class HeaderAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; user?: { sub: string; role: string } }>();
    req.user = { sub: req.headers['x-test-user']!, role: 'STAFF' };
    return true;
  }
}

/**
 * AUTHZ-1: STAFF có nhóm CSKH gửi yêu cầu trả hàng cho đơn của chính mình (route khách không có @Roles) rồi tự duyệt
 * "lỗi do shop" qua /admin/return-requests/:id/review → Ví cộng ngay trước khi hàng về. Người gửi yêu cầu không được duyệt,
 * không được bấm "đã nhận hàng"; người khác duyệt đơn của họ vẫn chạy như cũ. Postgres + HTTP thật.
 */
describe('Không tự duyệt yêu cầu trả hàng của chính mình (real Postgres + HTTP)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let base: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      controllers: [ReturnsAdminController],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        { provide: APP_GUARD, useClass: HeaderAuthGuard },
        {
          provide: AffiliateService,
          useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined), lockCommissionsForOrder: jest.fn() },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api`.replace('[::1]', 'localhost');
    prisma = moduleRef.get(PrismaService);
    returns = moduleRef.get(OrderReturnsService);
    await warmPool(prisma);
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (as: string, path: string, body: unknown = {}) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': as }, body: JSON.stringify(body) });

  /** Đơn DELIVERED 300.000 đã thu (COD) của `buyerId`, và yêu cầu trả cả đơn đúng như khách gửi. */
  async function requestedReturn(buyerId: string) {
    const tag = randCode(6);
    const order = await createOrder(prisma, {
      userId: buyerId,
      status: 'DELIVERED',
      deliveredAt: new Date(Date.now() - DAY),
      subtotal: 300_000,
      total: 300_000,
      items: { create: { variationId: `v-${tag}`, productName: 'SP', variationName: 'M', unitPrice: 300_000, quantity: 1, total: 300_000 } },
    });
    const req = await returns.request(buyerId, order.code, { reasonCode: 'DEFECTIVE' });
    return { order, req };
  }

  const wallet = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { walletBalance: true } })).walletBalance;

  it('STAFF CSKH tự duyệt (lỗi do shop) yêu cầu của mình → 403, Ví không đổi, đơn vẫn DELIVERED, yêu cầu vẫn REQUESTED', async () => {
    const staff = await createUser(prisma, { role: 'STAFF', staffPermissions: ['CSKH'], walletBalance: 0 });
    const { order, req } = await requestedReturn(staff.id);

    const res = await post(staff.id, `/admin/return-requests/${req.id}/review`, { approve: true, shopFault: true });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toContain('chính mình');

    expect(await wallet(staff.id)).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('DELIVERED');
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('REQUESTED');
    expect(await prisma.walletTransaction.count({ where: { userId: staff.id } })).toBe(0);
  });

  it('chủ tài khoản ADMIN cũng không tự duyệt hay từ chối yêu cầu của mình (dùng tài khoản thứ hai)', async () => {
    const owner = await createUser(prisma, { role: 'ADMIN', walletBalance: 0 });
    const { req } = await requestedReturn(owner.id);

    expect((await post(owner.id, `/admin/return-requests/${req.id}/review`, { approve: true })).status).toBe(403);
    expect((await post(owner.id, `/admin/return-requests/${req.id}/review`, { approve: false, note: 'không cần nữa' })).status).toBe(403);
    expect(await wallet(owner.id)).toBe(0);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('REQUESTED');
  });

  it('duyệt yêu cầu của người khác vẫn chạy: Ví người mua cộng đúng 300.000 một lần, người duyệt không được cộng', async () => {
    const staff = await createUser(prisma, { role: 'STAFF', staffPermissions: ['CSKH'], walletBalance: 0 });
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const { order, req } = await requestedReturn(buyer.id);

    const res = await post(staff.id, `/admin/return-requests/${req.id}/review`, { approve: true, note: 'Đồng ý' });
    expect(res.status).toBe(201);
    expect(await wallet(buyer.id)).toBe(300_000);
    expect(await wallet(staff.id)).toBe(0);
    const stored = await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(stored.status).toBe('APPROVED');
    expect(stored.reviewedBy).toBe(staff.id);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('RETURNED');
  });

  it('"Đã nhận hàng về": người gửi yêu cầu bị 403 và kho không đổi; người khác (KHO) nhận bình thường', async () => {
    const warehouse = await createUser(prisma, { role: 'STAFF', staffPermissions: ['KHO'] });
    const buyer = await createUser(prisma, { role: 'STAFF', staffPermissions: ['KHO'], walletBalance: 0 });
    const reviewer = await createUser(prisma, { role: 'ADMIN' });
    const { req } = await requestedReturn(buyer.id);
    expect((await post(reviewer.id, `/admin/return-requests/${req.id}/review`, { approve: true })).status).toBe(201);

    const own = await post(buyer.id, `/admin/return-requests/${req.id}/received`);
    expect(own.status).toBe(403);
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } })).receivedAt).toBeNull();

    const other = await post(warehouse.id, `/admin/return-requests/${req.id}/received`);
    expect(other.status).toBe(201);
    const stored = await prisma.returnRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(stored.receivedAt).not.toBeNull();
    expect(stored.receivedBy).toBe(warehouse.id);
  });
});
