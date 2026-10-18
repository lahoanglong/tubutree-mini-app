import { randomInt } from 'node:crypto';
import type { OrderStatus, PaymentStatus } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { BrandService } from '../../src/modules/brand/brand.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * C-034 / Q-18: chủ nhãn tự xem số đơn, doanh thu, SP bán chạy của NHÃN MÌNH — chỉ số tổng hợp, ẩn PII
 * khách, đúng quyền sở hữu. Chạy trên Postgres thật vì kết quả dựa vào groupBy/count qua quan hệ
 * OrderItem -> Order và ranh giới giờ VN, mà Prisma giả không kiểm được.
 */
describe('BrandService.getOwnedSales (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let brands: BrandService;
  const tag = randCode(6);
  const DAY = 864e5;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [BrandService, SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    brands = moduleRef.get(BrandService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function product(brandId: string | null, name: string, variationCount = 1) {
    const t = randCode(8);
    const p = await prisma.product.create({
      data: {
        pancakeId: `it-p-${t}`, brand: 'IT Brand', brandId, slug: `it-bos-${t.toLowerCase()}`, name,
        description: 'IT', basePrice: 100_000,
      },
    });
    const variations = [];
    for (let i = 0; i < variationCount; i++) {
      variations.push(await prisma.variation.create({
        data: { pancakeId: `it-v-${t}-${i}`, productId: p.id, sku: `IT-${t}-${i}`, name: `Loại ${i}`, attributes: {}, retailPrice: 100_000, stock: 50 },
      }));
    }
    return { product: p, variations };
  }

  const line = (v: { id: string }, productName: string, quantity: number, total: number) => ({
    variationId: v.id, productName, variationName: 'x', unitPrice: Math.round(total / quantity), quantity, total,
  });

  async function setup() {
    const customer = await createUser(prisma, { fullName: 'Khach Bi Mat', phone: `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}` });
    const ownerA = await createUser(prisma);
    const ownerB = await createUser(prisma);
    const stranger = await createUser(prisma);
    const brandA = await prisma.brand.create({ data: { slug: `it-a-${tag}-${randCode(4)}`.toLowerCase(), name: `IT Nhan A ${tag}${randCode(4)}`, ownerUserId: ownerA.id } });
    const brandB = await prisma.brand.create({ data: { slug: `it-b-${tag}-${randCode(4)}`.toLowerCase(), name: `IT Nhan B ${tag}${randCode(4)}`, ownerUserId: ownerB.id } });
    const a1 = await product(brandA.id, 'Nuoc rua chen A1', 2);
    const a2 = await product(brandA.id, 'Xa bong A2');
    const b1 = await product(brandB.id, 'San pham B1');
    const loose = await product(null, 'SP khong nhan');

    const shippingAddress = { recipient: 'Nguyen Bi Mat', phone: '0911222333', street: '12 Duong Bi Mat', ward: 'P1', district: '', province: 'HCM', provinceCode: '79', districtCode: '', wardCode: '1' };
    const mk = (status: OrderStatus, paymentStatus: PaymentStatus, items: ReturnType<typeof line>[], createdAt?: Date) =>
      createOrder(prisma, {
        userId: customer.id, status, paymentStatus, shippingAddress, createdAt,
        total: items.reduce((s, i) => s + i.total, 0),
        items: { create: items },
      });

    // Đơn pha trộn hai nhãn: chỉ phần dòng của nhãn A được tính cho A.
    await mk('CONFIRMED', 'UNPAID', [line(a1.variations[0]!, 'Nuoc rua chen A1', 2, 200_000), line(b1.variations[0]!, 'San pham B1', 1, 50_000)]);
    await mk('DELIVERED', 'PAID', [line(a1.variations[1]!, 'Nuoc rua chen A1', 1, 90_000), line(a2.variations[0]!, 'Xa bong A2', 3, 150_000)]);
    // Không tính vào doanh thu.
    await mk('CANCELLED', 'UNPAID', [line(a1.variations[0]!, 'Nuoc rua chen A1', 5, 500_000)]);
    await mk('PENDING_PAYMENT', 'UNPAID', [line(a2.variations[0]!, 'Xa bong A2', 1, 50_000)]);
    await mk('DELIVERED', 'REFUNDED', [line(a2.variations[0]!, 'Xa bong A2', 1, 50_000)]);
    await mk('RETURNED', 'PAID', [line(a2.variations[0]!, 'Xa bong A2', 2, 100_000)]);
    // Ngoài kỳ 30 ngày, trong kỳ 90 ngày.
    await mk('CONFIRMED', 'UNPAID', [line(a1.variations[0]!, 'Nuoc rua chen A1', 1, 100_000)], new Date(Date.now() - 40 * DAY));
    // Chỉ nhãn B, và một SP không thuộc nhãn nào.
    await mk('DELIVERED', 'PAID', [line(b1.variations[0]!, 'San pham B1', 1, 70_000), line(loose.variations[0]!, 'SP khong nhan', 1, 999_000)]);
    return { ownerA, ownerB, stranger, customer, brandA, a1, a2 };
  }

  it('chủ nhãn A thấy số đơn/doanh thu/SP bán chạy của riêng nhãn A (dòng nhãn B và SP không nhãn bị loại)', async () => {
    const { ownerA, a1, a2 } = await setup();
    const out = await brands.getOwnedSales(ownerA.id, '30d');
    expect(out.orderCount).toBe(2);
    expect(out.revenue).toBe(200_000 + 90_000 + 150_000);
    expect(out.unitsSold).toBe(2 + 1 + 3);
    expect(out.delivered).toEqual({ orderCount: 1, revenue: 240_000 });
    expect(out.topProducts).toEqual([
      { productId: a1.product.id, name: 'Nuoc rua chen A1', slug: a1.product.slug, quantity: 3, revenue: 290_000 },
      { productId: a2.product.id, name: 'Xa bong A2', slug: a2.product.slug, quantity: 3, revenue: 150_000 },
    ]);
  });

  it('kỳ 90 ngày gồm thêm đơn 40 ngày trước; kỳ prev_month/7d không lẫn đơn lệch kỳ', async () => {
    const { ownerA } = await setup();
    const d90 = await brands.getOwnedSales(ownerA.id, '90d');
    expect(d90.orderCount).toBe(3);
    expect(d90.revenue).toBe(540_000);
    const d7 = await brands.getOwnedSales(ownerA.id, '7d');
    expect(d7.orderCount).toBe(2);
    const future = await brands.getOwnedSales(ownerA.id, '7d', new Date(Date.now() - 60 * DAY));
    expect(future).toMatchObject({ orderCount: 0, revenue: 0, unitsSold: 0, topProducts: [] });
  });

  it('chủ nhãn B chỉ thấy nhãn B; người không sở hữu nhãn nào bị 404', async () => {
    const { ownerB, stranger } = await setup();
    const b = await brands.getOwnedSales(ownerB.id, '30d');
    expect(b.orderCount).toBe(2);
    expect(b.revenue).toBe(50_000 + 70_000);
    await expect(brands.getOwnedSales(stranger.id, '30d')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('kết quả không chứa bất kỳ thông tin khách nào (tên, SĐT, địa chỉ, mã đơn, userId)', async () => {
    const { ownerA, customer } = await setup();
    const json = JSON.stringify(await brands.getOwnedSales(ownerA.id, '90d'));
    for (const secret of ['Khach Bi Mat', 'Nguyen Bi Mat', '0911222333', 'Duong Bi Mat', customer.id, customer.phone ?? '@@none@@', 'IT17', 'shippingAddress']) {
      expect(json).not.toContain(secret);
    }
  });

  describe('trả một phần (APPROVED, fullReturn=false) bị trừ khỏi số đơn vị, doanh thu, SP bán chạy', () => {
    async function scenario() {
      const customer = await createUser(prisma);
      const owner = await createUser(prisma);
      const brand = await prisma.brand.create({ data: { slug: `it-pr-${tag}-${randCode(4)}`.toLowerCase(), name: `IT PR ${tag}${randCode(4)}`, ownerUserId: owner.id } });
      const p = await product(brand.id, 'SP tra mot phan', 2);
      const order = await createOrder(prisma, {
        userId: customer.id, status: 'DELIVERED', paymentStatus: 'PAID', total: 400_000,
        items: { create: [line(p.variations[0]!, 'SP tra mot phan', 3, 300_000), line(p.variations[1]!, 'SP tra mot phan', 1, 100_000)] },
      });
      const items = await prisma.orderItem.findMany({ where: { orderId: order.id }, orderBy: { total: 'desc' } });
      const ret = (lines: { id: string; quantity: number }[], extra: Partial<{ status: 'APPROVED' | 'REQUESTED' | 'REJECTED'; fullReturn: boolean }> = {}) =>
        prisma.returnRequest.create({
          data: {
            orderId: order.id, userId: customer.id, reason: 'IT', status: extra.status ?? 'APPROVED', fullReturn: extra.fullReturn ?? false,
            items: { create: lines.map((l) => ({ orderItemId: l.id, quantity: l.quantity })) },
          },
        });
      return { owner, p, order, items, ret };
    }

    it('đơn không trả: như cũ', async () => {
      const { owner, p } = await scenario();
      const out = await brands.getOwnedSales(owner.id, '30d');
      expect(out).toMatchObject({ orderCount: 1, unitsSold: 4, revenue: 400_000, delivered: { orderCount: 1, revenue: 400_000 } });
      expect(out.topProducts).toEqual([{ productId: p.product.id, name: 'SP tra mot phan', slug: p.product.slug, quantity: 4, revenue: 400_000 }]);
    });

    it('đơn 3 đơn vị, trả 1: số đơn vị và doanh thu giảm đúng một phần ba dòng', async () => {
      const { owner, items, ret } = await scenario();
      await ret([{ id: items[0]!.id, quantity: 1 }]);
      const out = await brands.getOwnedSales(owner.id, '30d');
      expect(out.unitsSold).toBe(3);
      expect(out.revenue).toBe(300_000);
      expect(out.delivered).toEqual({ orderCount: 1, revenue: 300_000 });
      expect(out.topProducts[0]).toMatchObject({ quantity: 3, revenue: 300_000 });
      expect(out.orderCount).toBe(1);
    });

    it('nhiều lần trả cộng dồn; trả hết các dòng có tiền thì về 0', async () => {
      const { owner, items, ret } = await scenario();
      await ret([{ id: items[0]!.id, quantity: 1 }]);
      await ret([{ id: items[0]!.id, quantity: 1 }]);
      expect((await brands.getOwnedSales(owner.id, '30d')).revenue).toBe(200_000);
      await ret([{ id: items[0]!.id, quantity: 1 }, { id: items[1]!.id, quantity: 1 }]);
      const out = await brands.getOwnedSales(owner.id, '30d');
      expect(out).toMatchObject({ unitsSold: 0, revenue: 0, delivered: { revenue: 0 } });
      expect(out.topProducts[0]).toMatchObject({ quantity: 0, revenue: 0 });
    });

    it('yêu cầu trả APPROVED của đơn NGOÀI kỳ, đơn CANCELLED/RETURNED, đơn chỉ có hàng NHÃN KHÁC → số của nhãn KHÔNG đổi', async () => {
      const { owner, p, items, ret } = await scenario();
      await ret([{ id: items[0]!.id, quantity: 1 }]);
      const asOf = new Date(Date.now() + 60_000);
      const before = await brands.getOwnedSales(owner.id, '30d', asOf);
      expect(before).toMatchObject({ unitsSold: 3, revenue: 300_000 });

      const customer = await createUser(prisma);
      const other = await product(null, 'SP nhan khac', 1);
      const noisy = async (status: OrderStatus, paymentStatus: PaymentStatus, v: { id: string }, createdAt?: Date) => {
        const o = await createOrder(prisma, {
          userId: customer.id, status, paymentStatus, total: 300_000, createdAt,
          items: { create: [line(v, 'Nhieu', 3, 300_000)] },
        });
        const it = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } });
        await prisma.returnRequest.create({
          data: { orderId: o.id, userId: customer.id, reason: 'IT', status: 'APPROVED', fullReturn: false, items: { create: [{ orderItemId: it.id, quantity: 2 }] } },
        });
      };
      const mine = p.variations[0]!;
      await noisy('DELIVERED', 'PAID', mine, new Date(Date.now() - 40 * DAY));
      await noisy('CANCELLED', 'UNPAID', mine);
      await noisy('RETURNED', 'PAID', mine);
      await noisy('PENDING_PAYMENT', 'UNPAID', mine);
      await noisy('DELIVERED', 'REFUNDED', mine);
      await noisy('DELIVERED', 'PAID', other.variations[0]!);

      expect(await brands.getOwnedSales(owner.id, '30d', asOf)).toEqual(before);
    });

    it('nhãn có yêu cầu trả của hàng chục nghìn đơn nhãn khác: không đọc/IN theo cả nền tảng, số của nhãn đúng', async () => {
      const { owner, items, ret } = await scenario();
      await ret([{ id: items[0]!.id, quantity: 1 }]);
      const customer = await createUser(prisma);
      const other = await product(null, 'SP nen tang', 1);
      const N = 33_000;
      const pre = `itbo-${randCode(6)}-`;
      try {
        await prisma.$executeRaw`
          INSERT INTO "orders" ("id", "code", "userId", "type", "status", "subtotal", "total", "paymentMethod", "paymentStatus", "shippingAddress", "updatedAt")
          SELECT ${pre} || g, ${`ITO${randCode(6)}-`} || g, ${customer.id}, 'RETAIL', 'DELIVERED', 1000, 1000, 'COD', 'PAID', '{}'::jsonb, now()
          FROM generate_series(1, ${N}) AS g`;
        await prisma.$executeRaw`
          INSERT INTO "order_items" ("id", "orderId", "variationId", "productName", "variationName", "unitPrice", "quantity", "total")
          SELECT ${pre} || 'i' || g, ${pre} || g, ${other.variations[0]!.id}, 'x', 'x', 500, 2, 1000 FROM generate_series(1, ${N}) AS g`;
        await prisma.$executeRaw`
          INSERT INTO "return_requests" ("id", "orderId", "userId", "reason", "status", "fullReturn")
          SELECT ${pre} || 'r' || g, ${pre} || g, ${customer.id}, 'IT', 'APPROVED', false FROM generate_series(1, ${N}) AS g`;
        await prisma.$executeRaw`
          INSERT INTO "return_request_items" ("id", "returnRequestId", "orderItemId", "quantity")
          SELECT ${pre} || 'q' || g, ${pre} || 'r' || g, ${pre} || 'i' || g, 1 FROM generate_series(1, ${N}) AS g`;
        const findMany = jest.spyOn(prisma.returnRequest, 'findMany');
        try {
          const out = await brands.getOwnedSales(owner.id, '30d');
          expect(out).toMatchObject({ unitsSold: 3, revenue: 300_000, orderCount: 1 });
          expect(findMany).not.toHaveBeenCalled();
        } finally {
          findMany.mockRestore();
        }
      } finally {
        await prisma.$executeRaw`DELETE FROM "return_requests" WHERE "userId" = ${customer.id}`;
        await prisma.$executeRaw`DELETE FROM "orders" WHERE "userId" = ${customer.id}`;
      }
    });

    it('yêu cầu chưa duyệt / bị từ chối / trả nốt (fullReturn) không bị trừ ở đây', async () => {
      const { owner, items, ret } = await scenario();
      await ret([{ id: items[0]!.id, quantity: 1 }], { status: 'REQUESTED' });
      await ret([{ id: items[0]!.id, quantity: 1 }], { status: 'REJECTED' });
      await ret([{ id: items[0]!.id, quantity: 1 }], { fullReturn: true });
      const out = await brands.getOwnedSales(owner.id, '30d');
      expect(out).toMatchObject({ unitsSold: 4, revenue: 400_000 });
    });
  });
});
