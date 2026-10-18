import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PancakeProcessor } from './pancake.processor';
import { EXTERNAL_CAPTURE_ENABLED_KEY, ORDER_SOURCE_MAP_KEY } from '../../external-points/external-order.config';

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, '../../../../test/fixtures/pancake', name), 'utf-8')) as Record<string, unknown>;

interface Opts {
  matched?: Record<string, unknown> | null;
  foreignOrder?: Record<string, unknown> | null;
  config?: Record<string, unknown>;
  updateCount?: number;
  createCount?: number;
}

function setup(rawPayload: Record<string, unknown>, o: Opts = {}, eventType = 'orders') {
  const eventUpdate = jest.fn().mockResolvedValue({});
  const externalOrder = {
    createMany: jest.fn().mockResolvedValue({ count: o.createCount ?? 1 }),
    updateMany: jest.fn().mockResolvedValue({ count: o.updateCount ?? 1 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const prisma = {
    order: {
      // resolveOrder: theo pancakeOrderId rồi theo mã đơn Tubu.
      findFirst: jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve('pancakeOrderId' in where ? (o.matched ?? null) : (o.foreignOrder ?? null)),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    externalOrder,
    pancakeWebhookEvent: {
      findUnique: jest.fn().mockResolvedValue({ id: 'e1', status: 'RECEIVED', eventType, rawPayload, receivedAt: new Date() }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: eventUpdate,
    },
  };
  const config = {
    get: jest.fn((k: string, d: unknown) => Promise.resolve(o.config && k in o.config ? o.config[k] : d)),
  };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };
  const proc = new PancakeProcessor(prisma as never, {} as never, {} as never, alerts as never, config as never);
  const finalStatus = () => (eventUpdate.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data;
  return { proc, prisma, externalOrder, alerts, finalStatus, run: () => proc.process({ data: { eventId: 'e1' } } as never) };
}

describe('PancakeProcessor — nạp đơn ngoài app', () => {
  it('đơn sàn không khớp đơn Tubu: lưu vào external_orders và sự kiện PROCESSED', async () => {
    const t = setup(fixture('synthetic-shopee.json'));
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'PROCESSED', error: null });
    expect(t.externalOrder.createMany).toHaveBeenCalledTimes(1);
    const row = (t.externalOrder.createMany.mock.calls[0]![0] as { data: Record<string, unknown>[] }).data[0]!;
    expect(row).toMatchObject({
      pancakeOrderId: '910001',
      source: 'MARKETPLACE',
      channel: 'shopee',
      sourceKey: '-3|shopee_gian_hang|-3',
      trackingCode: 'SPXVN0123456789',
      marketplaceOrderSn: '2410101ABCDEF',
      phone: '0912345678',
      phoneLast3: '678',
      goodsValue: 320_000,
      status: 'DELIVERED',
      pancakeStatus: 3,
    });
    expect((row['deliveredAt'] as Date).toISOString()).toBe('2026-10-13T08:30:00.000Z');
  });

  it('payload bọc {event, data} cũng được nạp theo object đơn bên trong', async () => {
    const t = setup({ event: 'order.updated', data: fixture('synthetic-lazada.json') }, {}, 'order.updated');
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'PROCESSED' });
    expect((t.externalOrder.createMany.mock.calls[0]![0] as { data: { channel: string }[] }).data[0]!.channel).toBe('lazada');
  });

  it('đơn có mã Tubu mà chưa khớp (webhook tới trước khi lưu pancakeOrderId) vẫn UNMATCHED, không lưu', async () => {
    const t = setup({ ...fixture('synthetic-shopee.json'), custom_id: 'TUBU20261001' });
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'UNMATCHED' });
    expect(t.externalOrder.createMany).not.toHaveBeenCalled();
  });

  it('đơn app theo tag MINIAPP chưa khớp cũng UNMATCHED', async () => {
    const t = setup(fixture('synthetic-app.json'));
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'UNMATCHED' });
    expect(t.externalOrder.createMany).not.toHaveBeenCalled();
  });

  it('đơn đã khớp đơn Tubu: không đụng bảng đơn ngoài', async () => {
    const matched = { id: 'o1', code: 'TUBU1', status: 'CONFIRMED', fulfiller: 'TUBU', pancakeOrderId: '910001', total: 340_000, shippingFee: 0 };
    const t = setup(fixture('synthetic-shopee.json'), { matched });
    t.proc['onOrderEvent' as never] = jest.fn().mockResolvedValue(undefined) as never;
    await t.run();
    expect(t.externalOrder.createMany).not.toHaveBeenCalled();
    expect(t.externalOrder.updateMany).not.toHaveBeenCalled();
  });

  it('đơn app thiếu dấu (không mã, tag, custom_id, nguồn): lưu dòng UNKNOWN nhưng sự kiện giữ UNMATCHED để cron ghép lại', async () => {
    const t = setup({ id: 910009, status: 1, updated_at: '2026-10-15T10:00:00', partner: { extend_code: 'GHN123456' } });
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'UNMATCHED' });
    expect((t.externalOrder.createMany.mock.calls[0]![0] as { data: { source: string }[] }).data[0]!.source).toBe('UNKNOWN');
  });

  it('đơn chat chưa biết nguồn (UNKNOWN) cũng UNMATCHED; sàn và chat đã xếp thì PROCESSED', async () => {
    const unknown = setup(fixture('synthetic-chat.json'));
    await unknown.run();
    expect(unknown.finalStatus()).toMatchObject({ status: 'UNMATCHED' });
    const chat = setup(fixture('synthetic-chat.json'), { config: { [ORDER_SOURCE_MAP_KEY]: { marketplaceIds: {}, chatSources: ['-1|fanpage_mau|'] } } });
    await chat.run();
    expect(chat.finalStatus()).toMatchObject({ status: 'PROCESSED' });
  });

  it('lần thử lại ghép được đơn Tubu: dọn dòng UNKNOWN cùng pancakeOrderId, không đụng dòng sàn/chat', async () => {
    const matched = { id: 'o1', code: 'TUBU1', status: 'CONFIRMED', fulfiller: 'TUBU', pancakeOrderId: '910001', total: 340_000, shippingFee: 0 };
    const t = setup(fixture('synthetic-shopee.json'), { matched });
    t.proc['onOrderEvent' as never] = jest.fn().mockResolvedValue(undefined) as never;
    await t.run();
    expect(t.externalOrder.deleteMany).toHaveBeenCalledWith({ where: { pancakeOrderId: '910001', source: 'UNKNOWN' } });
    expect(t.finalStatus()).toMatchObject({ status: 'PROCESSED' });
  });

  it('công tắc nạp tắt thì không dọn gì khi đã khớp đơn Tubu', async () => {
    const matched = { id: 'o1', code: 'TUBU1', status: 'CONFIRMED', fulfiller: 'TUBU', pancakeOrderId: '910001' };
    const t = setup(fixture('synthetic-shopee.json'), { matched, config: { [EXTERNAL_CAPTURE_ENABLED_KEY]: false } });
    t.proc['onOrderEvent' as never] = jest.fn().mockResolvedValue(undefined) as never;
    await t.run();
    expect(t.externalOrder.deleteMany).not.toHaveBeenCalled();
  });

  it('đơn lạ mang mã Tubu đã gắn đơn Pancake khác (foreign): không lưu', async () => {
    const foreignOrder = { id: 'o1', code: 'TUBU1', status: 'CONFIRMED', pancakeOrderId: '555', fulfiller: 'TUBU' };
    const t = setup({ ...fixture('synthetic-shopee.json'), custom_id: 'TUBU1', note: 'Order code: TUBU1' }, { foreignOrder });
    (t.proc as unknown as { flagForeignPancakeOrder: jest.Mock }).flagForeignPancakeOrder = jest.fn().mockResolvedValue(undefined);
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'PROCESSED' });
    expect(t.externalOrder.createMany).not.toHaveBeenCalled();
  });

  it('đơn gian hàng đối tác tự giao (khớp đơn Tubu): bỏ qua như cũ, không lưu', async () => {
    const matched = { id: 'o1', code: 'TUBU1', status: 'CONFIRMED', fulfiller: 'MERCHANT', pancakeOrderId: '910001' };
    const t = setup(fixture('synthetic-shopee.json'), { matched });
    (t.proc as unknown as { flagMerchantOrderOnPancake: jest.Mock }).flagMerchantOrderOnPancake = jest.fn().mockResolvedValue('bỏ qua');
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'IGNORED' });
    expect(t.externalOrder.createMany).not.toHaveBeenCalled();
  });

  it('bản cũ hơn bản đã lưu (updated_at nhỏ hơn): bỏ qua nhưng sự kiện vẫn PROCESSED', async () => {
    const t = setup(fixture('synthetic-shopee.json'), { createCount: 0, updateCount: 0 });
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'PROCESSED' });
    const where = (t.externalOrder.updateMany.mock.calls[0]![0] as { where: { OR: unknown[] } }).where;
    expect(where.OR).toEqual([
      { pancakeUpdatedAt: null },
      { pancakeUpdatedAt: { lte: new Date('2026-10-13T08:30:00.000Z') } },
    ]);
    expect(t.externalOrder.updateMany).toHaveBeenCalledTimes(1);
  });

  it('đơn đã có: cập nhật theo bản mới và đặt mốc giao lần đầu thấy khi payload không có lịch sử', async () => {
    const payload = { ...fixture('synthetic-chat.json'), status_history: undefined };
    const t = setup(payload, { createCount: 0 });
    await t.run();
    const calls = t.externalOrder.updateMany.mock.calls.map(([a]) => a as { where: Record<string, unknown>; data: Record<string, unknown> });
    expect(calls[0]!.data).toMatchObject({ status: 'DELIVERED', pancakeStatus: 16, source: 'UNKNOWN' });
    expect(calls[1]).toMatchObject({ where: { pancakeOrderId: '910004', deliveredAt: null } });
    expect(calls[1]!.data['deliveredAt']).toBeInstanceOf(Date);
  });

  it('đơn đã huỷ đặt closedAt một lần', async () => {
    const t = setup({ ...fixture('synthetic-shopee.json'), status: 6 }, { createCount: 0 });
    await t.run();
    const calls = t.externalOrder.updateMany.mock.calls.map(([a]) => a as { where: Record<string, unknown>; data: Record<string, unknown> });
    expect(calls[0]!.data).toMatchObject({ status: 'CANCELLED' });
    expect(calls.at(-1)).toMatchObject({ where: { pancakeOrderId: '910001', closedAt: null } });
  });

  it('payload một phần (không có status) giữ nguyên trạng thái và SĐT đã biết', async () => {
    const t = setup({ id: 910001, marketplace_id: -3, updated_at: '2026-10-14T00:00:00' }, { createCount: 0 });
    await t.run();
    const data = (t.externalOrder.updateMany.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('pancakeStatus');
    expect(data).not.toHaveProperty('phone');
    expect(data).not.toHaveProperty('trackingCodes');
  });

  it('công tắc pancake.external_capture_enabled=false: giữ hành vi cũ (UNMATCHED, không lưu)', async () => {
    const t = setup(fixture('synthetic-shopee.json'), { config: { [EXTERNAL_CAPTURE_ENABLED_KEY]: false } });
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'UNMATCHED' });
    expect(t.externalOrder.createMany).not.toHaveBeenCalled();
  });

  it('pancake.order_source_map hỏng: dùng mặc định chứ không ném', async () => {
    const t = setup(fixture('synthetic-shopee.json'), { config: { [ORDER_SOURCE_MAP_KEY]: 'rác' } });
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'PROCESSED' });
    expect((t.externalOrder.createMany.mock.calls[0]![0] as { data: { channel: string }[] }).data[0]!.channel).toBe('shopee');
  });

  it('pancake.order_source_map đổi: nguồn chat lưu thành CHAT, nguồn lạ thành UNKNOWN', async () => {
    const chat = fixture('synthetic-chat.json');
    const map = { marketplaceIds: {}, chatSources: ['-1|fanpage_mau|'] };
    const t = setup(chat, { config: { [ORDER_SOURCE_MAP_KEY]: map } });
    await t.run();
    expect((t.externalOrder.createMany.mock.calls[0]![0] as { data: { source: string }[] }).data[0]!.source).toBe('CHAT');
    const u = setup(chat);
    await u.run();
    expect((u.externalOrder.createMany.mock.calls[0]![0] as { data: { source: string }[] }).data[0]!.source).toBe('UNKNOWN');
  });

  it('lỗi ghi DB ném tiếp để BullMQ retry và sự kiện thành FAILED', async () => {
    const t = setup(fixture('synthetic-shopee.json'));
    t.externalOrder.createMany.mockRejectedValue(new Error('db down'));
    await expect(t.run()).rejects.toThrow('db down');
    expect(t.finalStatus()).toMatchObject({ status: 'FAILED', error: 'db down' });
  });

  it('sự kiện không phải nguyên object đơn (huỷ, vận chuyển) không nạp: UNMATCHED như cũ', async () => {
    const t = setup(fixture('synthetic-shopee.json'), {}, 'order.shipping_updated');
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'UNMATCHED' });
    expect(t.externalOrder.createMany).not.toHaveBeenCalled();
  });

  it('payload không có id thì không lưu', async () => {
    const t = setup({ status: 3, marketplace_id: -3 });
    await t.run();
    expect(t.finalStatus()).toMatchObject({ status: 'UNMATCHED' });
    expect(t.externalOrder.createMany).not.toHaveBeenCalled();
  });
});
