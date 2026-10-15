import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { pancakeDedupeKey, PANCAKE_STOCK_EVENT } from '../../src/modules/integrations/pancake/pancake-webhook-dedupe';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { randCode, warmPool } from './helpers';

/**
 * R4-SYNC-2 trên Postgres THẬT: webhook tồn kho Pancake tới không theo thứ tự. Số 80 (updated_at :02) tới trước, số 90 (:01)
 * tới sau — trước đây tồn kho lùi về 90 tới lần đồng bộ danh mục sau. Điều kiện so mốc nằm trong câu UPDATE nên cả khi nhiều
 * sự kiện xử lý song song (nhiều worker), số cuối cùng là số của sự kiện mới nhất. Stub: thông báo, OrderStatusService.
 */
describe('Webhook tồn kho Pancake tới không theo thứ tự (real Postgres)', () => {
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

  async function variation(data: { pancakeStock: number; stock: number; reservedStock?: number }) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itr6s-p-${tag}`, brand: 'IT', slug: `itr6s-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `itr6s-v-${tag}`,
        productId: product.id,
        sku: `itr6s-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        reservedStock: 0,
        ...data,
      },
    });
  }

  async function stockEvent(pancakeId: string, remain: number, updatedAt: string) {
    const body = { event: PANCAKE_STOCK_EVENT, data: { variation_id: pancakeId, remain_quantity: remain, updated_at: updatedAt } };
    const event = await prisma.pancakeWebhookEvent.create({
      data: { eventType: PANCAKE_STOCK_EVENT, dedupeKey: pancakeDedupeKey(PANCAKE_STOCK_EVENT, body), rawPayload: body, status: 'RECEIVED' },
    });
    return event.id;
  }

  const run = (eventId: string) => proc.process({ data: { eventId } } as never);

  it('80 (:02) rồi 90 (:01) → tồn kho giữ 80; sự kiện cũ IGNORED kèm lý do', async () => {
    const v = await variation({ pancakeStock: 100, stock: 100 });
    const newer = await stockEvent(v.pancakeId!, 80, '2026-10-14T07:00:02.000Z');
    const older = await stockEvent(v.pancakeId!, 90, '2026-10-14T07:00:01.000Z');
    await run(newer);
    await run(older);
    const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
    expect(after).toMatchObject({ stock: 80, pancakeStock: 80, pancakeStockEventAt: new Date('2026-10-14T07:00:02.000Z') });
    const e = await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: older } });
    expect(e.status).toBe('IGNORED');
    expect(e.error).toContain('cũ hơn');
    expect((await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: newer } })).status).toBe('PROCESSED');
  });

  it('sự kiện cũ tới sau không hồi sinh phần giữ chỗ đã nhả (đơn của ta đã được Pancake trừ)', async () => {
    const v = await variation({ pancakeStock: 100, stock: 95, reservedStock: 5 });
    const newer = await stockEvent(v.pancakeId!, 95, '2026-10-14T08:00:02.000Z');
    const older = await stockEvent(v.pancakeId!, 100, '2026-10-14T08:00:01.000Z');
    await run(newer);
    await run(older);
    const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
    expect(after).toMatchObject({ stock: 95, pancakeStock: 95, reservedStock: 0 });
  });

  it('24 sự kiện xử lý song song theo thứ tự xáo trộn → số cuối là số của sự kiện mới nhất', async () => {
    for (let round = 0; round < 5; round++) {
      const v = await variation({ pancakeStock: 500, stock: 500 });
      const base = Date.parse('2026-10-14T09:00:00.000Z') + round * 60_000;
      const events = Array.from({ length: 24 }, (_, i) => ({ remain: 400 - i * 7, at: new Date(base + i * 1000).toISOString() }));
      const ids = await Promise.all(events.map((e) => stockEvent(v.pancakeId!, e.remain, e.at)));
      const shuffled = ids.map((id) => ({ id, k: Math.random() })).sort((a, b) => a.k - b.k);
      await Promise.all(shuffled.map(({ id }) => run(id)));
      const newest = events[events.length - 1]!;
      const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
      expect(after).toMatchObject({ pancakeStock: newest.remain, stock: newest.remain, pancakeStockEventAt: new Date(newest.at) });
    }
  });
});
