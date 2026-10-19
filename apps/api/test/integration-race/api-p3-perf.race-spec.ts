import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient, type Variation } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { ComboService } from '../../src/modules/storefront/combo.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createUser, deleteItData, randCode, warmPool } from './helpers';

/**
 * Trên Postgres THẬT:
 * - addItems (mua lại cả đơn) của cùng một khách chạy song song hai lượt với dòng đảo thứ tự không khoá chéo nhau (deadlock);
 * - danh sách mã giảm giá admin không quét tuần tự bảng coupons khi bảng có hàng nghìn mã cá nhân (USER_GROUP).
 */
describe('API P3 và hiệu năng (real Postgres)', () => {
  describe('CartService.addItems song song, dòng đảo thứ tự', () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let cart: CartService;
    const productIds: string[] = [];
    const userIds: string[] = [];

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [PrismaModule],
        providers: [
          SystemConfigService,
          CartService,
          ComboService,
          AnalyticsEventsService,
          { provide: CouponsService, useValue: { validateAndCompute: jest.fn() } },
          { provide: FlashSaleService, useValue: { resolveEffective: jest.fn().mockResolvedValue(new Map()) } },
        ],
      }).compile();
      await moduleRef.init();
      prisma = moduleRef.get(PrismaService);
      cart = moduleRef.get(CartService);
      await warmPool(prisma);
    });

    afterAll(async () => {
      if (prisma) await deleteItData(prisma, { userIds, productIds });
      await moduleRef?.close();
    });

    async function createVariation(): Promise<Variation> {
      const tag = randCode(8);
      const product = await prisma.product.create({
        data: { pancakeId: `it-p-${tag}`, brand: 'IT Brand', slug: `it-sp-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 50_000, thumbnail: `https://img.test/${tag}.jpg` },
      });
      productIds.push(product.id);
      return prisma.variation.create({
        data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 50_000, stock: 100_000 },
      });
    }

    it('hai lượt đảo thứ tự dòng trên cùng giỏ đều xong, không lượt nào bị Postgres huỷ vì deadlock, số lượng cộng đủ', async () => {
      const LINES = 20;
      const ROUNDS = 12;
      const user = await createUser(prisma);
      userIds.push(user.id);
      const variations: Variation[] = [];
      for (let i = 0; i < LINES; i++) variations.push(await createVariation());
      const ascending = variations.map((v) => ({ variationId: v.id, quantity: 1, addSource: 'repurchase' }));
      const descending = [...ascending].reverse();
      // Giỏ đã có đủ dòng: lượt nào cũng đi nhánh UPDATE (khoá hàng) chứ không phải INSERT.
      const first = await cart.addItems(user.id, ascending);
      expect(first.every((o) => o.ok)).toBe(true);

      let failures: unknown[] = [];
      for (let round = 0; round < ROUNDS; round++) {
        const settled = await Promise.allSettled([cart.addItems(user.id, ascending), cart.addItems(user.id, descending)]);
        failures = failures.concat(settled.filter((s) => s.status === 'rejected').map((s) => (s as PromiseRejectedResult).reason));
      }

      expect(failures.map((e) => String((e as Error)?.message ?? e).trim().split('\n').pop())).toEqual([]);
      const rows = await prisma.cartItem.findMany({ where: { cart: { userId: user.id } }, select: { quantity: true } });
      expect(rows).toHaveLength(LINES);
      expect(rows.every((r) => r.quantity === 1 + 2 * ROUNDS)).toBe(true);
    });
  });

  describe('AdminService.listCoupons trên bảng nhiều mã cá nhân', () => {
    const SEEDED = 20_000;
    const prefix = `ITP3${randCode(6)}`;
    let logged: PrismaClient;
    let queries: { query: string; params: string }[] = [];

    beforeAll(async () => {
      logged = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
      (logged as unknown as { $on: (e: 'query', cb: (q: { query: string; params: string }) => void) => void }).$on('query', (q) => queries.push(q));
      await logged.$connect();
      await logged.$executeRawUnsafe(
        `INSERT INTO coupons (id, code, type, value, "startAt", "endAt", scope, "scopeMeta", "usageLimit")
         SELECT '${prefix}-u'||g, '${prefix}U'||g, 'AMOUNT'::"CouponType", 20000, now() - interval '1 day', now() + interval '30 days', 'USER_GROUP'::"CouponScope", jsonb_build_object('userId', 'it-p3-'||g), 1
         FROM generate_series(1, ${SEEDED}) g`,
      );
      await logged.$executeRawUnsafe(
        `INSERT INTO coupons (id, code, type, value, "startAt", "endAt", scope)
         SELECT '${prefix}-p'||g, '${prefix}P'||g, 'AMOUNT'::"CouponType", 10000, now() - (g || ' hours')::interval, now() + interval '30 days', 'PUBLIC'::"CouponScope"
         FROM generate_series(1, 30) g`,
      );
      await logged.$executeRawUnsafe('ANALYZE coupons');
    });

    afterAll(async () => {
      if (logged) {
        await logged.$executeRawUnsafe(`DELETE FROM coupons WHERE id LIKE '${prefix}-%'`);
        await logged.$disconnect();
      }
    });

    it('trang đầu của tab Voucher không còn Seq Scan trên coupons và dùng partial index', async () => {
      const none = {} as never;
      const admin = new AdminService(logged as unknown as PrismaService, none, none, none, none, none, none, none, none, none);
      queries = [];
      const out = await admin.listCoupons({ page: 1, limit: 20 });
      expect(out.meta.total).toBeGreaterThanOrEqual(30);

      // Các truy vấn lọc theo scope trên coupons phải đi bằng chỉ mục, không quét tuần tự.
      const couponQueries = queries.filter((q) => /FROM "(public"\.")?coupons"/.test(q.query) && /WHERE[\s\S]*"scope"/.test(q.query) && !/redemption|claim/i.test(q.query));
      expect(couponQueries.length).toBeGreaterThanOrEqual(1);
      for (const q of couponQueries) {
        const plan = await logged.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${q.query}`, ...(JSON.parse(q.params) as unknown[]));
        const text = plan.map((r) => r['QUERY PLAN']).join('\n');
        expect(text).not.toMatch(/Seq Scan on coupons/);
        expect(text).toMatch(/coupons_admin_list_idx/);
      }
    });
  });
});
