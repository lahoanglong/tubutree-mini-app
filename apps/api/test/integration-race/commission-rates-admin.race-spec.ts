import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { CommissionAdminService } from '../../src/modules/affiliate/commission-admin.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { PancakeSyncService } from '../../src/modules/integrations/pancake/pancake-sync.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { AFFILIATE_MAX_RATE_KEY } from '../../src/modules/affiliate/commission-rate-csv';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * D1-01 / D3-01: `Variation.affiliateRate` là nguồn duy nhất của % hoa hồng CTV mà trước đây không có đường ghi — hàng đồng bộ
 * từ Pancake (rate NULL) cho mọi đơn CTV 0đ. Trên Postgres thật: % admin đặt đi tới dòng hoa hồng đúng số tiền khi đơn được
 * giao; nhập CSV hỏng không ghi nửa chừng; hai lần nhập chồng nhau không trộn file; đồng bộ Pancake không xoá %.
 */
describe('Admin đặt % hoa hồng CTV (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let admin: CommissionAdminService;
  let orderStatus: OrderStatusService;
  let adminUserId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        CommissionAdminService,
        OrderReversalService,
        OrderStatusService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined), resolveEffective: jest.fn().mockResolvedValue(new Map()) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    admin = moduleRef.get(CommissionAdminService);
    orderStatus = moduleRef.get(OrderStatusService);
    // Trần mặc định (50) — spec khác có thể đã ghi khoá này.
    await prisma.systemConfig.deleteMany({ where: { key: AFFILIATE_MAX_RATE_KEY } });
    adminUserId = (await createUser(prisma, { role: 'ADMIN' })).id;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  /** Như sản phẩm đồng bộ từ Pancake: biến thể chưa có % (NULL). */
  async function pancakeVariation(price: number, opts: { stock?: number } = {}) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-cr-p-${tag}`,
        brand: 'Tubu Tree',
        slug: `it-cr-${tag.toLowerCase()}`,
        name: `SP hoa hồng IT ${tag}`,
        description: 'IT',
        basePrice: price,
        isActive: true,
        approvalStatus: 'APPROVED',
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `it-cr-v-${tag}`,
        productId: product.id,
        sku: `ITCR-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: price,
        stock: opts.stock ?? 100,
        pancakeStock: opts.stock ?? 100,
        isActive: true,
      },
    });
  }

  const rateOf = async (id: string) => {
    const v = await prisma.variation.findUniqueOrThrow({ where: { id }, select: { affiliateRate: true } });
    return v.affiliateRate === null ? null : Number(v.affiliateRate);
  };

  async function assistedOrder(ctvId: string, variationId: string, quantity: number) {
    return affiliate.placeOrderForCustomer(ctvId, {
      paymentMethod: 'COD',
      items: [{ variationId, quantity }],
      customer: {
        recipient: 'Khach IT',
        phone: randomPhone(),
        province: 'Ha Noi',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '84_VN01',
        wardCode: '00001',
      },
    } as never);
  }

  async function deliver(orderId: string) {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'SHIPPING' } });
    await orderStatus.setStatus(orderId, 'DELIVERED');
  }

  it('hàng chưa có % → hưởng mặc định 8%; admin đặt % riêng → đơn sau theo % đó, đơn trước giữ nguyên', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
    const v = await pancakeVariation(135_000);

    const before = await assistedOrder(ctv.id, v.id, 2);
    await deliver(before.id);
    expect(await prisma.commission.findMany({ where: { orderId: before.id }, select: { status: true, amount: true } })).toEqual([
      { status: 'LOCKED', amount: 21_600 },
    ]);

    await admin.setVariationRate(adminUserId, v.id, 10);
    expect(await rateOf(v.id)).toBe(10);

    const after = await assistedOrder(ctv.id, v.id, 2);
    expect(await prisma.commission.findMany({ where: { orderId: after.id }, select: { status: true, amount: true } })).toEqual([
      { status: 'PENDING', amount: 27_000 },
    ]);
    await deliver(after.id);
    const rows = await prisma.commission.findMany({ where: { orderId: after.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ affiliateUserId: ctv.id, status: 'LOCKED', amount: Math.floor((270_000 * 10) / 100) });
    expect(rows[0]!.lockedAt).not.toBeNull();
    expect(await prisma.commission.findFirstOrThrow({ where: { orderId: before.id } })).toMatchObject({ amount: 21_600 });

    const ref = await admin.orderReferral(after.code);
    expect(ref.referrer?.id).toBe(ctv.id);
    expect(ref.commissions).toEqual([expect.objectContaining({ amount: 27_000, status: 'LOCKED', rate: 10 })]);
  });

  it('đơn lên hộ khách: ADMIN lên hộ → không có hoa hồng (khung đơn báo vai trò không hưởng); CTV lên hộ → có như cũ', async () => {
    const v = await pancakeVariation(150_000);
    await admin.setVariationRate(adminUserId, v.id, 10);

    const byAdmin = await assistedOrder(adminUserId, v.id, 1);
    await deliver(byAdmin.id);
    expect(await prisma.commission.count({ where: { orderId: byAdmin.id } })).toBe(0);
    expect(await admin.orderReferral(byAdmin.code)).toMatchObject({ placedForCustomer: true, referrerEligible: false, commissions: [] });

    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: randomPhone() });
    const byCtv = await assistedOrder(ctv.id, v.id, 1);
    await deliver(byCtv.id);
    expect(await prisma.commission.findMany({ where: { orderId: byCtv.id }, select: { affiliateUserId: true, status: true, amount: true } })).toEqual([
      { affiliateUserId: ctv.id, status: 'LOCKED', amount: 15_000 },
    ]);
    expect(await admin.orderReferral(byCtv.code)).toMatchObject({ placedForCustomer: true, referrerEligible: true });
  });

  it('đơn khách có CTV giới thiệu, % đặt bằng CSV và "áp cho chưa có %": hoa hồng theo từng dòng', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const a = await pancakeVariation(200_000);
    const b = await pancakeVariation(99_000);

    const imported = await admin.applyImport(adminUserId, `sku,% hoa hồng\n${a.sku},10\n`);
    expect(imported).toEqual({ updated: 1, unchanged: 0, notFound: [] });
    const filled = await admin.fillMissingRates(adminUserId, 5);
    expect(filled.updated).toBeGreaterThanOrEqual(1);
    expect([await rateOf(a.id), await rateOf(b.id)]).toEqual([10, 5]);

    const order = await createOrder(prisma, {
      userId: buyer.id,
      referrerUserId: ctv.id,
      status: 'SHIPPING',
      total: 299_000,
      subtotal: 299_000,
      items: {
        create: [
          { variationId: a.id, productName: 'A', variationName: 'Mặc định', unitPrice: 200_000, quantity: 1, total: 200_000 },
          { variationId: b.id, productName: 'B', variationName: 'Mặc định', unitPrice: 99_000, quantity: 1, total: 99_000 },
        ],
      },
    });
    await affiliate.createCommissionForOrder(order.id);
    await orderStatus.setStatus(order.id, 'DELIVERED');
    const rows = await prisma.commission.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'LOCKED', amount: 20_000 + 4_950, commissionableTotal: 299_000 });
  });

  it('"áp cho chưa có %" không đè mức đã đặt (kể cả 0 cố ý) và không chạm hàng đối tác', async () => {
    const set = await pancakeVariation(100_000);
    const zero = await pancakeVariation(100_000);
    const partner = await pancakeVariation(100_000);
    const owner = await createUser(prisma, { role: 'DEALER' });
    const sf = await prisma.storefront.create({
      data: { type: 'CTV', isPartner: true, slug: `it-cr-sf-${randCode(6).toLowerCase()}`, title: 'Gian IT', ownerUserId: owner.id },
    });
    await prisma.product.update({ where: { id: partner.productId }, data: { storefrontId: sf.id } });
    await admin.setVariationRate(adminUserId, set.id, 12);
    await admin.setVariationRate(adminUserId, zero.id, 0);

    await admin.fillMissingRates(adminUserId, 3);
    expect([await rateOf(set.id), await rateOf(zero.id), await rateOf(partner.id)]).toEqual([12, 0, null]);
  });

  it('sản phẩm ngừng bán: không tính vào số "chưa có %", không hiện ở lọc "chưa có %", "áp cho chưa có %" không chạm', async () => {
    const tag = randCode(6);
    const base = await admin.listProducts({ take: 1 });
    const off = await pancakeVariation(100_000);
    await prisma.product.update({ where: { id: off.productId }, data: { isActive: false, name: `Ngung ${tag}` } });
    await prisma.variation.update({ where: { id: off.id }, data: { sku: `ITOFF-${tag}` } });

    const after = await admin.listProducts({ take: 1 });
    expect(after.summary).toEqual(base.summary);
    expect((await admin.listProducts({ q: `ITOFF-${tag}`, missing: true, take: 5 })).items).toEqual([]);
    expect((await admin.listProducts({ q: `ITOFF-${tag}`, take: 5 })).items.map((p) => p.id)).toEqual([off.productId]);

    const filled = await admin.fillMissingRates(adminUserId, 4);
    expect(filled.updated).toBe(after.summary.missingTubu);
    expect(await rateOf(off.id)).toBeNull();
  });

  it('CSV có dòng sai / vượt trần / SKU lặp → 400, không dòng nào bị ghi (kể cả dòng hợp lệ)', async () => {
    const a = await pancakeVariation(100_000);
    const b = await pancakeVariation(100_000);
    await admin.setVariationRate(adminUserId, b.id, 4);

    for (const csv of [
      `${a.sku},10\n${b.sku},abc`,
      `${a.sku},10\n${b.sku},51`,
      `${a.sku},10\n${b.sku},6\n${b.sku},6`,
    ]) {
      await expect(admin.applyImport(adminUserId, csv)).rejects.toThrow('Chưa ghi dòng nào');
    }
    expect([await rateOf(a.id), await rateOf(b.id)]).toEqual([null, 4]);
  });

  it('hai lần nhập CSV chồng nhau (thứ tự SKU ngược nhau): cả hai xong, không deadlock, kết quả là trọn MỘT file', async () => {
    const vs = await Promise.all(Array.from({ length: 6 }, () => pancakeVariation(100_000)));
    // File 1 gom 2 mức theo thứ tự này, file 2 ngược lại — không khoá trước theo id thì dễ khoá chéo.
    const file1 = vs.map((v, i) => `${v.sku},${i % 2 ? 11 : 12}`).join('\n');
    const file2 = [...vs].reverse().map((v, i) => `${v.sku},${i % 2 ? 21 : 22}`).join('\n');

    for (let round = 0; round < 5; round++) {
      const results = await Promise.allSettled([admin.applyImport(adminUserId, file1), admin.applyImport(adminUserId, file2)]);
      const s = summarize(results);
      // Lần nhập sau có thể thấy file trước đã ghi đúng mức của nó → "Không có dòng nào cần đổi" là hợp lệ; deadlock thì không.
      expect(s.errors.filter((e) => !/Không có dòng nào cần đổi/.test(e))).toEqual([]);
      const rates = await Promise.all(vs.map((v) => rateOf(v.id)));
      const from1 = rates.every((r) => r === 11 || r === 12);
      const from2 = rates.every((r) => r === 21 || r === 22);
      expect(from1 || from2).toBe(true);
    }
  });

  it('"áp cho chưa có %" song song với đặt % sản phẩm / biến thể / CSV: không deadlock, không đè mức vừa đặt', async () => {
    for (let round = 0; round < 4; round++) {
      const vs = await Promise.all(Array.from({ length: 8 }, () => pancakeVariation(100_000)));
      const csv = vs
        .slice(5)
        .reverse()
        .map((v) => `${v.sku},14`)
        .join('\n');
      const results = await Promise.allSettled([
        admin.fillMissingRates(adminUserId, 5),
        ...vs.slice(0, 3).map((v) => admin.setProductRate(adminUserId, v.productId, 12)),
        ...vs
          .slice(3, 5)
          .reverse()
          .map((v) => admin.setVariationRate(adminUserId, v.id, 13)),
        admin.applyImport(adminUserId, csv),
        admin.fillMissingRates(adminUserId, 6),
      ]);
      expect(summarize(results).errors).toEqual([]);
      expect(await Promise.all(vs.map((v) => rateOf(v.id)))).toEqual([12, 12, 12, 13, 13, 14, 14, 14]);
    }
  });

  it('danh sách keyset (tên trùng nhau): đi hết các trang, mỗi sản phẩm đúng một lần; lọc chưa có % và tìm theo SKU', async () => {
    const tag = randCode(6);
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const v = await pancakeVariation(100_000);
      // Ba sản phẩm cùng tên: keyset chỉ theo tên sẽ lặp/bỏ sót ở ranh giới trang.
      await prisma.product.update({ where: { id: v.productId }, data: { name: `Keyset ${tag} ${i < 3 ? 'A' : `B${i}`}` } });
      await prisma.variation.update({ where: { id: v.id }, data: { sku: `ITKS-${tag}-${i}` } });
      if (i === 4) await admin.setVariationRate(adminUserId, v.id, 6);
      made.push(v.productId);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await admin.listProducts({ q: `ITKS-${tag}`, take: 2, cursor });
      seen.push(...page.items.map((p) => p.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(made));

    const missing = await admin.listProducts({ q: `ITKS-${tag}`, take: 50, missing: true });
    expect(missing.items.map((p) => p.id).sort()).toEqual(made.slice(0, 4).sort());
    expect(missing.summary.missing).toBeGreaterThanOrEqual(4);
  });

  it('"Tải thêm" khi đang lọc chưa có %: sản phẩm cuối trang vừa được đặt % thì trang sau không nuốt sản phẩm kế tiếp', async () => {
    const tag = randCode(6);
    const ids: string[] = [];
    const vids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const v = await pancakeVariation(100_000);
      await prisma.product.update({ where: { id: v.productId }, data: { name: `Nuot ${tag} ${i}` } });
      await prisma.variation.update({ where: { id: v.id }, data: { sku: `ITNU-${tag}-${i}` } });
      ids.push(v.productId);
      vids.push(v.id);
    }
    const page1 = await admin.listProducts({ q: `ITNU-${tag}`, missing: true, take: 2 });
    expect(page1.items.map((p) => p.id)).toEqual([ids[0], ids[1]]);
    await admin.setVariationRate(adminUserId, vids[1]!, 10);
    const page2 = await admin.listProducts({ q: `ITNU-${tag}`, missing: true, take: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((p) => p.id)).toEqual([ids[2], ids[3]]);
    expect(page2.nextCursor).toBeNull();
  });

  it('đồng bộ Pancake (đổi giá, tồn) không xoá % admin đã đặt', async () => {
    const v = await pancakeVariation(100_000, { stock: 10 });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: v.productId } });
    await admin.setVariationRate(adminUserId, v.id, 9);
    const client = {
      isConfigured: () => true,
      fetchProducts: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          total_pages: 1,
          total_entries: 1,
          data: [
            {
              id: product.pancakeId,
              name: `${product.name} (đổi tên)`,
              variations: [{ id: v.pancakeId, sku: v.sku, retail_price: 120_000, sale_price: 110_000, remain_quantity: 7, fields: {} }],
            },
          ],
        })
        .mockResolvedValue({ success: true, data: [], total_pages: 1, total_entries: 1 }),
    } as unknown as PancakeClient;
    const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;
    const sync = new PancakeSyncService(prisma, client, lifecycle);

    expect(await sync.syncProducts(new Date(Date.now() - 60_000).toISOString())).toBe(1);
    const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.retailPrice).toBe(120_000);
    expect(after.salePrice).toBe(110_000);
    expect(Number(after.affiliateRate)).toBe(9);
  });
});
