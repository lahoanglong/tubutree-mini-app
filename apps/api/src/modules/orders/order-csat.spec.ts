import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderCsatDto } from './dto/orders.dto';
import { ORDER_CSAT_ASK_DAYS, ORDER_CSAT_EVENT, orderCsatAsk, orderCsatEventId, recordOrderCsat } from './order-csat';

const NOW = new Date('2026-11-24T07:00:00Z');
const DAY = 864e5;
const delivered = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  status: 'DELIVERED',
  type: 'RETAIL',
  placedForCustomer: false,
  deliveredAt: new Date(NOW.getTime() - 3 * DAY),
  updatedAt: new Date(NOW.getTime() - 3 * DAY),
  ...over,
});

function askDb(answered: unknown = null, returnRequest: unknown = null) {
  return {
    analyticsEvent: { findUnique: jest.fn().mockResolvedValue(answered) },
    returnRequest: { findFirst: jest.fn().mockResolvedValue(returnRequest) },
  };
}

describe('orderCsatAsk (thẻ "Đơn này thế nào?" ở chi tiết đơn)', () => {
  it('đơn lẻ đã giao trong hạn, chưa trả lời, chưa có yêu cầu trả → hỏi; tra đúng dòng của đơn theo eventId cố định', async () => {
    const db = askDb();
    await expect(orderCsatAsk(db as never, delivered(), NOW)).resolves.toBe(true);
    expect(db.analyticsEvent.findUnique).toHaveBeenCalledWith({ where: { eventId: 'order_csat:o1' }, select: { id: true } });
    expect(db.returnRequest.findFirst).toHaveBeenCalledWith({ where: { orderId: 'o1' }, select: { id: true } });
  });

  it('đã trả lời → không hỏi lại', async () => {
    await expect(orderCsatAsk(askDb({ id: 'e1' }) as never, delivered(), NOW)).resolves.toBe(false);
  });

  it('đã có yêu cầu trả (mọi trạng thái) → không hỏi: khách đã báo vấn đề qua đổi/trả', async () => {
    await expect(orderCsatAsk(askDb(null, { id: 'rr1' }) as never, delivered(), NOW)).resolves.toBe(false);
  });

  it.each([
    ['chưa giao', { status: 'SHIPPING' }],
    ['đã trả cả đơn', { status: 'RETURNED' }],
    ['đơn CTV đặt hộ khách', { placedForCustomer: true }],
    ['đơn đại lý', { type: 'DEALER' }],
    ['giao quá hạn hỏi', { deliveredAt: new Date(NOW.getTime() - (ORDER_CSAT_ASK_DAYS * DAY + 1)) }],
    ['đơn cũ thiếu mốc giao, cập nhật lần cuối quá hạn', { deliveredAt: null, updatedAt: new Date(NOW.getTime() - 40 * DAY) }],
  ])('%s → không hỏi, không truy vấn', async (_n, over) => {
    const db = askDb();
    await expect(orderCsatAsk(db as never, delivered(over), NOW)).resolves.toBe(false);
    expect(db.analyticsEvent.findUnique).not.toHaveBeenCalled();
    expect(db.returnRequest.findFirst).not.toHaveBeenCalled();
  });

  it('đúng mốc ORDER_CSAT_ASK_DAYS ngày vẫn hỏi (so sánh chặt)', async () => {
    const at = delivered({ deliveredAt: new Date(NOW.getTime() - ORDER_CSAT_ASK_DAYS * DAY) });
    await expect(orderCsatAsk(askDb() as never, at, NOW)).resolves.toBe(true);
  });
});

describe('recordOrderCsat (POST /orders/:code/csat)', () => {
  function recordDb(order: Record<string, unknown> | null, inserted = 1) {
    return {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      analyticsEvent: { createMany: jest.fn().mockResolvedValue({ count: inserted }) },
    };
  }
  const own = { id: 'o1', userId: 'u1', code: 'TUBU1', status: 'DELIVERED', type: 'RETAIL', placedForCustomer: false };

  it('ghi một dòng analytics_events với eventId cố định theo đơn, bỏ qua nếu trùng (giữ câu trả lời đầu)', async () => {
    const db = recordDb(own);
    await expect(recordOrderCsat(db as never, 'u1', 'TUBU1', { answer: 'down', platform: 'miniapp' })).resolves.toEqual({ recorded: true });
    expect(db.analyticsEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          eventId: orderCsatEventId('o1'),
          eventName: ORDER_CSAT_EVENT,
          userId: 'u1',
          platform: 'miniapp',
          props: { orderCode: 'TUBU1', answer: 'down' },
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('đơn đã có câu trả lời (chạm đúp, thiết bị khác) → recorded false, không lỗi', async () => {
    await expect(recordOrderCsat(recordDb(own, 0) as never, 'u1', 'TUBU1', { answer: 'up', platform: 'web' })).resolves.toEqual({ recorded: false });
  });

  it('đơn của người khác hay không tồn tại → 404, không ghi gì', async () => {
    for (const order of [null, { ...own, userId: 'u2' }]) {
      const db = recordDb(order);
      await expect(recordOrderCsat(db as never, 'u1', 'TUBU1', { answer: 'up', platform: 'web' })).rejects.toBeInstanceOf(NotFoundException);
      expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['chưa giao', { status: 'SHIPPING' }],
    ['đơn CTV đặt hộ', { placedForCustomer: true }],
    ['đơn đại lý', { type: 'DEALER' }],
  ])('%s → 409, không ghi gì', async (_n, over) => {
    const db = recordDb({ ...own, ...over });
    await expect(recordOrderCsat(db as never, 'u1', 'TUBU1', { answer: 'up', platform: 'web' })).rejects.toBeInstanceOf(ConflictException);
    expect(db.analyticsEvent.createMany).not.toHaveBeenCalled();
  });
});

describe('OrderCsatDto', () => {
  const errorsOf = async (body: unknown) => (await validate(plainToInstance(OrderCsatDto, body), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

  it('nhận up/down từ miniapp/web', async () => {
    expect(await errorsOf({ answer: 'up', platform: 'miniapp' })).toEqual([]);
    expect(await errorsOf({ answer: 'down', platform: 'web' })).toEqual([]);
  });

  it('từ chối câu trả lời lạ, nền tảng lạ (admin, pos...) và khoá thừa', async () => {
    expect(await errorsOf({ answer: 'meh', platform: 'web' })).toEqual(['answer']);
    expect(await errorsOf({ answer: 'up', platform: 'admin' })).toEqual(['platform']);
    expect(await errorsOf({ answer: 'up', platform: 'web', comment: 'x' })).toEqual(['comment']);
  });
});
