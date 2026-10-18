import type { Job } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { ExternalOrdersAdminService } from '../../src/modules/external-points/external-orders-admin.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { randCode, summarize, warmPool } from './helpers';

/**
 * Nhận đơn Pancake ngoài app trên Postgres THẬT: nhiều webhook song song của cùng một đơn sàn chỉ tạo MỘT dòng và bản có
 * `updated_at` mới nhất thắng dù tới sau (UPDATE có điều kiện khoá dòng rồi đọc lại điều kiện).
 */
describe('Nạp đơn ngoài app: song song cùng đơn Pancake (real Postgres)', () => {
  let prisma: PrismaService;
  let processor: PancakeProcessor;
  const pids: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    processor = new PancakeProcessor(
      prisma,
      { notify: jest.fn() } as unknown as NotificationsService,
      { setStatus: jest.fn() } as unknown as OrderStatusService,
    );
  });

  afterAll(async () => {
    await prisma.externalOrder.deleteMany({ where: { pancakeOrderId: { in: pids } } });
    await prisma.pancakeWebhookEvent.deleteMany({ where: { rawPayload: { path: ['id'], string_contains: 'EXT' } } });
    await prisma?.$disconnect();
  });

  const body = (id: string, status: number, updatedAt: string, extra: Record<string, unknown> = {}) => ({
    id,
    status,
    marketplace_id: -3,
    is_from_ecommerce: true,
    order_sources: -3,
    account: 'shopee_it',
    bill_phone_number: '0912345678',
    items: [{ quantity: 1, discount_each_product: 0, variation_info: { retail_price: 200_000 } }],
    total_price: 200_000,
    total_discount: 0,
    partner: { extend_code: `SPX${randCode(8)}` },
    updated_at: updatedAt,
    ...extra,
  });

  async function send(payload: Record<string, unknown>) {
    const event = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'orders', dedupeKey: `orders|${randCode(16)}`, rawPayload: payload as object, status: 'RECEIVED' },
    });
    await processor.process({ data: { eventId: event.id } } as Job<{ eventId: string }>);
    return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
  }

  it('(a) 6 webhook song song cùng đơn, thứ tự tới đảo lộn: 1 dòng, trạng thái của bản mới nhất thắng', async () => {
    const pid = `EXT${randCode(10)}`;
    pids.push(pid);
    const versions = [
      body(pid, 0, '2026-10-10T09:00:00'),
      body(pid, 1, '2026-10-10T10:00:00'),
      body(pid, 2, '2026-10-11T09:00:00'),
      body(pid, 3, '2026-10-13T15:30:00', { status_history: [{ status: 3, updated_at: '2026-10-13T15:30:00' }] }),
      body(pid, 2, '2026-10-12T09:00:00'),
      body(pid, 1, '2026-10-10T09:30:00'),
    ];
    const results = await Promise.allSettled([...versions].reverse().map((v) => send(v)));
    const s = summarize(results);
    const rows = await prisma.externalOrder.findMany({ where: { pancakeOrderId: pid } });
    console.log('[a] fulfilled=%d rejected=%d rows=%d errors=%j', s.fulfilled.length, s.rejected.length, rows.length, s.errors);
    expect(s.rejected).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'DELIVERED', pancakeStatus: 3, source: 'MARKETPLACE', channel: 'shopee', goodsValue: 200_000 });
    expect(rows[0]!.pancakeUpdatedAt!.toISOString()).toBe('2026-10-13T08:30:00.000Z');
    expect(rows[0]!.deliveredAt!.toISOString()).toBe('2026-10-13T08:30:00.000Z');
    expect(rows[0]!.phoneLast3).toBe('678');
    for (const r of s.fulfilled) expect(r.value.status).toBe('PROCESSED');
  });

  it('(b) bản cũ tới sau bản mới: bị bỏ qua, dòng giữ nguyên', async () => {
    const pid = `EXT${randCode(10)}`;
    pids.push(pid);
    await send(body(pid, 6, '2026-10-14T10:00:00'));
    const before = await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: pid } });
    const stale = await send(body(pid, 2, '2026-10-12T10:00:00'));
    const after = await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: pid } });
    expect(stale.status).toBe('PROCESSED');
    expect(after).toMatchObject({ status: 'CANCELLED', pancakeStatus: 6 });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.closedAt).not.toBeNull();
  });

  it('(c) hai webhook giao song song không có lịch sử: mốc "lần đầu thấy giao" đặt một lần', async () => {
    const pid = `EXT${randCode(10)}`;
    pids.push(pid);
    await send(body(pid, 2, '2026-10-12T10:00:00'));
    await Promise.all([send(body(pid, 3, '2026-10-13T10:00:00')), send(body(pid, 3, '2026-10-13T10:00:01'))]);
    const rows = await prisma.externalOrder.findMany({ where: { pancakeOrderId: pid } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('DELIVERED');
    expect(rows[0]!.deliveredAt).not.toBeNull();
  });

  it('(d) đơn app chưa khớp không lọt vào bảng đơn ngoài', async () => {
    const pid = `EXT${randCode(10)}`;
    const ev = await send(body(pid, 1, '2026-10-12T10:00:00', { custom_id: 'TUBU20261099999', tags: ['MINIAPP'] }));
    expect(ev.status).toBe('UNMATCHED');
    expect(await prisma.externalOrder.count({ where: { pancakeOrderId: pid } })).toBe(0);
  });

  it('(e) màn admin trên DB thật: tìm theo mã vận đơn, mã đơn sàn, SĐT; bảng nguồn đã thấy; SĐT che', async () => {
    const pid = `EXT${randCode(10)}`;
    pids.push(pid);
    const track = `ZZ${randCode(8).toUpperCase()}`;
    await send(
      body(pid, 3, '2026-10-13T15:30:00', {
        account: `acct_${pid}`,
        partner: { extend_code: track },
        invoice_info_list: [{ order_sn: `SN${track}` }],
        bill_phone_number: '0977123456',
      }),
    );
    const admin = new ExternalOrdersAdminService(prisma, new SystemConfigService(prisma));
    for (const q of [track.toLowerCase(), `SN${track}`, pid, '0977 123 456']) {
      const res = await admin.list({ page: 1, limit: 20, q });
      expect(res.data.map((r) => r.pancakeOrderId)).toEqual([pid]);
      expect(res.data[0]!.phone).toBe('097****456');
    }
    expect((await admin.list({ page: 1, limit: 20, q: track, source: 'CHAT' })).data).toHaveLength(0);
    const { sources } = await admin.sources();
    expect(sources.find((s) => s.sourceKey === `-3|acct_${pid}|-3`)).toMatchObject({ total: 1, currentKind: 'MARKETPLACE', currentChannel: 'shopee' });
    const id = (await admin.list({ page: 1, limit: 1, q: pid })).data[0]!.id;
    expect(await admin.detail(id, true)).toHaveProperty('lastPayload');
    expect(await admin.detail(id, false)).not.toHaveProperty('lastPayload');
  });
});
