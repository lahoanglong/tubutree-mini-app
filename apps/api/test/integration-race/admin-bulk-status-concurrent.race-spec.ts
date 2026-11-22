import type { JwtPayload } from '@tubutree/shared-types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { OrderBulkStatusService } from '../../src/modules/admin/bulk-ops/order-bulk-status.service';
import type { BulkStatusTarget } from '../../src/modules/admin/bulk-ops/order-bulk-status';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, warmPool } from './helpers';

/**
 * Đổi trạng thái hàng loạt (`POST /admin/orders/bulk-status`) khi hai admin cùng chạy trên cùng đơn, Postgres THẬT. Câu đổi trạng thái là
 * `updateMany` có điều kiện status = trạng thái đã đọc, nên chỉ một lần gọi đổi được dòng đơn. Trước đây lượt thua vẫn ghi đơn vào
 * `admin_audit_logs.changed` như thể chính nó đã đổi (MINOR #3 review W14-04). Nay lượt thua là SKIPPED, sổ chỉ có đúng một lượt nhận công.
 */
describe('Đổi trạng thái hàng loạt: hai admin cùng lúc trên cùng đơn (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let bulk: OrderBulkStatusService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const loyalty = {
      creditOrderPoints: jest.fn().mockResolvedValue(undefined),
      reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
    } as unknown as LoyaltyService;
    const affiliate = {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService;
    const notifications = { notify, notifySafe: notify } as unknown as NotificationsService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, new AnalyticsEventsService(prisma));
    admin = new AdminService(prisma, {} as never, loyalty, affiliate, notifications, reversal, orderStatus, {} as never, {} as never, {} as never);
    bulk = new OrderBulkStatusService(prisma, admin);
    for (const svc of [admin, bulk, orderStatus]) {
      const logger = (svc as unknown as { logger: { warn: () => void; error: () => void } }).logger;
      jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
      jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => notify.mockClear());

  async function confirmedOrders(n: number) {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    return Promise.all(Array.from({ length: n }, () => createOrder(prisma, { userId: user.id, status: 'CONFIRMED' })));
  }

  it('changeOrderStatus gọi đồng thời hai lần trên cùng đơn: đúng một lần changed = true, một dòng lịch sử, khách được báo một lần', async () => {
    const [a1, a2] = await Promise.all([createUser(prisma, { role: 'ADMIN' }), createUser(prisma, { role: 'ADMIN' })]);
    const orders = await confirmedOrders(6);
    for (const o of orders) {
      const results = await Promise.all([
        admin.changeOrderStatus({ id: a1.id, role: 'ADMIN' }, o.id, 'CANCELLED', 'Hết hàng'),
        admin.changeOrderStatus({ id: a2.id, role: 'ADMIN' }, o.code, 'CANCELLED', 'Hết hàng'),
      ]);
      expect(results.map((r) => r.changed).sort()).toEqual([false, true]);
      for (const r of results) expect(r.order.status).toBe('CANCELLED');
      expect(await prisma.orderStatusHistory.count({ where: { orderId: o.id, toStatus: 'CANCELLED' } })).toBe(1);
      expect(notify.mock.calls.filter((c) => c[1] === 'ORDER_CANCELLED' && (c[2] as { order_code?: string }).order_code === o.code)).toHaveLength(1);
    }
    // Đơn đã ở đích từ trước: không phải lần đổi của ai.
    const again = await admin.changeOrderStatus({ id: a1.id, role: 'ADMIN' }, orders[0]!.id, 'CANCELLED');
    expect(again.changed).toBe(false);
  });

  it('hai lượt hàng loạt cùng qua bước đọc lại trạng thái rồi mới đổi: lượt thua câu đổi có điều kiện nhận changed = false và ghi SKIPPED, không ghi công', async () => {
    const [a1, a2] = await Promise.all([createUser(prisma, { role: 'ADMIN' }), createUser(prisma, { role: 'ADMIN' })]);
    // Chặn ở bước đọc lại trạng thái ngay trước khi đổi cho tới khi cả hai lượt cùng tới: cả hai cùng thấy CONFIRMED, nên chỉ câu updateMany có
    // điều kiện phân định ai đổi (bước đọc lại không còn bắt được lượt thua).
    let waiting: (() => void)[] = [];
    const meet = () =>
      new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === 2) {
          for (const go of waiting) go();
          waiting = [];
        }
      });
    const order = new Proxy(prisma.order, {
      get(target, key) {
        const value = Reflect.get(target, key) as unknown;
        if (key === 'findUnique') {
          return async (args: Parameters<typeof target.findUnique>[0]) => {
            const row = await target.findUnique(args);
            await meet();
            return row;
          };
        }
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const gated = new Proxy(prisma, {
      get(target, key) {
        if (key === 'order') return order;
        const value = Reflect.get(target, key) as unknown;
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    const gatedBulk = new OrderBulkStatusService(gated as PrismaService, admin);
    const change = jest.spyOn(admin, 'changeOrderStatus');
    try {
      for (const to of ['PACKED', 'CANCELLED'] as const) {
        for (const o of await confirmedOrders(3)) {
          change.mockClear();
          const [r1, r2] = await Promise.all([
            gatedBulk.run({ sub: a1.id, role: 'ADMIN' } as JwtPayload, { orderIds: [o.code], targetStatus: to }),
            gatedBulk.run({ sub: a2.id, role: 'ADMIN' } as JwtPayload, { orderIds: [o.code], targetStatus: to }),
          ]);
          expect(change).toHaveBeenCalledTimes(2);
          const results = [r1.results[0]!, r2.results[0]!];
          expect(results.map((x) => x.outcome).sort()).toEqual(['SKIPPED', 'UPDATED']);
          expect(results.find((x) => x.outcome === 'SKIPPED')!.reason).toContain('vừa được thao tác khác đổi sang');
          const logs = await prisma.adminAuditLog.findMany({ where: { id: { in: [r1.auditLogId!, r2.auditLogId!] } } });
          expect(logs.filter((l) => l.targetIds.includes(o.code))).toHaveLength(1);
          expect(logs.filter((l) => (l.payload as { skipped: { code: string }[] }).skipped.some((s) => s.code === o.code))).toHaveLength(1);
          expect(await prisma.orderStatusHistory.count({ where: { orderId: o.id, toStatus: to } })).toBe(1);
        }
      }
    } finally {
      change.mockRestore();
    }
  });

  it.each<BulkStatusTarget>(['PACKED', 'CANCELLED'])(
    'hai lượt hàng loạt sang %s chạy song song trên cùng 6 đơn: mỗi đơn đúng một UPDATED + một SKIPPED, đúng một sổ ghi mã vào changed/targetIds',
    async (to) => {
      const [a1, a2] = await Promise.all([createUser(prisma, { role: 'ADMIN' }), createUser(prisma, { role: 'ADMIN' })]);
      const orders = await confirmedOrders(6);
      const codes = orders.map((o) => o.code);
      const actor = (sub: string) => ({ sub, role: 'ADMIN' }) as JwtPayload;
      const [r1, r2] = await Promise.all([
        bulk.run(actor(a1.id), { orderIds: codes, targetStatus: to }),
        bulk.run(actor(a2.id), { orderIds: [...codes].reverse(), targetStatus: to }),
      ]);

      expect(r1.failedCount + r2.failedCount).toBe(0);
      expect(r1.okCount + r2.okCount).toBe(6);
      expect(r1.skippedCount + r2.skippedCount).toBe(6);
      const outcome = (r: typeof r1, code: string) => r.results.find((x) => x.id === code)!.outcome;
      for (const code of codes) expect([outcome(r1, code), outcome(r2, code)].sort()).toEqual(['SKIPPED', 'UPDATED']);

      const logs = await prisma.adminAuditLog.findMany({ where: { id: { in: [r1.auditLogId!, r2.auditLogId!] } } });
      expect(logs).toHaveLength(2);
      for (const o of orders) {
        expect(await prisma.orderStatusHistory.count({ where: { orderId: o.id, toStatus: to } })).toBe(1);
        expect(logs.filter((l) => l.targetIds.includes(o.code))).toHaveLength(1);
        expect(logs.filter((l) => (l.payload as { changed: string[] }).changed.includes(o.code))).toHaveLength(1);
        expect(logs.filter((l) => (l.payload as { skipped: { code: string }[] }).skipped.some((s) => s.code === o.code))).toHaveLength(1);
        expect(logs.filter((l) => (l.payload as { failed: unknown[] }).failed.length > 0)).toHaveLength(0);
      }
      for (const [r, log] of [r1, r2].map((r) => [r, logs.find((l) => l.id === r.auditLogId)!] as const)) {
        expect([...log.targetIds].sort()).toEqual(r.results.filter((x) => x.outcome === 'UPDATED').map((x) => x.id).sort());
      }
      if (to === 'CANCELLED') {
        for (const code of codes) {
          expect(notify.mock.calls.filter((c) => c[1] === 'ORDER_CANCELLED' && (c[2] as { order_code?: string }).order_code === code)).toHaveLength(1);
        }
      }
    },
  );
});
