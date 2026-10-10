import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { createUser, randCode, warmPool } from './helpers';

/**
 * C-092: các truy vấn tra cứu của admin chạy trên Postgres thật — đặc biệt tìm tên không dấu qua cột `nameSearch`
 * (do trigger DB điền, nên mock Prisma không chứng minh được), và quan hệ review/subscription.
 */
describe('AdminService lookups (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let admin: AdminService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    admin = new AdminService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function product(name: string, tag = randCode(8)) {
    const p = await prisma.product.create({
      data: { pancakeId: `it-lk-p-${tag}`, brand: 'IT', slug: `it-lk-${tag.toLowerCase()}`, name, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-lk-v-${tag}`, productId: p.id, sku: `LK-${tag}`, name: 'Chai 500ml', attributes: {}, retailPrice: 100_000, salePrice: 80_000, stock: 5 },
    });
    return { p, v, tag };
  }

  it('searchProducts: gõ không dấu / khác hoa thường vẫn ra sản phẩm có dấu; tìm theo SKU; trả giá khuyến mãi', async () => {
    const tag = randCode(8);
    const { p, v } = await product(`Nước rửa chén Lá Sả ${tag}`, tag);

    const byName = await admin.searchProducts(`NUOC rua chen la sa ${tag.toLowerCase()}`);
    expect(byName.map((x) => x.id)).toContain(p.id);
    const hit = byName.find((x) => x.id === p.id)!;
    expect(hit.variations).toEqual([{ id: v.id, name: 'Chai 500ml', sku: `LK-${tag}`, price: 80_000, stock: 5, isActive: true }]);

    const bySku = await admin.searchProducts(`lk-${tag.toLowerCase()}`);
    expect(bySku.map((x) => x.id)).toContain(p.id);

    expect(await admin.searchProducts('a')).toEqual([]);
    expect(await admin.searchProducts(`khong-co-san-pham-nao-${tag}-zzz`)).toEqual([]);
  });

  it('lookupVariations: trả tên SP + biến thể; id lạ bị bỏ qua', async () => {
    const tag = randCode(8);
    const { p, v } = await product(`SP lookup ${tag}`, tag);
    const out = await admin.lookupVariations(`${v.id}, id-khong-ton-tai`);
    expect(out).toEqual([{ id: v.id, name: 'Chai 500ml', sku: `LK-${tag}`, productId: p.id, productName: `SP lookup ${tag}` }]);
  });

  it('listUsers search: khớp SĐT chứa / tên không phân biệt hoa thường / id đúng', async () => {
    const tag = randCode(6);
    const phone = `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    const u = await createUser(prisma, { phone, fullName: `Khách Tìm ${tag}` });
    const ids = async (s: string) => (await admin.listUsers(1, 50, s)).data.map((x) => x.id);
    expect(await ids(phone.slice(2, 9))).toContain(u.id);
    expect(await ids(`khách tìm ${tag.toLowerCase()}`)).toContain(u.id);
    expect(await ids(u.id)).toEqual([u.id]);
    const page = await admin.listUsers(1, 50, `khong-ai-ten-${tag}`);
    expect(page.data).toEqual([]);
    expect(page.meta.total).toBe(0);
  });

  it('listReviews: lọc ẩn/hiện + số sao, kèm khách & sản phẩm; listSubscriptions kèm biến thể, không lộ addressId', async () => {
    const tag = randCode(8);
    const { p, v } = await product(`SP review ${tag}`, tag);
    const u = await createUser(prisma, { fullName: `Người đánh giá ${tag}` });
    const order = await prisma.order.create({
      data: {
        code: `ITLK${Date.now()}${randCode(4)}`,
        userId: u.id,
        type: 'RETAIL',
        status: 'DELIVERED',
        subtotal: 100_000,
        total: 100_000,
        paymentMethod: 'COD',
        paymentStatus: 'PAID',
        shippingAddress: {},
      },
    });
    const review = await prisma.review.create({
      data: { userId: u.id, productId: p.id, orderId: order.id, rating: 1, comment: `spam ${tag}`, isVisible: false },
    });

    const hidden = await admin.listReviews(1, 100, 'hidden', 1);
    const row = hidden.data.find((r) => r.id === review.id);
    expect(row).toMatchObject({ rating: 1, isVisible: false, user: { fullName: `Người đánh giá ${tag}` }, product: { id: p.id } });
    expect((await admin.listReviews(1, 100, 'visible', 1)).data.map((r) => r.id)).not.toContain(review.id);

    const addr = await prisma.address.create({
      data: { userId: u.id, recipient: 'IT', phone: '0900000000', province: 'HN', district: '', ward: 'P', street: '1', provinceCode: '01', districtCode: '', wardCode: '1' },
    });
    const sub = await prisma.subscription.create({
      data: { userId: u.id, variationId: v.id, quantity: 2, intervalWeeks: 4, addressId: addr.id, nextRunAt: new Date(Date.now() + 864e5) },
    });
    const subs = await admin.listSubscriptions(1, 100, 'ACTIVE');
    const s = subs.data.find((x) => x.id === sub.id);
    expect(s).toMatchObject({ quantity: 2, intervalWeeks: 4, status: 'ACTIVE', user: { id: u.id }, variation: { id: v.id, product: { id: p.id, name: `SP review ${tag}` } } });
    expect(JSON.stringify(s)).not.toContain('addressId');
    expect((await admin.listSubscriptions(1, 100, 'CANCELLED')).data.map((x) => x.id)).not.toContain(sub.id);
  });

  it('listDealerTiers: sắp theo mốc doanh số tăng dần', async () => {
    const tiers = await admin.listDealerTiers();
    const volumes = tiers.map((t) => t.minOrderVolume);
    expect(volumes).toEqual([...volumes].sort((a, b) => a - b));
  });
});
