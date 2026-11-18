import type { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import type { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { applyPancakeStock } from '../../src/modules/catalog/variation-stock';
import { RestockAlertsService } from '../../src/modules/restock-alerts/restock-alerts.service';
import { RestockAlertsDispatcher } from '../../src/modules/restock-alerts/restock-alerts.dispatcher';
import type { MssCatalogService } from '../../src/modules/integrations/mss/catalog/mss-catalog.service';
import type { MssHealthService } from '../../src/modules/integrations/mss/mss-health.service';
import { parseCatalogSyncBody } from '../../src/modules/integrations/mss-catalog-sync/catalog-sync-body';
import { MSS_STOCK_TRANSIT_MS } from '../../src/modules/integrations/mss-catalog-sync/catalog-sync-stock';
import { CatalogSyncService } from '../../src/modules/integrations/mss-catalog-sync/catalog-sync.service';
import { createUser, deleteItData, randCode, uniquePhone, warmPool } from './helpers';

/**
 * MSS đẩy tồn Pancake sang (`POST /api/integrations/mss/catalog-sync`, wave tubu-w3-07) trên Postgres THẬT: hết hàng phản ánh ngay và mở
 * được "Báo tôi khi có hàng", về hàng thì lượt báo sớm gửi đúng một tin mỗi khách, gửi lại an toàn, và số MSS đọc trước lượt đồng bộ/webhook
 * Pancake của Tubu không làm lùi tồn. Hàng đợi ZNS giả; giờ yên tĩnh tắt.
 */
describe('MSS đẩy tồn + báo hàng về (real Postgres)', () => {
  let prisma: PrismaService;
  let restock: RestockAlertsService;
  let dispatcher: RestockAlertsDispatcher;
  let sync: CatalogSyncService;
  const userIds: string[] = [];
  const productIds: string[] = [];
  const kicks: Promise<number>[] = [];
  let stockOn = true;

  const values: Record<string, unknown> = {
    'catalog.restock_alert_enabled': true,
    'notifications.zns_quiet_start_hour': 0,
    'notifications.zns_quiet_end_hour': 0,
    'notifications.zns_promo_monthly_cap': 0,
  };
  const config = { get: async <T>(k: string, fb?: T): Promise<T> => (k in values ? (values[k] as T) : (fb as T)) } as unknown as SystemConfigService;

  async function product(stock: number) {
    const tag = randCode(6);
    const p = await prisma.product.create({
      data: {
        brand: 'IT',
        slug: `itmss-${tag.toLowerCase()}`,
        name: `MSS tồn ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITMSS-${tag}`, name: '2L', attributes: {}, retailPrice: 100_000, stock, pancakeId: `itmss-v-${tag}`, pancakeStock: stock } },
      },
      include: { variations: true },
    });
    productIds.push(p.id);
    const v = p.variations[0]!;
    return { productId: p.id, variationId: v.id, pancakeId: v.pancakeId! };
  }

  const stockOf = async (variationId: string) => (await prisma.variation.findUniqueOrThrow({ where: { id: variationId }, select: { stock: true } })).stock;

  async function push(lines: Array<{ pid: string; stock: number; asOf: Date }>, syncId = `it-${randCode(8)}`) {
    const parsed = parseCatalogSyncBody({
      sync_id: syncId,
      stock: lines.map((l) => ({ pancake_variation_id: l.pid, stock: l.stock, as_of: l.asOf.toISOString() })),
    });
    if (!parsed.ok) throw new Error(parsed.error);
    // Đồng hồ MSS khớp Tubu, ký đúng lúc nhận: mốc đọc = as_of − bù đường truyền.
    const t = new Date();
    return sync.receive({ ...parsed.value, signedAt: t }, t);
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const notifications = new NotificationsService(
      prisma,
      { sendTemplate: jest.fn() } as unknown as ZnsClient,
      { recordBestEffort: jest.fn(async () => undefined) } as unknown as AnalyticsEventsService,
      { add: jest.fn(async () => ({})), remove: jest.fn(async () => 1) } as never,
      config,
    );
    restock = new RestockAlertsService(prisma, config);
    dispatcher = new RestockAlertsDispatcher(prisma, restock, notifications);
    const moduleRef = {
      get: (token: unknown) => {
        if (token === RestockAlertsDispatcher) {
          return {
            kick: () => {
              const p = dispatcher.kick();
              kicks.push(p);
              return p;
            },
          };
        }
        return { invalidateCategoryCache: () => undefined, invalidateStatic: () => undefined };
      },
    } as unknown as ModuleRef;
    sync = new CatalogSyncService(
      prisma,
      { effective: async () => false, applyPushed: jest.fn() } as unknown as MssCatalogService,
      { assertCapability: async () => stockOn } as unknown as MssHealthService,
      moduleRef,
    );
  });

  beforeEach(() => {
    stockOn = true;
    kicks.length = 0;
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await prisma.mssCatalogSyncState.deleteMany({ where: { id: 'push' } });
    await prisma.$disconnect();
  });

  it('MSS báo hết: tồn về 0 ngay và nhận đăng ký "Báo tôi khi có hàng"; MSS báo về: lượt sớm gửi đúng một tin, gửi lại không gửi lần hai', async () => {
    const v = await product(3);
    const u = await createUser(prisma, { phone: uniquePhone(), notifyPromo: true });
    userIds.push(u.id);
    await expect(restock.subscribe(u.id, v.variationId)).rejects.toBeDefined();

    const out = await push([{ pid: v.pancakeId, stock: 0, asOf: new Date(Date.now() - 1_000) }]);
    expect(out.stock).toMatchObject({ status: 'applied', applied: 1, out_of_stock: 1, back_in_stock: 0 });
    expect(await stockOf(v.variationId)).toBe(0);
    await restock.subscribe(u.id, v.variationId);
    expect((await restock.status(v.productId, u.id)).variationIds).toEqual([v.variationId]);
    // Mốc đăng ký do đồng hồ DB ghi; chờ để nó chắc chắn trước mốc mở đợt (giờ Node) dù hai đồng hồ lệch nhau.
    await new Promise((r) => setTimeout(r, 1_000));

    const backLine = { pid: v.pancakeId, stock: 6, asOf: new Date() };
    const back = await push([backLine], 'it-back-0001');
    expect(back.stock).toMatchObject({ applied: 1, back_in_stock: 1, restock_waiting: 1 });
    expect(await stockOf(v.variationId)).toBe(6);
    expect(await Promise.all(kicks)).toEqual([1]);
    expect(await prisma.restockAlert.count({ where: { userId: u.id, variationId: v.variationId, notifiedAt: null } })).toBe(0);

    const again = await push([backLine], 'it-back-0001');
    expect(again.stock).toMatchObject({ applied: 1, back_in_stock: 0, restock_waiting: 0 });
    expect(await dispatcher.dispatchOnce(new Date(Date.now() + 5_000))).toBe(0);
    expect(await prisma.notificationLog.count({ where: { userId: u.id, templateCode: 'RESTOCK_AVAILABLE', channel: 'INAPP' } })).toBe(1);
  });

  it('số MSS đọc trước lượt đồng bộ Pancake của Tubu: bỏ (stale), tồn không lùi; đọc sau thì thắng', async () => {
    const v = await product(4);
    const readAt = new Date(Date.now() - 10_000);
    expect(await applyPancakeStock(prisma, v.pancakeId, 7, { kind: 'sync', readAt })).toBe(true);
    const older = await push([{ pid: v.pancakeId, stock: 0, asOf: new Date(readAt.getTime() - 30_000) }]);
    expect(older.stock).toMatchObject({ applied: 0, skipped: { stale: 1 }, out_of_stock: 0 });
    expect(await stockOf(v.variationId)).toBe(7);
    const newer = await push([{ pid: v.pancakeId, stock: 2, asOf: new Date() }]);
    expect(newer.stock).toMatchObject({ applied: 1 });
    expect(await stockOf(v.variationId)).toBe(2);
  });

  it('webhook Pancake nhận sau lúc MSS đọc: số MSS đến muộn bị bỏ', async () => {
    const v = await product(4);
    const receivedAt = new Date(Date.now() - 2_000);
    expect(await applyPancakeStock(prisma, v.pancakeId, 9, { kind: 'webhook', receivedAt })).toBe(true);
    const late = await push([{ pid: v.pancakeId, stock: 0, asOf: new Date(receivedAt.getTime() - 1_000) }]);
    expect(late.stock).toMatchObject({ applied: 0, skipped: { stale: 1 } });
    expect(await stockOf(v.variationId)).toBe(9);
  });

  it('12 lần đẩy song song lệch thứ tự: tồn cuối là số đọc muộn nhất, bất kể lần nào xử lý sau', async () => {
    const v = await product(5);
    const base = Date.now() - 20_000;
    const order = [7, 2, 11, 0, 5, 9, 3, 10, 1, 8, 4, 6];
    await Promise.all(order.map((i) => push([{ pid: v.pancakeId, stock: 100 + i, asOf: new Date(base + i * 1_000) }])));
    const row = await prisma.variation.findUniqueOrThrow({ where: { id: v.variationId }, select: { stock: true, pancakeStock: true, pancakeStockSyncReadAt: true } });
    expect(row).toEqual({ stock: 111, pancakeStock: 111, pancakeStockSyncReadAt: new Date(base + 11_000 - MSS_STOCK_TRANSIT_MS) });
  });

  it('cờ mss.stock_sync_enabled tắt: không ghi tồn, không gọi lượt báo', async () => {
    stockOn = false;
    const v = await product(3);
    const res = await push([{ pid: v.pancakeId, stock: 0, asOf: new Date() }]);
    expect(res.stock.status).toBe('disabled');
    expect(await stockOf(v.variationId)).toBe(3);
    expect(kicks).toHaveLength(0);
  });
});
