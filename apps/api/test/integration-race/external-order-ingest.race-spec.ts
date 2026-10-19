import type { Job } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { ExternalOrdersAdminService } from '../../src/modules/external-points/external-orders-admin.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

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

  it('(f) payload app thiếu dấu: UNMATCHED + dòng UNKNOWN; lần thử sau khớp được đơn Tubu thì dòng UNKNOWN bị dọn', async () => {
    const pid = `EXT${randCode(10)}`;
    pids.push(pid);
    const bare = { id: pid, status: 1, updated_at: '2026-10-15T10:00:00', partner: { extend_code: `GHN${randCode(8)}` } };
    const first = await send(bare);
    expect(first.status).toBe('UNMATCHED');
    expect(await prisma.externalOrder.findUnique({ where: { pancakeOrderId: pid } })).toMatchObject({ source: 'UNKNOWN' });

    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, pancakeOrderId: pid });
    const retry = await send({ ...bare, updated_at: '2026-10-15T10:05:00' });
    expect(retry.status).toBe('PROCESSED');
    expect(await prisma.externalOrder.count({ where: { pancakeOrderId: pid } })).toBe(0);
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('(g) webhook một phần sau bản đầy đủ không đè nguồn/tiền/payload; không có updated_at không đè trạng thái đã giao', async () => {
    const pid = `EXT${randCode(10)}`;
    pids.push(pid);
    await send(body(pid, 3, '2026-10-13T15:30:00'));
    await send({ id: pid, status: 3, updated_at: '2026-10-14T10:00:00' });
    await send({ id: pid, status: 1 });
    const row = await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: pid } });
    expect(row).toMatchObject({ source: 'MARKETPLACE', channel: 'shopee', sourceKey: '-3|shopee_it|-3', goodsValue: 200_000, status: 'DELIVERED' });
    expect(row.lastPayload).toHaveProperty('items');
    expect(JSON.stringify(row.lastPayload)).not.toContain('0912345678');
    expect(row.phone).toBe('0912345678');
  });

  it('(h) giá trị vượt Int4 không làm sự kiện FAILED', async () => {
    const pid = `EXT${randCode(10)}`;
    pids.push(pid);
    const ev = await send(
      body(pid, 3, '2026-10-13T15:30:00', {
        items: [{ quantity: 1, discount_each_product: 0, variation_info: { retail_price: 5_000_000_000 } }],
        total_price: 5_000_000_000,
      }),
    );
    expect(ev.status).toBe('PROCESSED');
    expect((await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: pid } })).goodsValue).toBeNull();
    const huge = `EXT${randCode(10)}`;
    pids.push(huge);
    expect((await send(body(huge, 1e12, '2026-10-13T15:30:00'))).status).toBe('PROCESSED');
  });

  it('(i) dòng UNKNOWN đã có claim: đơn app ghép được vẫn xử lý bình thường, dòng giữ nguyên (FK), không FAILED', async () => {
    const pid = `EXT${randCode(10)}`;
    pids.push(pid);
    const bare = { id: pid, status: 1, updated_at: '2026-10-15T10:00:00', partner: { extend_code: `GHN${randCode(8)}` } };
    expect((await send(bare)).status).toBe('UNMATCHED');
    const ext = await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: pid } });
    await prisma.externalPointsClaim.create({
      data: { externalOrderId: ext.id, kind: 'SCAN', ratePct: 0.01, multiplier: 1, dayKey: '2026-10-15' },
    });
    const user = await createUser(prisma);
    const order = await createOrder(prisma, { userId: user.id, pancakeOrderId: pid });
    const retry = await send({ ...bare, updated_at: '2026-10-15T10:05:00' });
    expect(retry.status).toBe('PROCESSED');
    expect(await prisma.externalOrder.count({ where: { pancakeOrderId: pid } })).toBe(1);
    await prisma.externalPointsClaim.deleteMany({ where: { externalOrderId: ext.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('(j) retention: xoá SĐT đơn ngoài quá hạn, giữ dòng; đơn còn claim chờ giữ SĐT', async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    const mk = async (phone: string) => {
      const pid = `EXT${randCode(10)}`;
      pids.push(pid);
      await send(body(pid, 3, '2026-10-13T15:30:00', { bill_phone_number: phone }));
      await prisma.$executeRaw`UPDATE external_orders SET "updatedAt" = ${old} WHERE "pancakeOrderId" = ${pid}`;
      return pid;
    };
    const plain = await mk('0911111111');
    const claimed = await mk('0922222222');
    const claimedRow = await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: claimed } });
    await prisma.externalPointsClaim.create({
      data: { externalOrderId: claimedRow.id, kind: 'PHONE', ratePct: 0.01, multiplier: 1, dayKey: '2026-10-15' },
    });
    const { DataRetentionService } = await import('../../src/modules/data-retention/data-retention.service');
    const { SystemConfigService } = await import('../../src/modules/system-config/system-config.service');
    await new DataRetentionService(prisma, new SystemConfigService(prisma)).runAll({ pauseMs: 0 });
    expect(await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: plain } })).toMatchObject({ phone: null, status: 'DELIVERED' });
    expect((await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: claimed } })).phone).toBe('0922222222');
    await prisma.externalPointsClaim.deleteMany({ where: { externalOrderId: claimedRow.id } });
  });
});
