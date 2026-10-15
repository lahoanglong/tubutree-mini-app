/**
 * @jest-environment ./vn-time-zone.environment.js
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { PancakeSyncService } from '../../src/modules/integrations/pancake/pancake-sync.service';
import { pancakeDedupeKey, PANCAKE_STOCK_EVENT } from '../../src/modules/integrations/pancake/pancake-webhook-dedupe';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { randCode, sleep, warmPool } from './helpers';

/**
 * R5-SYNC-3 trên Postgres THẬT, dưới múi giờ production (TZ=Asia/Ho_Chi_Minh), với `updated_at` kiểu Pancake không mang múi giờ.
 *
 * Lượt đồng bộ danh mục ghi tồn kho kèm lúc nó bắt đầu đọc trang Pancake (giờ máy chủ Tubu). Webhook tồn kho được so với mốc đó
 * bằng lúc Tubu NHẬN webhook (cùng đồng hồ), không bằng `updated_at` của Pancake: chuỗi không múi giờ được Node đọc theo múi giờ
 * của tiến trình, nên so `updated_at` với đồng hồ máy chủ lệch 7 giờ và chặn mất webhook mới hơn. Stub: HTTP Pancake (client giả
 * trả đúng một trang), thông báo, OrderStatusService.
 */
describe('Đồng bộ danh mục xen giữa các webhook tồn kho, giờ VN (real Postgres)', () => {
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

  it('spec chạy dưới múi giờ production: chuỗi giờ không múi giờ bị đọc theo giờ VN', () => {
    expect(new Date('2026-10-14T03:00:00').toISOString()).toBe('2026-10-13T20:00:00.000Z');
  });

  /** Giờ UTC viết như Pancake: không múi giờ, phần lẻ micro giây. */
  const naive = (d: Date) => d.toISOString().replace('Z', '000');

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

  /** Webhook tồn kho tới controller: lưu sự kiện (receivedAt = lúc này), chưa xử lý. */
  async function receive(pancakeId: string, remain: number, updatedAt: string) {
    const body = { event: PANCAKE_STOCK_EVENT, data: { variation_id: pancakeId, remain_quantity: remain, updated_at: updatedAt } };
    const event = await prisma.pancakeWebhookEvent.create({
      data: { eventType: PANCAKE_STOCK_EVENT, dedupeKey: pancakeDedupeKey(PANCAKE_STOCK_EVENT, body), rawPayload: body, status: 'RECEIVED' },
    });
    return event.id;
  }

  async function run(eventId: string) {
    await proc.process({ data: { eventId } } as never);
    return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  }

  const stockEvent = async (pancakeId: string, remain: number, updatedAt: string) => run(await receive(pancakeId, remain, updatedAt));

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

  const stockOf = (id: string) => prisma.variation.findUniqueOrThrow({ where: { id }, select: { stock: true, pancakeStock: true } });

  it('webhook nhận TRƯỚC lúc đồng bộ đọc Pancake nhưng xử lý SAU (hàng đợi chậm, Redis sập) → IGNORED, tồn kho giữ số đồng bộ', async () => {
    const v = await variation(100);
    expect((await stockEvent(v.pancakeId!, 50, naive(new Date(Date.now() - 60_000)))).status).toBe('PROCESSED');
    expect(await stockOf(v.id)).toEqual({ stock: 50, pancakeStock: 50 });

    const queued = await receive(v.pancakeId!, 55, naive(new Date(Date.now() - 30_000)));
    await catalogSync(v, 40);
    expect(await stockOf(v.id)).toEqual({ stock: 40, pancakeStock: 40 });

    const late = await run(queued);
    expect(late.status).toBe('IGNORED');
    expect(late.error).toContain('đồng bộ danh mục');
    expect(await stockOf(v.id)).toEqual({ stock: 40, pancakeStock: 40 });
  });

  it('webhook nhận SAU lần đọc của đồng bộ, updated_at không múi giờ → PROCESSED; webhook cũ hơn nó tới sau vẫn bị bỏ', async () => {
    const v = await variation(100);
    await stockEvent(v.pancakeId!, 50, naive(new Date(Date.now() - 60_000)));
    await catalogSync(v, 40);
    // Nhận đúng mili giây lượt đồng bộ bắt đầu đọc thì thua lượt đồng bộ (Pancake đọc số sau đó) — ở đây nhận hẳn sau.
    await sleep(5);

    const newerAt = new Date(Date.now() + 60_000);
    const newer = await stockEvent(v.pancakeId!, 35, naive(newerAt));
    expect(newer).toMatchObject({ status: 'PROCESSED', error: null });
    expect(await stockOf(v.id)).toEqual({ stock: 35, pancakeStock: 35 });

    const older = await stockEvent(v.pancakeId!, 45, naive(new Date(newerAt.getTime() - 1_000)));
    expect(older.status).toBe('IGNORED');
    expect(older.error).toContain('cũ hơn');
    expect(await stockOf(v.id)).toEqual({ stock: 35, pancakeStock: 35 });
  });

  it('webhook mới hơn được áp trong lúc đồng bộ đang chạy → lượt đồng bộ không ghi đè bằng số đã đọc trước đó', async () => {
    const v = await variation(100);
    await catalogSync(v, 40, async () => {
      await sleep(5);
      expect((await stockEvent(v.pancakeId!, 20, naive(new Date()))).status).toBe('PROCESSED');
    });
    expect(await stockOf(v.id)).toEqual({ stock: 20, pancakeStock: 20 });
  });

  it('updated_at đi trước đồng hồ máy chủ (múi giờ khác, lệch giờ) không chặn lượt đồng bộ sau', async () => {
    const v = await variation(100);
    await stockEvent(v.pancakeId!, 50, new Date(Date.now() + 7 * 3_600_000).toISOString());
    expect(await stockOf(v.id)).toEqual({ stock: 50, pancakeStock: 50 });
    await catalogSync(v, 40);
    expect(await stockOf(v.id)).toEqual({ stock: 40, pancakeStock: 40 });
  });
});
