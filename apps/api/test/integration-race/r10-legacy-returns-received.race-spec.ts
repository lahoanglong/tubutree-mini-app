import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { OpsInboxService } from '../../src/modules/ops/ops-inbox.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';
import { readApiSql, runSqlScriptIn } from './sql-script';

const MIGRATION = readApiSql('prisma/migrations/20261015170000_r10_legacy_returns_received/migration.sql');
const SCHEMA = 'r10_legacy_returns_mig';
const DAY = 86_400_000;

/**
 * Yêu cầu trả hàng đã duyệt trước P5 (đảo cả đơn, cộng kho ngay lúc duyệt, KHÔNG có return_request_items) giữ receivedAt = NULL nên
 * nằm mãi trong "Chờ nhận hàng về" mà UI admin không có nút nhận cho hàng không dòng. Migration r10 đặt receivedAt cho chúng; hai
 * truy vấn (thẻ inbox returnsToReceive, bộ lọc TO_RECEIVE) cũng bỏ hàng không dòng để dữ liệu cũ lọt lại không hiện lại.
 */
describe('Yêu cầu trả hàng cũ trước P5 không kẹt "Chờ nhận hàng về" (real Postgres)', () => {
  describe('migration 20261015170000_r10_legacy_returns_received', () => {
    const prisma = new PrismaClient();
    const exec = (sql: string, ...params: unknown[]) => prisma.$executeRawUnsafe(sql, ...params);
    const q = <T>(sql: string, ...params: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...params);
    const run = () => runSqlScriptIn(prisma, SCHEMA, MIGRATION);
    const T0 = new Date('2026-09-01T03:00:00Z');
    const T1 = new Date('2026-09-02T04:00:00Z');
    const T2 = new Date('2026-09-05T05:00:00Z');

    async function row(id: string, status: string, over: { reviewedAt?: Date | null; receivedAt?: Date | null; items?: number } = {}) {
      await exec(
        `INSERT INTO ${SCHEMA}.return_requests ("id", "orderId", "userId", "reason", "status", "reviewedAt", "receivedAt", "createdAt")
         VALUES ($1, 'o-' || $1, 'u', 'lý do', $2::"ReturnStatus", $3, $4, $5)`,
        id,
        status,
        over.reviewedAt === undefined ? T1 : over.reviewedAt,
        over.receivedAt ?? null,
        T0,
      );
      for (let n = 0; n < (over.items ?? 0); n++) {
        await exec(
          `INSERT INTO ${SCHEMA}.return_request_items ("id", "returnRequestId", "orderItemId", "quantity") VALUES ($1, $2, $3, 1)`,
          `${id}-i${n}`,
          id,
          `oi-${id}-${n}`,
        );
      }
    }
    const received = async () =>
      Object.fromEntries(
        (await q<{ id: string; receivedAt: Date | null }>(`SELECT "id", "receivedAt" FROM ${SCHEMA}.return_requests ORDER BY "id"`)).map((r) => [r.id, r.receivedAt]),
      );

    beforeEach(async () => {
      await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await exec(`CREATE SCHEMA ${SCHEMA}`);
      await exec(`CREATE TABLE ${SCHEMA}.return_requests (LIKE public.return_requests INCLUDING ALL)`);
      await exec(`CREATE TABLE ${SCHEMA}.return_request_items (LIKE public.return_request_items INCLUDING ALL)`);
    });

    afterAll(async () => {
      await exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await prisma.$disconnect();
    });

    it('hàng APPROVED không dòng hàng, chưa nhận → receivedAt = reviewedAt (không có reviewedAt thì createdAt); mọi hàng khác giữ nguyên', async () => {
      await row('legacy-reviewed', 'APPROVED', { reviewedAt: T1 });
      await row('legacy-no-review', 'APPROVED', { reviewedAt: null });
      await row('new-with-items', 'APPROVED', { items: 2 });
      await row('already-received', 'APPROVED', { receivedAt: T2 });
      await row('requested', 'REQUESTED', { reviewedAt: null });
      await row('rejected', 'REJECTED');

      await run();

      expect(await received()).toEqual({
        'already-received': T2,
        'legacy-no-review': T0,
        'legacy-reviewed': T1,
        'new-with-items': null,
        rejected: null,
        requested: null,
      });
    });

    it('chạy lại không đổi gì thêm (idempotent) và không đụng hàng mới duyệt sau đó có dòng hàng', async () => {
      await row('legacy', 'APPROVED');
      await row('with-items', 'APPROVED', { items: 1 });
      await run();
      const first = await received();
      await run();
      expect(await received()).toEqual(first);
      expect(first.legacy).toEqual(T1);
      expect(first['with-items']).toBeNull();
    });
  });

  describe('thẻ inbox returnsToReceive và danh sách TO_RECEIVE bỏ hàng không dòng', () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let returns: OrderReturnsService;
    let inbox: OpsInboxService;
    const notify = jest.fn().mockResolvedValue(undefined);

    beforeAll(async () => {
      moduleRef = await Test.createTestingModule({
        imports: [PrismaModule],
        providers: [
          SystemConfigService,
          LoyaltyService,
          OrderReversalService,
          OrderStatusService,
          OrderReturnsService,
          MerchantFulfilmentService,
          {
            provide: AffiliateService,
            useValue: {
              reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
              lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
              grantReferralReward: jest.fn().mockResolvedValue(undefined),
            },
          },
          { provide: NotificationsService, useValue: { notify } },
          { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
          { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
        ],
      }).compile();
      await moduleRef.init();
      prisma = moduleRef.get(PrismaService);
      await warmPool(prisma);
      returns = moduleRef.get(OrderReturnsService);
      inbox = new OpsInboxService(prisma, moduleRef.get(MerchantFulfilmentService));
    });

    afterAll(async () => {
      await moduleRef?.close();
    });

    const toReceiveCount = async () =>
      (await inbox.counts({ role: 'ADMIN' })).items.find((i) => i.key === 'returnsToReceive')?.count ?? 0;

    async function approved(withItems: boolean) {
      const buyer = await createUser(prisma, { role: 'CUSTOMER' });
      const tag = randCode(6);
      const order = await createOrder(prisma, {
        userId: buyer.id,
        status: 'RETURNED',
        deliveredAt: new Date(Date.now() - 5 * DAY),
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        subtotal: 100_000,
        total: 100_000,
      });
      const product = await prisma.product.create({
        data: {
          brand: 'IT',
          slug: `itr10-${tag}`,
          name: `Hàng ${tag}`,
          description: 'IT',
          basePrice: 100_000,
          variations: { create: { sku: `ITR10-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 5 } },
        },
        include: { variations: true },
      });
      const item = await prisma.orderItem.create({
        data: { orderId: order.id, variationId: product.variations[0]!.id, productName: 'Hàng', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 },
      });
      const req = await prisma.returnRequest.create({
        data: {
          orderId: order.id,
          userId: buyer.id,
          reason: 'Trả hàng',
          status: 'APPROVED',
          reviewedAt: new Date(Date.now() - 3 * DAY),
          fullReturn: true,
          ...(withItems ? { items: { create: { orderItemId: item.id, quantity: 1 } } } : {}),
        },
      });
      return req;
    }

    it('chỉ hàng có dòng hàng, chưa nhận được đếm và liệt kê; hàng không dòng (cũ) bị bỏ', async () => {
      const before = await toReceiveCount();
      const legacy = await approved(false);
      const fresh = await approved(true);

      expect(await toReceiveCount()).toBe(before + 1);
      const list = (await returns.listForAdmin('TO_RECEIVE', 1, 500)) as { data: { id: string }[] };
      const ids = list.data.map((r) => r.id);
      expect(ids).toContain(fresh.id);
      expect(ids).not.toContain(legacy.id);

      await prisma.returnRequest.update({ where: { id: fresh.id }, data: { receivedAt: new Date() } });
      expect(await toReceiveCount()).toBe(before);
    });
  });
});
