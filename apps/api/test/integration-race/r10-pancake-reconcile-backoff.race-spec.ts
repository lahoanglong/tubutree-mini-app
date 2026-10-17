import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakePushReconcileService } from '../../src/modules/integrations/pancake/pancake-push-reconcile.service';
import { PANCAKE_CANCEL_REFUSED_PREFIX, type PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import { createOrder as createOrderRow, createUser as createUserRow, warmPool } from './helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;

/**
 * Cron cứu hộ đẩy/huỷ Pancake trên Postgres THẬT (SYNC-5, SYNC-6): đơn thoát trước bước claim không chiếm hết lô 50 của
 * pushStale; đơn bị đẩy lỗi nhiều lượt và huỷ bị Pancake từ chối dứt khoát chỉ được thử lại thưa. Stub: PancakeOrderService
 * (chỉ ghi lại đơn được xếp job), PancakeClient.
 */
describe('Cron cứu hộ Pancake: không bỏ đói đơn thật, thử lại thưa dần (real Postgres)', () => {
  let prisma: PrismaService;
  let reconcile: PancakePushReconcileService;
  const enqueuePush = jest.fn().mockResolvedValue(undefined);
  const enqueueCancel = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    reconcile = new PancakePushReconcileService(
      prisma,
      { isConfigured: () => true } as unknown as PancakeClient,
      { enqueuePush, enqueueCancel, enqueuePayment: jest.fn().mockResolvedValue(undefined) } as unknown as PancakeOrderService,
      { alert: jest.fn().mockResolvedValue(undefined) } as unknown as GomdonAlertService,
    );
  });

  // 55 đơn thu gom "đang chờ Gomdon" tạo cách đây 30 phút nằm lại DB dùng chung thì lọt vào lô quét của cron Gomdon/Pancake
  // và hàng đợi Sức khoẻ hệ thống ở spec khác: xoá đúng các dòng spec này tạo.
  const created = { orderIds: [] as string[], userIds: [] as string[] };
  const createUser = async (...args: Parameters<typeof createUserRow>) => {
    const u = await createUserRow(...args);
    created.userIds.push(u.id);
    return u;
  };
  const createOrder = async (...args: Parameters<typeof createOrderRow>) => {
    const o = await createOrderRow(...args);
    created.orderIds.push(o.id);
    return o;
  };

  afterAll(async () => {
    if (prisma) {
      const { orderIds, userIds } = created;
      await prisma.$transaction([
        prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
      ]);
    }
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    enqueuePush.mockClear();
    enqueueCancel.mockClear();
  });

  const ago = (ms: number) => new Date(Date.now() - ms);
  const pushedIds = () => new Set(enqueuePush.mock.calls.map((c) => c[0] as string));
  const cancelledIds = () => new Set(enqueueCancel.mock.calls.map((c) => c[0] as string));

  /** Lệch `updatedAt` (cột @updatedAt, Prisma luôn đè): chỉ SQL thô đặt được mốc "lần thử gần nhất". */
  const touch = (id: string, at: Date) => prisma.$executeRaw`UPDATE "orders" SET "updatedAt" = ${at} WHERE "id" = ${id}`;

  it('SYNC-6: ≥ 50 đơn thu gom còn chờ Gomdon (cron bỏ qua, không claim) không bỏ đói đơn thật cần thử lại — đơn thật được xếp job sau tối đa vài nhịp', async () => {
    const buyer = await createUser(prisma);
    const waiting = await Promise.all(
      Array.from({ length: 55 }, () =>
        createOrder(prisma, { userId: buyer.id, createdAt: ago(30 * MIN), hasRecyclingPickup: true, gomdonStatus: null, gomdonOrderId: null, gomdonPartnerCode: null }),
      ),
    );
    const real = await createOrder(prisma, {
      userId: buyer.id,
      createdAt: ago(30 * MIN),
      pancakePushStatus: 'FAILED',
      pancakePushAttempts: 5,
      pancakeLastAttemptAt: ago(20 * MIN),
    });

    for (let tick = 0; tick < 3; tick++) await reconcile.reconcile();

    expect(pushedIds().has(real.id)).toBe(true);
    for (const o of waiting) expect(pushedIds().has(o.id)).toBe(false);
    const stamped = await prisma.order.count({ where: { id: { in: waiting.map((o) => o.id) }, pancakeLastAttemptAt: { not: null } } });
    expect(stamped).toBe(55);
  });

  it('SYNC-6: đơn đang PUSHING không bị kéo dài hạn thuê quyền đẩy (mốc pancakeLastAttemptAt giữ nguyên)', async () => {
    const buyer = await createUser(prisma);
    const stamp = ago(40 * MIN);
    const pushing = await createOrder(prisma, { userId: buyer.id, createdAt: ago(30 * MIN), pancakePushStatus: 'PUSHING', pancakePushAttempts: 1, pancakeLastAttemptAt: stamp });
    await reconcile.reconcile();
    const after = await prisma.order.findUniqueOrThrow({ where: { id: pushing.id } });
    expect(after.pancakeLastAttemptAt?.getTime()).toBe(stamp.getTime());
  });

  it('SYNC-5: đơn đã bị đẩy lỗi ≥ 20 lượt chỉ thử lại mỗi 60 phút; dưới 20 lượt hoặc đã quá 60 phút thì thử như cũ', async () => {
    const buyer = await createUser(prisma);
    const mk = (attempts: number, lastAttemptMs: number) =>
      createOrder(prisma, { userId: buyer.id, createdAt: ago(5 * HOUR), pancakePushStatus: 'FAILED', pancakePushAttempts: attempts, pancakeLastAttemptAt: ago(lastAttemptMs) });
    const recentSlow = await mk(25, 30 * MIN);
    const dueSlow = await mk(25, 2 * HOUR);
    const fewAttempts = await mk(3, 20 * MIN);

    for (let tick = 0; tick < 3; tick++) await reconcile.reconcile();

    expect(pushedIds().has(recentSlow.id)).toBe(false);
    expect(pushedIds().has(dueSlow.id)).toBe(true);
    expect(pushedIds().has(fewAttempts.id)).toBe(true);
  });

  it('SYNC-5: huỷ Pancake từ chối dứt khoát chỉ hỏi lại sau 6 giờ; PENDING và FAILED do mất kết nối vẫn 15 phút một lần', async () => {
    const buyer = await createUser(prisma);
    const cancelled = async (data: Record<string, unknown>, updatedMsAgo: number) => {
      const o = await createOrder(prisma, { userId: buyer.id, status: 'CANCELLED', createdAt: ago(24 * HOUR), pancakeOrderId: `pk-${Math.random().toString(36).slice(2)}`, ...data });
      await touch(o.id, ago(updatedMsAgo));
      return o.id;
    };
    const pending = await cancelled({ pancakeCancelStatus: 'PENDING' }, 20 * MIN);
    const pendingJustTried = await cancelled({ pancakeCancelStatus: 'PENDING' }, 5 * MIN);
    const failedNetwork = await cancelled({ pancakeCancelStatus: 'FAILED', pancakeSyncError: 'Không kết nối được Pancake: ECONNRESET' }, 20 * MIN);
    const failedNoError = await cancelled({ pancakeCancelStatus: 'FAILED', pancakeSyncError: null }, 20 * MIN);
    const refusedRecent = await cancelled({ pancakeCancelStatus: 'FAILED', pancakeSyncError: `${PANCAKE_CANCEL_REFUSED_PREFIX}Pancake trả 400` }, 20 * MIN);
    const refusedDue = await cancelled({ pancakeCancelStatus: 'FAILED', pancakeSyncError: `${PANCAKE_CANCEL_REFUSED_PREFIX}Pancake trả 400` }, 7 * HOUR);

    await reconcile.reconcile();

    const got = cancelledIds();
    expect([pending, failedNetwork, failedNoError, refusedDue].every((id) => got.has(id))).toBe(true);
    expect(got.has(pendingJustTried)).toBe(false);
    expect(got.has(refusedRecent)).toBe(false);
  });
});
