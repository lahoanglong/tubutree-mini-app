import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { pancakeDedupeKey, PANCAKE_STOCK_EVENT } from '../../src/modules/integrations/pancake/pancake-webhook-dedupe';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { randCode, warmPool } from './helpers';

/**
 * TK-03 trên Postgres THẬT: webhook tồn kho KHÔNG có updated_at. Webhook A (nhận 10:00:00) lỗi tạm rồi được BullMQ thử lại lúc
 * 10:00:02, webhook B (nhận 10:00:01, số mới hơn) đã áp trước đó: A không được ghi đè B. Thử lại cùng một sự kiện (cùng
 * receivedAt) thì vẫn áp được.
 */
describe('Webhook tồn kho không có updated_at xử lý lệch thứ tự (real Postgres)', () => {
  let prisma: PrismaService;
  let proc: PancakeProcessor;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    proc = new PancakeProcessor(
      prisma,
      { notify: jest.fn(), notifySafe: jest.fn().mockResolvedValue(true) } as unknown as NotificationsService,
      {} as OrderStatusService,
      { alert: jest.fn() } as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function variation(data: { pancakeStock: number; stock: number }) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itr9o-p-${tag}`, brand: 'IT', slug: `itr9o-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    return prisma.variation.create({
      data: { pancakeId: `itr9o-v-${tag}`, productId: product.id, sku: `itr9o-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, reservedStock: 0, ...data },
    });
  }

  async function stockEvent(pancakeId: string, remain: number, receivedAt: string, extra: Record<string, unknown> = {}) {
    const body = { event: PANCAKE_STOCK_EVENT, data: { variation_id: pancakeId, remain_quantity: remain, ...extra } };
    const event = await prisma.pancakeWebhookEvent.create({
      data: { eventType: PANCAKE_STOCK_EVENT, dedupeKey: pancakeDedupeKey(PANCAKE_STOCK_EVENT, body), rawPayload: body, status: 'RECEIVED', receivedAt: new Date(receivedAt) },
    });
    return event.id;
  }

  const run = (eventId: string) => proc.process({ data: { eventId } } as never);

  it('B (nhận sau) áp trước, A (nhận trước) thử lại sau → stock giữ số của B, A IGNORED', async () => {
    const v = await variation({ pancakeStock: 10, stock: 10 });
    const a = await stockEvent(v.pancakeId!, 5, '2026-11-04T10:00:00.000Z');
    const b = await stockEvent(v.pancakeId!, 3, '2026-11-04T10:00:01.000Z');
    await run(b);
    await run(a);
    const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
    expect(after).toMatchObject({ stock: 3, pancakeStock: 3 });
    const e = await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: a } });
    expect(e.status).toBe('IGNORED');
    expect(e.error).toContain('trước webhook đã áp');
  });

  it('A và B chạy song song, B commit trước → vẫn là số của B (nhiều vòng)', async () => {
    for (let round = 0; round < 5; round++) {
      const v = await variation({ pancakeStock: 10, stock: 10 });
      const a = await stockEvent(v.pancakeId!, 5, '2026-11-04T11:00:00.000Z');
      const b = await stockEvent(v.pancakeId!, 3, '2026-11-04T11:00:01.000Z');
      await run(b);
      await Promise.all([run(a), run(a)]);
      const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
      expect(after).toMatchObject({ stock: 3, pancakeStock: 3 });
    }
  });

  it('thử lại cùng sự kiện (cùng receivedAt) vẫn áp được', async () => {
    const v = await variation({ pancakeStock: 10, stock: 10 });
    const a = await stockEvent(v.pancakeId!, 5, '2026-11-04T12:00:00.000Z');
    await run(a);
    await prisma.pancakeWebhookEvent.update({ where: { id: a }, data: { status: 'RECEIVED' } });
    await run(a);
    const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
    expect(after).toMatchObject({ stock: 5, pancakeStock: 5 });
    expect((await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: a } })).status).toBe('PROCESSED');
  });

  it('có updated_at mới hơn nhưng nhận muộn hơn mốc đã áp (mốc eventAt đã có) → vẫn áp theo updated_at (R5-SYNC-3)', async () => {
    const v = await variation({ pancakeStock: 10, stock: 10 });
    const first = await stockEvent(v.pancakeId!, 9, '2026-11-04T13:00:05.000Z', { updated_at: '2026-11-04T13:00:00.000Z' });
    await run(first);
    const late = await stockEvent(v.pancakeId!, 7, '2026-11-04T13:00:01.000Z', { updated_at: '2026-11-04T13:00:03.000Z' });
    await run(late);
    const after = await prisma.variation.findUniqueOrThrow({ where: { id: v.id } });
    expect(after).toMatchObject({ stock: 7, pancakeStock: 7 });
  });
});
