import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { PancakeSyncService } from '../../src/modules/integrations/pancake/pancake-sync.service';
import { pancakeDedupeKey, PANCAKE_STOCK_EVENT } from '../../src/modules/integrations/pancake/pancake-webhook-dedupe';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { randCode, warmPool } from './helpers';

/**
 * R5-SYNC-3 trên Postgres THẬT: lượt đồng bộ danh mục ghi tồn kho kèm mốc lúc đọc trang Pancake, nên webhook tồn kho tới trễ
 * mang updated_at cũ hơn lần đọc không kéo tồn kho lùi lại, còn webhook mới hơn vẫn được áp. Stub: HTTP Pancake (client giả trả
 * đúng một trang), thông báo, OrderStatusService.
 */
describe('Đồng bộ danh mục xen giữa các webhook tồn kho (real Postgres)', () => {
  let prisma: PrismaService;
  let proc: PancakeProcessor;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    proc = new PancakeProcessor(
      prisma,
      { notify: jest.fn() } as unknown as NotificationsService,
      {} as OrderStatusService,
      { alert: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function variation(stock: number) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itr9s-p-${tag}`, brand: 'IT', slug: `itr9s-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: {
        pancakeId: `itr9s-v-${tag}`,
        productId: product.id,
        sku: `itr9s-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        stock,
        pancakeStock: stock,
        reservedStock: 0,
      },
    });
    return { ...v, productPancakeId: product.pancakeId! };
  }

  async function stockEvent(pancakeId: string, remain: number, updatedAt: Date) {
    const body = { event: PANCAKE_STOCK_EVENT, data: { variation_id: pancakeId, remain_quantity: remain, updated_at: updatedAt.toISOString() } };
    const event = await prisma.pancakeWebhookEvent.create({
      data: { eventType: PANCAKE_STOCK_EVENT, dedupeKey: pancakeDedupeKey(PANCAKE_STOCK_EVENT, body), rawPayload: body, status: 'RECEIVED' },
    });
    await proc.process({ data: { eventId: event.id } } as never);
    return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
  }

  /**
   * Lượt đồng bộ theo updated_since (không quét toàn bộ, nên không tắt hàng của spec khác) đọc một trang chứa đúng biến thể này.
   * `duringRead` chạy giữa lúc Pancake đọc số và lúc lượt đồng bộ ghi số (webhook tới trong lúc đồng bộ đang chạy).
   */
  async function catalogSync(v: { pancakeId: string | null; productPancakeId: string }, remain: number, duringRead?: () => Promise<unknown>) {
    let readAt: Date | undefined;
    let served = false;
    const client = {
      isConfigured: () => true,
      fetchProducts: jest.fn(async () => {
        if (served) return { success: true, data: [], total_pages: 1, total_entries: 1 };
        served = true;
        readAt = new Date();
        await duringRead?.();
        const product = {
          id: v.productPancakeId,
          name: 'SP đồng bộ',
          variations: [{ id: v.pancakeId!, sku: v.pancakeId!, retail_price: 100_000, remain_quantity: remain, fields: {} }],
        };
        return { success: true, data: [product], total_pages: 1, total_entries: 1 };
      }),
    } as unknown as PancakeClient;
    const lifecycle = { notifyWishlistPriceDrop: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleService;
    await new PancakeSyncService(prisma, client, lifecycle).syncProducts(new Date(Date.now() - 15 * 60_000).toISOString());
    return readAt!;
  }

  const stockOf = (id: string) =>
    prisma.variation.findUniqueOrThrow({ where: { id }, select: { stock: true, pancakeStock: true, pancakeStockEventAt: true } });

  it('webhook T-60 → đồng bộ lúc T → webhook trễ T-30: tồn kho giữ số của lần đồng bộ, sự kiện trễ IGNORED', async () => {
    const v = await variation(100);
    await stockEvent(v.pancakeId!, 50, new Date(Date.now() - 60_000));
    expect(await stockOf(v.id)).toMatchObject({ stock: 50, pancakeStock: 50 });

    const t = await catalogSync(v, 40);
    expect(await stockOf(v.id)).toMatchObject({ stock: 40, pancakeStock: 40, pancakeStockEventAt: t });

    const late = await stockEvent(v.pancakeId!, 55, new Date(t.getTime() - 30_000));
    expect(late.status).toBe('IGNORED');
    expect(late.error).toContain('cũ hơn');
    expect(await stockOf(v.id)).toMatchObject({ stock: 40, pancakeStock: 40, pancakeStockEventAt: t });
  });

  it('webhook mới hơn lần đọc của đồng bộ (T+30) vẫn được áp', async () => {
    const v = await variation(100);
    await stockEvent(v.pancakeId!, 50, new Date(Date.now() - 60_000));
    const t = await catalogSync(v, 40);
    const newer = new Date(t.getTime() + 30_000);
    const ev = await stockEvent(v.pancakeId!, 35, newer);
    expect(ev.status).toBe('PROCESSED');
    expect(await stockOf(v.id)).toMatchObject({ stock: 35, pancakeStock: 35, pancakeStockEventAt: newer });
  });

  it('webhook mới hơn được áp trong lúc đồng bộ đang chạy → lượt đồng bộ không ghi đè bằng số đã đọc trước đó', async () => {
    const v = await variation(100);
    let newer: Date | undefined;
    await catalogSync(v, 40, async () => {
      newer = new Date(Date.now() + 1_000);
      await stockEvent(v.pancakeId!, 20, newer);
    });
    expect(await stockOf(v.id)).toMatchObject({ stock: 20, pancakeStock: 20, pancakeStockEventAt: newer });
  });
});
