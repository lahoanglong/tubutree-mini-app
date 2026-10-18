import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createDealer, createOrder, createUser, deleteItData, randCode } from './helpers';
import {
  cleanupWaste, createGiftRedemption, createWarehouse, createWastePoint, createWasteItem, createWasteRequest,
} from './fixtures/waste-fixtures';

/** Dọn dữ liệu spec phải chạy được trên DB thật: không vấp khoá ngoại RESTRICT nào, và không lỗi khi mảng id rỗng. */
describe('deleteItData (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function count(table: string, column: string, ids: string[]) {
    const [row] = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS "n" FROM "${table}" WHERE "${column}" = ANY($1::text[])`,
      ids,
    );
    return row.n;
  }

  it('xoá khách có đủ loại dữ liệu, sản phẩm và đợt giờ vàng mà không vấp khoá ngoại', async () => {
    const tag = randCode(8);
    const user = await createUser(prisma);
    const affiliate = await createUser(prisma);
    const dealer = await createDealer(prisma);
    const userIds = [user.id, affiliate.id, dealer.id];
    const product = await prisma.product.create({
      data: { pancakeId: `itdel-p-${tag}`, brand: 'IT', slug: `itdel-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 10_000 },
    });
    const variation = await prisma.variation.create({
      data: { pancakeId: `itdel-v-${tag}`, productId: product.id, sku: `ITDEL-${tag}`, name: 'Chai', attributes: {}, retailPrice: 10_000, stock: 5 },
    });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      items: {
        create: [{ variationId: variation.id, productName: 'SP', variationName: 'Chai', unitPrice: 10_000, quantity: 1, total: 10_000 }],
      },
    });
    const dealerOrder = await createOrder(prisma, { userId: dealer.id, type: 'DEALER' });
    const id = (p: string) => `itdel-${p}-${tag}`;

    await prisma.$executeRaw`
      INSERT INTO "flash_sales" ("id", "title", "startAt", "endAt", "createdBy", "updatedAt")
      VALUES (${id('fs')}, 'IT', now(), now() + interval '1 hour', ${user.id}, now())`;
    await prisma.$executeRaw`
      INSERT INTO "flash_sale_items" ("id", "flashSaleId", "variationId", "flashPrice", "quota", "perUserLimit")
      VALUES (${id('fsi')}, ${id('fs')}, ${variation.id}, 5000, 10, 2)`;
    await prisma.$executeRaw`
      INSERT INTO "flash_sale_purchases" ("id", "flashSaleItemId", "userId", "updatedAt") VALUES (${id('fsp')}, ${id('fsi')}, ${user.id}, now())`;
    await prisma.$executeRaw`
      INSERT INTO "points_transactions" ("id", "userId", "delta", "reason") VALUES (${id('pt')}, ${user.id}, 5, 'IT')`;
    await prisma.$executeRaw`
      INSERT INTO "wallet_transactions" ("id", "userId", "type", "delta", "balanceAfter") VALUES (${id('wt')}, ${user.id}, 'ADJUST', 1000, 1000)`;
    await prisma.$executeRaw`
      INSERT INTO "coin_transactions" ("id", "userId", "delta", "reason") VALUES (${id('ct')}, ${user.id}, 3, 'IT')`;
    await prisma.$executeRaw`
      INSERT INTO "return_requests" ("id", "userId", "orderId", "reason") VALUES (${id('rr')}, ${user.id}, ${order.id}, 'IT')`;
    await prisma.$executeRaw`
      INSERT INTO "order_customer_refunds" ("id", "orderId", "orderCode", "amount", "method", "status", "reason")
      VALUES (${id('ocr')}, ${order.id}, ${order.code}, 1000, 'WALLET', 'COMPLETED', 'IT')`;
    await prisma.$executeRaw`
      INSERT INTO "commissions" ("id", "affiliateUserId", "orderId", "orderTotal", "rate", "amount")
      VALUES (${id('cm')}, ${affiliate.id}, ${order.id}, 10000, 0.1, 1000)`;
    await prisma.$executeRaw`
      INSERT INTO "order_status_history" ("id", "orderId", "fromStatus", "toStatus", "actorType")
      VALUES (${id('osh')}, ${order.id}, 'CONFIRMED', 'DELIVERED', 'SYSTEM')`;
    await prisma.$executeRaw`
      INSERT INTO "reviews" ("id", "userId", "productId", "orderId", "rating") VALUES (${id('rv')}, ${user.id}, ${product.id}, ${order.id}, 5)`;
    await prisma.$executeRaw`
      INSERT INTO "user_admin_events" ("id", "userId", "kind") VALUES (${id('uae')}, ${user.id}, 'IT')`;
    await prisma.$executeRaw`INSERT INTO "carts" ("id", "userId", "updatedAt") VALUES (${id('cart')}, ${user.id}, now())`;
    await prisma.$executeRaw`
      INSERT INTO "cart_items" ("id", "cartId", "variationId", "quantity") VALUES (${id('ci')}, ${id('cart')}, ${variation.id}, 1)`;
    // Giỏ của khách khác chứa biến thể của sản phẩm bị xoá: chỉ productIds dọn được dòng này.
    const other = await createUser(prisma);
    await prisma.$executeRaw`INSERT INTO "carts" ("id", "userId", "updatedAt") VALUES (${id('cart2')}, ${other.id}, now())`;
    await prisma.$executeRaw`
      INSERT INTO "cart_items" ("id", "cartId", "variationId", "quantity") VALUES (${id('ci2')}, ${id('cart2')}, ${variation.id}, 1)`;

    await deleteItData(prisma, { userIds, productIds: [product.id], flashSaleIds: [id('fs')] });

    expect(await count('users', 'id', userIds)).toBe(0);
    expect(await count('orders', 'id', [order.id, dealerOrder.id])).toBe(0);
    expect(await count('products', 'id', [product.id])).toBe(0);
    expect(await count('variations', 'id', [variation.id])).toBe(0);
    expect(await count('flash_sales', 'id', [id('fs')])).toBe(0);
    expect(await count('cart_items', 'id', [id('ci'), id('ci2')])).toBe(0);
    expect(await count('users', 'id', [other.id])).toBe(1);
    await deleteItData(prisma, { userIds: [other.id] });
    expect(await count('users', 'id', [other.id])).toBe(0);
  });

  it('xoá khách có yêu cầu đổi rác đã xác nhận, lượt đổi quà đã trao, cờ và dòng nhân viên điểm nhận', async () => {
    const user = await createUser(prisma);
    const staff = await createUser(prisma);
    const warehouse = await createWarehouse(prisma);
    const item = await createWasteItem(prisma);
    const request = await createWasteRequest(prisma, {
      userId: user.id, method: 'DROP_OFF', status: 'COMPLETED', pointId: warehouse.id,
      lines: [{ itemId: item.id, declaredQty: 2, receivedQty: 2 }],
    });
    const redemption = await createGiftRedemption(prisma, { userId: user.id, status: 'FULFILLED', giftKind: 'GIFT' });
    await prisma.wasteUserFlags.create({ data: { userId: user.id, shipLockedAt: new Date() } });
    const partner = await createWastePoint(prisma, { kind: 'PARTNER', ownerUserId: staff.id });
    await prisma.wasteEvent.create({ data: { kind: 'REQUEST_CONFIRMED', requestId: request.id, actorUserId: staff.id, actorRole: 'STAFF' } });

    await deleteItData(prisma, { userIds: [user.id, staff.id] });

    expect(await count('waste_requests', 'userId', [user.id])).toBe(0);
    expect(await count('waste_request_lines', 'requestId', [request.id])).toBe(0);
    expect(await count('waste_gift_redemptions', 'userId', [user.id])).toBe(0);
    expect(await count('waste_user_flags', 'userId', [user.id])).toBe(0);
    expect(await count('waste_point_staff', 'userId', [staff.id])).toBe(0);
    expect(await count('waste_events', 'requestId', [request.id])).toBe(0);
    expect(await count('users', 'id', [user.id, staff.id])).toBe(0);
    expect(await count('waste_points', 'id', [warehouse.id, partner.id])).toBe(2);

    expect(partner.createdStorefront).toBe(true);
    await cleanupWaste(prisma, {
      pointIds: [partner.id], itemIds: [item.id], giftIds: [redemption.giftId], storefrontIds: partner.createdStorefront ? [partner.ownerStorefrontId!] : [],
    });
    expect(await count('waste_points', 'id', [partner.id])).toBe(0);
    expect(await count('waste_items', 'id', [item.id])).toBe(0);
    expect(partner.ownerStorefrontId).not.toBeNull();
    expect(await count('storefronts', 'id', [partner.ownerStorefrontId!])).toBe(0);
  });

  it('chạy được với tham số rỗng và mảng id rỗng', async () => {
    await expect(deleteItData(prisma, {})).resolves.toBeUndefined();
    await expect(deleteItData(prisma, { userIds: [], productIds: [], flashSaleIds: [] })).resolves.toBeUndefined();
  });
});
