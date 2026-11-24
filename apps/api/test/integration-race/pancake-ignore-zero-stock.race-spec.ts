import type { Logger } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import {
  PANCAKE_IGNORE_ZERO_STOCK_KEY,
  applyPancakeStock,
  releaseVariationStock,
  reserveVariationStock,
} from '../../src/modules/catalog/variation-stock';
import { applyMssStock } from '../../src/modules/integrations/mss-catalog-sync/catalog-sync-stock';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { PancakeSyncService } from '../../src/modules/integrations/pancake/pancake-sync.service';
import { pancakeDedupeKey, PANCAKE_STOCK_EVENT } from '../../src/modules/integrations/pancake/pancake-webhook-dedupe';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import type { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { deleteItData, randCode, warmPool } from './helpers';

/**
 * Cờ `catalog.pancake_ignore_zero_stock` trên Postgres THẬT: Pancake báo 0 mà Tubu còn tồn dương thì giữ tồn và giữ chỗ, vẫn ghi
 * `pancakeStock = 0`; Pancake báo số dương thì `stock = số mới − giữ chỗ`; đơn app vẫn trừ tồn. Cờ đọc qua một SystemConfigService
 * giả để spec không ghi bảng cấu hình chung (cache 60 giây làm spec khác đọc lệch). Stub: HTTP Pancake, thông báo, OrderStatusService.
 */
describe('catalog.pancake_ignore_zero_stock (real Postgres)', () => {
  let prisma: PrismaService;
  let flag = false;
  const config = {
    get: async <T>(key: string, fallback?: T): Promise<T> => (key === PANCAKE_IGNORE_ZERO_STOCK_KEY ? (flag as T) : (fallback as T)),
  } as unknown as SystemConfigService;
  const productIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  beforeEach(() => {
    flag = false;
  });

  afterAll(async () => {
    await deleteItData(prisma, { productIds });
    await prisma.$disconnect();
  });

  /** Chỉ chữ cái: tên hàng có chữ số kiểu "8x 3" bị PACK_RE coi là gói nhiều món. */
  const letters = () => randCode(10).replace(/[^A-WYZa-wyz]/g, 'q').slice(0, 8);

  async function variation(stock: number, reservedStock = 0) {
    const tag = letters();
    const product = await prisma.product.create({
      data: { pancakeId: `itzs-p-${tag}`, brand: 'IT', slug: `itzs-${tag.toLowerCase()}`, name: `SP giữ tồn ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    productIds.push(product.id);
    const v = await prisma.variation.create({
      data: {
        pancakeId: `itzs-v-${tag}`,
        productId: product.id,
        sku: `itzs-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        stock,
        pancakeStock: stock + reservedStock,
        reservedStock,
      },
    });
    return { id: v.id, pancakeId: v.pancakeId!, productPancakeId: product.pancakeId! };
  }

  const stockOf = (id: string) =>
    prisma.variation.findUniqueOrThrow({ where: { id }, select: { stock: true, reservedStock: true, pancakeStock: true } });

  /** Lượt đồng bộ theo updated_since (không quét toàn bộ nên không tắt hàng của spec khác), một trang chứa đúng biến thể này. */
  async function catalogSync(v: { pancakeId: string; productPancakeId: string }, remain: number, opts: { forceStock?: boolean } = {}) {
    let served = false;
    const client = {
      isConfigured: () => true,
      fetchProducts: jest.fn(async () => {
        if (served) return { success: true, data: [], total_pages: 1, total_entries: 1 };
        served = true;
        const product = {
          id: v.productPancakeId,
          name: 'SP đồng bộ',
          variations: [{ id: v.pancakeId, sku: v.pancakeId, retail_price: 100_000, remain_quantity: remain, fields: {} }],
        };
        return { success: true, data: [product], total_pages: 1, total_entries: 1 };
      }),
    } as unknown as PancakeClient;
    const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;
    const svc = new PancakeSyncService(prisma, client, lifecycle, undefined, config);
    const log = jest.spyOn((svc as unknown as { logger: Logger }).logger, 'log');
    await svc.syncProducts(new Date(Date.now() - 15 * 60_000).toISOString(), opts);
    return log.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith(PANCAKE_IGNORE_ZERO_STOCK_KEY));
  }

  async function webhook(pancakeId: string, remain: number) {
    const proc = new PancakeProcessor(
      prisma,
      { notify: jest.fn(), notifySafe: jest.fn().mockResolvedValue(true) } as unknown as NotificationsService,
      {} as OrderStatusService,
      { alert: jest.fn() } as never,
      config,
    );
    const body = { event: PANCAKE_STOCK_EVENT, data: { variation_id: pancakeId, remain_quantity: remain } };
    const event = await prisma.pancakeWebhookEvent.create({
      data: { eventType: PANCAKE_STOCK_EVENT, dedupeKey: pancakeDedupeKey(PANCAKE_STOCK_EVENT, body), rawPayload: body, status: 'RECEIVED' },
    });
    await proc.process({ data: { eventId: event.id } } as never);
    return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
  }

  it('cờ bật: tồn 99 + Pancake báo 0 → giữ 99 và ghi pancakeStock 0; đơn app trừ còn 98; Pancake báo 5 → 5 − giữ chỗ', async () => {
    flag = true;
    const v = await variation(99);
    const logs = await catalogSync(v, 0);
    expect(await stockOf(v.id)).toEqual({ stock: 99, reservedStock: 0, pancakeStock: 0 });
    expect(logs).toEqual([`${PANCAKE_IGNORE_ZERO_STOCK_KEY} bật: giữ tồn của 1 biến thể Pancake báo 0 mà Tubu còn hàng.`]);

    expect(await reserveVariationStock(prisma, v.id, 1)).toBe(true);
    expect(await stockOf(v.id)).toEqual({ stock: 98, reservedStock: 1, pancakeStock: 0 });

    // Lượt sau Pancake vẫn báo 0: vẫn giữ, giữ chỗ của đơn app không bị nhả.
    await catalogSync(v, 0);
    expect(await stockOf(v.id)).toEqual({ stock: 98, reservedStock: 1, pancakeStock: 0 });

    await catalogSync(v, 5);
    expect(await stockOf(v.id)).toEqual({ stock: 4, reservedStock: 1, pancakeStock: 5 });

    // Huỷ đơn app trả hàng về như cũ.
    await releaseVariationStock(prisma, v.id, 1);
    expect(await stockOf(v.id)).toEqual({ stock: 5, reservedStock: 0, pancakeStock: 5 });
  });

  it('cờ tắt (mặc định): Pancake báo 0 là hết hàng như cũ, không in dòng giữ tồn', async () => {
    const v = await variation(99);
    const logs = await catalogSync(v, 0);
    expect(await stockOf(v.id)).toEqual({ stock: 0, reservedStock: 0, pancakeStock: 0 });
    expect(logs).toEqual([]);
  });

  it('cờ bật, tồn đã 0 mà Pancake báo 0: áp như thường (nhả giữ chỗ Pancake đã phản ánh), không đếm là giữ', async () => {
    flag = true;
    const v = await variation(0, 2);
    const logs = await catalogSync(v, 0);
    expect(await stockOf(v.id)).toEqual({ stock: 0, reservedStock: 0, pancakeStock: 0 });
    expect(logs).toEqual([`${PANCAKE_IGNORE_ZERO_STOCK_KEY} bật: giữ tồn của 0 biến thể Pancake báo 0 mà Tubu còn hàng.`]);
  });

  it('đồng bộ ghi đè tồn kho của admin (?withStock=1) cũng theo cờ: báo 0 thì giữ cả tồn lẫn giữ chỗ; báo số dương thì ghi đè như cũ', async () => {
    flag = true;
    const v = await variation(40, 3);
    await catalogSync(v, 0, { forceStock: true });
    expect(await stockOf(v.id)).toEqual({ stock: 40, reservedStock: 3, pancakeStock: 0 });
    await catalogSync(v, 7, { forceStock: true });
    expect(await stockOf(v.id)).toEqual({ stock: 7, reservedStock: 0, pancakeStock: 7 });

    flag = false;
    const off = await variation(40, 3);
    await catalogSync(off, 0, { forceStock: true });
    expect(await stockOf(off.id)).toEqual({ stock: 0, reservedStock: 0, pancakeStock: 0 });
  });

  it('webhook tồn kho theo cờ: bật thì báo 0 giữ tồn, tắt thì về 0', async () => {
    flag = true;
    const v = await variation(12);
    expect((await webhook(v.pancakeId, 0)).status).toBe('PROCESSED');
    expect(await stockOf(v.id)).toEqual({ stock: 12, reservedStock: 0, pancakeStock: 0 });
    expect((await webhook(v.pancakeId, 3)).status).toBe('PROCESSED');
    expect(await stockOf(v.id)).toEqual({ stock: 3, reservedStock: 0, pancakeStock: 3 });

    flag = false;
    const off = await variation(12);
    expect((await webhook(off.pancakeId, 0)).status).toBe('PROCESSED');
    expect(await stockOf(off.id)).toEqual({ stock: 0, reservedStock: 0, pancakeStock: 0 });
  });

  it('tồn MSS đẩy sang theo cờ và đếm số biến thể được giữ', async () => {
    const now = new Date();
    const v = await variation(8);
    const line = { pancakeVariationId: v.pancakeId, stock: 0, asOf: new Date(now.getTime() - 1_000) };
    const res = await applyMssStock(prisma, [line], { signedAt: now, now }, { keepPositiveOnZero: true });
    expect(res).toMatchObject({ applied: 1, kept: 1, wentOut: [] });
    expect(await stockOf(v.id)).toEqual({ stock: 8, reservedStock: 0, pancakeStock: 0 });

    const off = await variation(8);
    const later = new Date(now.getTime() + 10);
    const resOff = await applyMssStock(prisma, [{ ...line, pancakeVariationId: off.pancakeId }], { signedAt: later, now: later });
    expect(resOff).toMatchObject({ applied: 1, kept: 0 });
    expect(await stockOf(off.id)).toEqual({ stock: 0, reservedStock: 0, pancakeStock: 0 });
  });

  it('đơn app giữ chỗ song song với Pancake báo 0: không mất lượt giữ chỗ nào, tồn = 50 − số đơn', async () => {
    const v = await variation(50);
    const orders = Array.from({ length: 20 }, () => reserveVariationStock(prisma, v.id, 1));
    const zeros = Array.from({ length: 5 }, () => applyPancakeStock(prisma, v.pancakeId, 0, undefined, { keepPositiveOnZero: true }));
    const results = await Promise.all([...orders, ...zeros]);
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(await stockOf(v.id)).toEqual({ stock: 30, reservedStock: 20, pancakeStock: 0 });
  });

  it('tồn chạm 0 vì đơn app rồi Pancake báo 0: không còn gì để giữ, Pancake 0 nhả giữ chỗ như thường', async () => {
    const v = await variation(2);
    expect(await reserveVariationStock(prisma, v.id, 2)).toBe(true);
    let kept = 0;
    await applyPancakeStock(prisma, v.pancakeId, 0, undefined, { keepPositiveOnZero: true, onKept: () => kept++ });
    expect(kept).toBe(0);
    expect(await stockOf(v.id)).toEqual({ stock: 0, reservedStock: 0, pancakeStock: 0 });
    expect(await reserveVariationStock(prisma, v.id, 1)).toBe(false);
  });
});
