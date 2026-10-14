import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { ReturnImagesController } from '../../src/modules/orders/return-images.controller';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * R3-UI-1: ảnh minh chứng trả hàng base64 không nhúng trong danh sách của khách, admin, gian hàng mà tải riêng qua
 * /returns/:id/images/:i?v=md5. Chạy Postgres + HTTP thật (có helmet như main.ts): md5 tính trong SQL phải khớp md5 Node
 * kiểm lúc tải ảnh, ảnh nạp được cross-origin, không có mã v đúng thì không tải được.
 */
describe('Ảnh minh chứng trả hàng phục vụ qua endpoint riêng (real Postgres + HTTP)', () => {
  let moduleRef: TestingModule;
  let app: INestApplication;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let base: string;
  const HEAVY_B64 = Buffer.alloc(300_000, 7).toString('base64');
  const HEAVY = `data:image/png;base64,${HEAVY_B64}`;
  const SECOND = `data:image/jpeg;base64,${Buffer.alloc(1_000, 3).toString('base64')}`;
  const HTTPS = 'https://res.cloudinary.com/demo/image/upload/v1/returns/a.jpg';
  const DAY = 86_400_000;
  let buyerId = '';
  let ownerId = '';
  let returnId = '';
  let merchantReturnId = '';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      controllers: [ReturnImagesController],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        { provide: AffiliateService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: {} },
        { provide: CouponsService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api');
    await app.init();
    await app.listen(0);
    base = `${await app.getUrl()}/api`.replace('[::1]', 'localhost');
    prisma = moduleRef.get(PrismaService);
    returns = moduleRef.get(OrderReturnsService);
    await warmPool(prisma);

    const tag = randCode(8).toLowerCase();
    const buyer = await createUser(prisma, { role: 'CUSTOMER' });
    buyerId = buyer.id;
    const deliveredOrder = async (extra: Record<string, unknown> = {}) =>
      createOrder(prisma, {
        userId: buyer.id,
        status: 'DELIVERED',
        deliveredAt: new Date(Date.now() - DAY),
        subtotal: 100_000,
        total: 100_000,
        items: { create: { variationId: `v-${tag}`, productName: 'SP', variationName: 'M', unitPrice: 100_000, quantity: 1, total: 100_000 } },
        ...extra,
      });
    const order = await deliveredOrder();
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const created = await returns.request(buyer.id, order.code, {
      reasonCode: 'DEFECTIVE',
      images: [HEAVY, HTTPS, SECOND],
      items: [{ orderItemId: item.id, quantity: 1 }],
    });
    returnId = created.id;

    const owner = await createUser(prisma, { role: 'DEALER' });
    ownerId = owner.id;
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itri-${tag}`, title: `Vườn IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    const mOrder = await deliveredOrder({ fulfiller: 'MERCHANT', fulfillerStorefrontId: store.id, merchantCommissionPct: 0.15 });
    const mItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: mOrder.id } });
    const mReturn = await returns.request(buyer.id, mOrder.code, {
      reasonCode: 'DEFECTIVE',
      images: [HEAVY],
      items: [{ orderItemId: mItem.id, quantity: 1 }],
    });
    merchantReturnId = mReturn.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const refOf = (id: string, i: number) => new RegExp(`^/returns/${id}/images/${i}\\?v=[0-9a-f]{32}$`);

  it('phản hồi tạo yêu cầu, danh sách của khách và của admin đều nhẹ: không base64, ảnh đầu là đường dẫn, ảnh https giữ nguyên', async () => {
    const mine = await returns.listMine(buyerId);
    const mineRow = mine.find((r) => r.id === returnId)!;
    expect(mineRow.images[0]).toMatch(refOf(returnId, 0));
    expect(mineRow.images[1]).toBe(HTTPS);
    expect(mineRow.images[2]).toMatch(refOf(returnId, 2));
    expect(JSON.stringify(mine).length).toBeLessThan(10_000);
    expect(JSON.stringify(mine)).not.toContain('base64');

    const admin = (await returns.listForAdmin('REQUESTED', 1, 100)) as { data: { id: string; images: string[] }[] };
    expect(admin.data.find((r) => r.id === returnId)!.images).toEqual(mineRow.images);
    expect(JSON.stringify(admin)).not.toContain('base64');
  });

  it('yêu cầu vừa tạo không trả lại base64', async () => {
    const order = await createOrder(prisma, {
      userId: buyerId,
      status: 'DELIVERED',
      deliveredAt: new Date(Date.now() - DAY),
      subtotal: 50_000,
      total: 50_000,
      items: { create: { variationId: 'v-echo', productName: 'SP', variationName: 'M', unitPrice: 50_000, quantity: 1, total: 50_000 } },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const out = await returns.request(buyerId, order.code, { reasonCode: 'DEFECTIVE', images: [HEAVY], items: [{ orderItemId: item.id, quantity: 1 }] });
    expect(out.images[0]).toMatch(refOf(out.id, 0));
    expect(JSON.stringify(out)).not.toContain('base64');
  });

  it('danh sách của gian hàng tự giao cũng chỉ mang đường dẫn', async () => {
    const rows = await returns.listForMerchant(ownerId);
    expect(rows.find((r) => r.id === merchantReturnId)!.images[0]).toMatch(refOf(merchantReturnId, 0));
    expect(JSON.stringify(rows)).not.toContain('base64');
  });

  it('GET đường dẫn đó trả đúng byte ảnh (md5 SQL khớp md5 Node), cache lâu riêng tư và cho phép nạp cross-origin dù có helmet', async () => {
    const mine = await returns.listMine(buyerId);
    const refs = mine.find((r) => r.id === returnId)!.images;
    const res = await fetch(`${base}${refs[0]}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(HEAVY_B64, 'base64'))).toBe(true);

    const second = await fetch(`${base}${refs[2]}`);
    expect(second.status).toBe(200);
    expect(second.headers.get('content-type')).toBe('image/jpeg');
  });

  it('không có mã v đúng thì không tải được; ảnh https, chỉ số lạ, id lạ → 404; chỉ số không phải số → 400', async () => {
    expect((await fetch(`${base}/returns/${returnId}/images/0`)).status).toBe(404);
    expect((await fetch(`${base}/returns/${returnId}/images/0?v=${'0'.repeat(32)}`)).status).toBe(404);
    expect((await fetch(`${base}/returns/${returnId}/images/0?v=abc`)).status).toBe(404);
    const mine = await returns.listMine(buyerId);
    const v = /v=([0-9a-f]{32})/.exec(mine.find((r) => r.id === returnId)!.images[0]!)![1];
    expect((await fetch(`${base}/returns/${returnId}/images/1?v=${v}`)).status).toBe(404);
    expect((await fetch(`${base}/returns/${returnId}/images/2?v=${v}`)).status).toBe(404);
    expect((await fetch(`${base}/returns/${returnId}/images/9?v=${v}`)).status).toBe(404);
    expect((await fetch(`${base}/returns/${returnId}/images/-1?v=${v}`)).status).toBe(404);
    expect((await fetch(`${base}/returns/khong-co/images/0?v=${v}`)).status).toBe(404);
    expect((await fetch(`${base}/returns/${returnId}/images/abc?v=${v}`)).status).toBe(400);
  });

  it('mã v của ảnh này không mở được ảnh của yêu cầu khác', async () => {
    const mine = await returns.listMine(buyerId);
    const v = /v=([0-9a-f]{32})/.exec(mine.find((r) => r.id === returnId)!.images[0]!)![1];
    // Hai yêu cầu cùng nội dung ảnh vẫn có mã khác nhau (mã gắn id yêu cầu và chỉ số ảnh).
    expect((await fetch(`${base}/returns/${merchantReturnId}/images/0?v=${v}`)).status).toBe(404);
    expect((await fetch(`${base}/returns/${returnId}/images/2?v=${v}`)).status).toBe(404);
  });

  it('ảnh sửa nội dung thì mã v đổi, URL cũ hết hiệu lực', async () => {
    const mine = await returns.listMine(buyerId);
    const oldRef = mine.find((r) => r.id === returnId)!.images[0]!;
    await prisma.returnRequest.update({ where: { id: returnId }, data: { images: [SECOND, HTTPS, SECOND] } });
    expect((await fetch(`${base}${oldRef}`)).status).toBe(404);
    const after = await returns.listMine(buyerId);
    expect((await fetch(`${base}${after.find((r) => r.id === returnId)!.images[0]}`)).status).toBe(200);
  });
});
