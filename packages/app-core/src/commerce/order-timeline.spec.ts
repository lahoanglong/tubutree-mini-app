import { describe, expect, it } from 'vitest';
import { SHOP_COPY } from '../shop-copy';
import { buildOrderJourney, buildOrderTimelineSteps, formatOrderShareSummary, orderNoticeStep, orderNotices, orderTimelineStamps, trackingStale } from './order-timeline';

const T = {
  createdAt: '2026-11-05T01:00:00.000Z',
  confirmedAt: '2026-11-05T02:00:00.000Z',
  shippingAt: '2026-11-06T03:00:00.000Z',
  deliveredAt: '2026-11-07T04:00:00.000Z',
  cancelledAt: '2026-11-05T05:00:00.000Z',
};

const keys = (steps: ReturnType<typeof buildOrderTimelineSteps>) => steps.map((s) => s.key);
const states = (steps: ReturnType<typeof buildOrderTimelineSteps>) => steps.map((s) => s.state);

describe('buildOrderTimelineSteps', () => {
  it('đơn chờ thanh toán: bước đầu đang diễn ra, ba bước sau chưa tới', () => {
    const steps = buildOrderTimelineSteps('PENDING_PAYMENT', { createdAt: T.createdAt });
    expect(keys(steps)).toEqual(['received', 'preparing', 'shipping', 'delivered']);
    expect(states(steps)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(steps[0]!.at).toBe(T.createdAt);
  });

  it.each(['CONFIRMED', 'PACKED'])('%s: Đang chuẩn bị là bước hiện tại, Đã tiếp nhận đã xong', (status) => {
    const steps = buildOrderTimelineSteps(status, T);
    expect(states(steps)).toEqual(['completed', 'current', 'upcoming', 'upcoming']);
    expect(steps[1]!.at).toBe(T.confirmedAt);
  });

  it('SHIPPING: Đang giao hàng là bước hiện tại, bước chưa tới không mượn giờ của mốc sau', () => {
    const steps = buildOrderTimelineSteps('SHIPPING', T);
    expect(states(steps)).toEqual(['completed', 'completed', 'current', 'upcoming']);
    expect(steps[2]!.at).toBe(T.shippingAt);
    expect(steps[3]!.at).toBeNull();
  });

  it('DELIVERED: cả bốn bước đã xong, bước cuối có giờ giao', () => {
    const steps = buildOrderTimelineSteps('DELIVERED', T);
    expect(states(steps)).toEqual(['completed', 'completed', 'completed', 'completed']);
    expect(steps[3]!.at).toBe(T.deliveredAt);
  });

  it('thiếu mốc giờ thì at là null, không đoán', () => {
    const steps = buildOrderTimelineSteps('SHIPPING');
    expect(steps.map((s) => s.at)).toEqual([null, null, null, null]);
  });

  it('bước chưa tới không mang giờ dù mốc có sẵn', () => {
    const steps = buildOrderTimelineSteps('CONFIRMED', T);
    expect(steps[2]!.at).toBeNull();
    expect(steps[3]!.at).toBeNull();
  });

  it('CANCELLED trước khi chuẩn bị: chỉ Đã tiếp nhận rồi nhánh Đã huỷ', () => {
    const steps = buildOrderTimelineSteps('CANCELLED', { createdAt: T.createdAt, cancelledAt: T.cancelledAt });
    expect(keys(steps)).toEqual(['received', 'cancelled']);
    expect(states(steps)).toEqual(['completed', 'cancelled']);
    expect(steps[1]!.at).toBe(T.cancelledAt);
  });

  it('CANCELLED sau khi kho xác nhận: giữ bước Đang chuẩn bị đã qua', () => {
    const steps = buildOrderTimelineSteps('CANCELLED', { createdAt: T.createdAt, confirmedAt: T.confirmedAt, cancelledAt: T.cancelledAt });
    expect(keys(steps)).toEqual(['received', 'preparing', 'cancelled']);
    expect(states(steps)).toEqual(['completed', 'completed', 'cancelled']);
  });

  it('CANCELLED sau khi giao hãng mà thiếu mốc Đã xác nhận (đơn COD): vẫn hiện Đang chuẩn bị ở giữa, không mang giờ', () => {
    const steps = buildOrderTimelineSteps('CANCELLED', { createdAt: T.createdAt, shippingAt: T.shippingAt, cancelledAt: T.cancelledAt });
    expect(keys(steps)).toEqual(['received', 'preparing', 'shipping', 'cancelled']);
    expect(states(steps)).toEqual(['completed', 'completed', 'completed', 'cancelled']);
    expect(steps[1]!.at).toBeNull();
    expect(steps[2]!.at).toBe(T.shippingAt);
  });

  it('CANCELLED không bao giờ hiện bước Hoàn tất, kể cả khi có giờ giao', () => {
    const steps = buildOrderTimelineSteps('CANCELLED', T);
    expect(keys(steps)).not.toContain('delivered');
    expect(keys(steps)[keys(steps).length - 1]).toBe('cancelled');
  });

  it('RETURNED: bốn bước đã xong rồi nhánh Đã hoàn trả', () => {
    const steps = buildOrderTimelineSteps('RETURNED', { ...T, cancelledAt: '2026-11-09T01:00:00.000Z' });
    expect(keys(steps)).toEqual(['received', 'preparing', 'shipping', 'delivered', 'returned']);
    expect(states(steps)).toEqual(['completed', 'completed', 'completed', 'completed', 'cancelled']);
    expect(steps[4]!.at).toBe('2026-11-09T01:00:00.000Z');
  });

  it('trạng thái lạ: vẫn trả bốn bước, bước đầu hiện tại', () => {
    const steps = buildOrderTimelineSteps('WHATEVER', T);
    expect(keys(steps)).toEqual(['received', 'preparing', 'shipping', 'delivered']);
    expect(states(steps)).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('nhãn lấy từ shop-copy, đúng chữ đề bài', () => {
    expect(buildOrderTimelineSteps('PENDING_PAYMENT').map((s) => s.label)).toEqual(['Đã tiếp nhận', 'Đang chuẩn bị', 'Đang giao hàng', 'Hoàn tất']);
    expect(buildOrderTimelineSteps('CANCELLED')[1]!.label).toBe('Đã huỷ');
    expect(buildOrderTimelineSteps('RETURNED')[4]!.label).toBe('Đã hoàn trả');
  });

  it('mọi nhãn bước có khoá trong SHOP_COPY', () => {
    for (const k of ['received', 'preparing', 'shipping', 'delivered', 'cancelled', 'returned']) {
      expect(SHOP_COPY[`order.timeline.${k}`], k).toBeTruthy();
    }
  });
});

describe('orderTimelineStamps', () => {
  it('ghép mốc từ statusTimes của API; giờ giao ưu tiên deliveredAt', () => {
    expect(
      orderTimelineStamps({
        createdAt: T.createdAt,
        deliveredAt: T.deliveredAt,
        statusTimes: { CONFIRMED: T.confirmedAt, SHIPPING: T.shippingAt, DELIVERED: '2026-11-08T00:00:00.000Z', CANCELLED: T.cancelledAt },
      }),
    ).toEqual({ createdAt: T.createdAt, confirmedAt: T.confirmedAt, shippingAt: T.shippingAt, deliveredAt: T.deliveredAt, cancelledAt: T.cancelledAt });
  });

  it('thiếu deliveredAt thì lấy lần lật DELIVERED trong sổ; đơn hoàn lấy giờ RETURNED làm mốc cuối', () => {
    const s = orderTimelineStamps({ createdAt: T.createdAt, statusTimes: { DELIVERED: T.deliveredAt, RETURNED: '2026-11-09T01:00:00.000Z' } });
    expect(s.deliveredAt).toBe(T.deliveredAt);
    expect(s.cancelledAt).toBe('2026-11-09T01:00:00.000Z');
  });

  it('không có statusTimes thì chỉ còn giờ đặt', () => {
    expect(orderTimelineStamps({ createdAt: T.createdAt })).toEqual({ createdAt: T.createdAt });
  });

  it('đơn COD/ví đang đi tiếp mà sổ không có dòng Đã xác nhận: bước chuẩn bị lấy giờ đặt', () => {
    for (const paymentMethod of ['COD', 'WALLET']) {
      expect(orderTimelineStamps({ createdAt: T.createdAt, status: 'CONFIRMED', paymentMethod, statusTimes: {} }).confirmedAt, paymentMethod).toBe(T.createdAt);
    }
  });

  it('đơn COD đã đóng gói: giờ chuẩn bị là giờ Đã đóng gói của sổ, không phải giờ đặt', () => {
    const packed = '2026-11-05T03:30:00.000Z';
    expect(orderTimelineStamps({ createdAt: T.createdAt, status: 'PACKED', paymentMethod: 'COD', statusTimes: { PACKED: packed } }).confirmedAt).toBe(packed);
  });

  it('đơn chuyển khoản không có dòng Đã xác nhận: không đoán giờ chuẩn bị', () => {
    const s = orderTimelineStamps({ createdAt: T.createdAt, status: 'SHIPPING', paymentMethod: 'BANK_TRANSFER', statusTimes: { SHIPPING: T.shippingAt } });
    expect(s.confirmedAt).toBeUndefined();
  });

  it('đơn COD huỷ: không đoán giờ chuẩn bị từ giờ đặt, nên huỷ khi chưa đóng gói chỉ còn Đã tiếp nhận rồi Đã huỷ', () => {
    const stamps = orderTimelineStamps({ createdAt: T.createdAt, status: 'CANCELLED', paymentMethod: 'COD', statusTimes: { CANCELLED: T.cancelledAt } });
    expect(stamps.confirmedAt).toBeUndefined();
    expect(keys(buildOrderTimelineSteps('CANCELLED', stamps))).toEqual(['received', 'cancelled']);
  });

  it('đơn COD huỷ sau khi đóng gói: giữ Đang chuẩn bị', () => {
    const stamps = orderTimelineStamps({ createdAt: T.createdAt, status: 'CANCELLED', paymentMethod: 'COD', statusTimes: { PACKED: T.confirmedAt, CANCELLED: T.cancelledAt } });
    expect(keys(buildOrderTimelineSteps('CANCELLED', stamps))).toEqual(['received', 'preparing', 'cancelled']);
  });
});

describe('formatOrderShareSummary', () => {
  const order = {
    code: 'TUBU20261105001',
    items: [
      { name: 'Sữa tắm thảo mộc', quantity: 2 },
      { name: 'Xà phòng cỏ cây', quantity: 1 },
    ],
    totalAmount: 1234500,
    trackingUrl: 'https://tubutree.com/tai-khoan/don-hang/TUBU20261105001',
  };

  it('có mã đơn, từng món kèm số lượng, tổng tiền và link theo dõi', () => {
    expect(formatOrderShareSummary(order)).toBe(
      ['Đơn hàng Tubu Tree TUBU20261105001', 'Sữa tắm thảo mộc × 2', 'Xà phòng cỏ cây × 1', 'Tổng tiền: 1.234.500đ', 'Theo dõi đơn: https://tubutree.com/tai-khoan/don-hang/TUBU20261105001'].join('\n'),
    );
  });

  it('không có link theo dõi thì bỏ dòng đó', () => {
    const text = formatOrderShareSummary({ ...order, trackingUrl: undefined });
    expect(text).not.toContain('Theo dõi đơn');
    expect(text.split('\n')).toHaveLength(4);
  });

  it('không dùng dấu chấm than và không còn khoảng trắng thừa', () => {
    const text = formatOrderShareSummary({ ...order, items: [{ name: '  Nước rửa   chén!  ', quantity: 3 }] });
    expect(text).not.toContain('!');
    expect(text).toContain('Nước rửa chén × 3');
  });

  it('đơn nhiều món: giữ tám dòng đầu rồi ghi số món còn lại', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ name: `Món ${i + 1}`, quantity: 1 }));
    const lines = formatOrderShareSummary({ ...order, items, trackingUrl: undefined }).split('\n');
    expect(lines).toContain('Món 8 × 1');
    expect(lines).not.toContain('Món 9 × 1');
    expect(lines).toContain('và 3 sản phẩm khác');
  });

  it('đơn không có món vẫn ra mã đơn và tổng tiền', () => {
    expect(formatOrderShareSummary({ code: 'X1', items: [], totalAmount: 0 })).toBe('Đơn hàng Tubu Tree X1\nTổng tiền: 0đ');
  });

  it('bỏ dòng món có số lượng không hợp lệ hoặc tên trống', () => {
    const text = formatOrderShareSummary({ ...order, items: [{ name: '', quantity: 1 }, { name: 'Hợp lệ', quantity: 0 }, { name: 'Tốt', quantity: 2 }], trackingUrl: undefined });
    expect(text).toBe('Đơn hàng Tubu Tree TUBU20261105001\nTốt × 2\nTổng tiền: 1.234.500đ');
  });
});

describe('dòng thời gian một khối (buildOrderJourney)', () => {
  const NOW = Date.parse('2026-11-08T05:00:00.000Z');
  const shippingOrder = {
    status: 'SHIPPING',
    createdAt: T.createdAt,
    paymentMethod: 'COD',
    statusTimes: { CONFIRMED: T.confirmedAt, SHIPPING: T.shippingAt },
    shippingHistory: [
      { at: '2026-11-06T04:00:00.000Z', status: 'picked' },
      { at: '2026-11-07T01:00:00.000Z', status: 'delivering' },
      { at: '2026-11-06T09:00:00.000Z', status: 'transporting' },
    ],
  };

  it('ánh xạ sự kiện đơn của MSS sang đúng bước, sự kiện lạ không có bước', () => {
    expect(orderNoticeStep('order.created')).toBe('received');
    expect(orderNoticeStep('order.payment_confirmed')).toBe('preparing');
    expect(orderNoticeStep('order.shipping')).toBe('shipping');
    expect(orderNoticeStep('order.delivered')).toBe('delivered');
    expect(orderNoticeStep('order.cancelled')).toBe('cancelled');
    expect(orderNoticeStep('order.refunded')).toBeNull();
    expect(orderNoticeStep('toString')).toBeNull();
    expect(orderNoticeStep(undefined)).toBeNull();
  });

  it('bốn bước như thanh tiến trình; mốc hãng chỉ nằm dưới Đang giao hàng, mới nhất trên cùng', () => {
    const j = buildOrderJourney(shippingOrder, { now: NOW });
    expect(j.steps.map((s) => s.key)).toEqual(['received', 'preparing', 'shipping', 'delivered']);
    expect(j.steps.map((s) => s.state)).toEqual(['completed', 'completed', 'current', 'upcoming']);
    expect(j.steps[2]!.events.map((e) => e.at)).toEqual(['2026-11-07T01:00:00.000Z', '2026-11-06T09:00:00.000Z', '2026-11-06T04:00:00.000Z']);
    expect(j.steps.filter((s) => s.events.length > 0)).toHaveLength(1);
    expect(j.hasCarrierEvents).toBe(true);
  });

  it('ngày dự kiến chỉ ở bước đang diễn ra', () => {
    const j = buildOrderJourney(shippingOrder, { now: NOW, etaLabel: '09/11 – 10/11' });
    expect(j.steps.map((s) => s.eta)).toEqual([null, null, 'Dự kiến giao 09/11 – 10/11', null]);
  });

  it('dòng kênh: Zalo khi MSS gửi xong, ZNS khi đường lui; chỉ dưới bước đã tới; giờ Việt Nam', () => {
    const j = buildOrderJourney(
      {
        ...shippingOrder,
        notices: [
          { event: 'order.created', channel: 'ZALO', at: '2026-11-05T07:02:00.000Z' },
          { event: 'order.shipping', channel: 'ZNS', at: '2026-11-06T03:05:00.000Z' },
          { event: 'order.delivered', channel: 'ZALO', at: '2026-11-07T03:05:00.000Z' },
        ],
      },
      { now: NOW },
    );
    expect(j.steps.map((s) => s.notice)).toEqual(['Đã báo qua Zalo · 14:02 05/11', null, 'Đã báo qua ZNS · 10:05 06/11', null]);
  });

  it('notices từ API: bỏ dòng có kênh lạ, giờ hỏng, sự kiện không có bước hay trường nội bộ thay kênh; API cũ không trả thì không có dòng', () => {
    expect(
      orderNotices([
        { event: 'order.created', channel: 'IN_APP_ONLY', at: T.createdAt },
        { event: 'order.created', channel: 'ZALO', at: 'không phải giờ' },
        { event: 'order.lost', channel: 'ZALO', at: T.createdAt },
        { event: 'order.created', status: 'RESULT_FAILED', at: T.createdAt },
        null,
        { event: 'order.created', channel: 'ZALO', at: T.createdAt },
      ]),
    ).toEqual([{ event: 'order.created', channel: 'ZALO', at: T.createdAt }]);
    expect(orderNotices(undefined)).toEqual([]);
    expect(buildOrderJourney({ status: 'CONFIRMED', createdAt: T.createdAt }, { now: NOW }).steps.every((s) => s.notice === null)).toBe(true);
  });

  it('đứng yên: đang giao quá số giờ cấu hình mà không có mốc mới thì báo chờ hãng, không tự chuyển bước', () => {
    const lastScan = Date.parse('2026-11-07T01:00:00.000Z');
    const fresh = buildOrderJourney({ ...shippingOrder, trackingStaleHours: 72 }, { now: lastScan + 71 * 3_600_000 });
    expect(fresh.steps[2]!.stale).toBe(false);
    const stale = buildOrderJourney({ ...shippingOrder, trackingStaleHours: 72 }, { now: lastScan + 73 * 3_600_000 });
    expect(stale.steps.map((s) => s.stale)).toEqual([false, false, true, false]);
    expect(stale.steps.map((s) => s.state)).toEqual(['completed', 'completed', 'current', 'upcoming']);
  });

  it('đứng yên tính từ giờ chuyển Đang giao khi hãng chưa có mốc; thiếu số giờ hoặc không có mốc nào thì không kết luận', () => {
    const noScan = { status: 'SHIPPING', statusTimes: { SHIPPING: T.shippingAt } };
    expect(trackingStale(noScan, [], 72, Date.parse(T.shippingAt) + 73 * 3_600_000)).toBe(true);
    expect(trackingStale(noScan, [], undefined, Date.parse(T.shippingAt) + 999 * 3_600_000)).toBe(false);
    expect(trackingStale(noScan, [], 0, Date.parse(T.shippingAt) + 999 * 3_600_000)).toBe(false);
    expect(trackingStale({ status: 'SHIPPING' }, [], 72, NOW)).toBe(false);
    expect(trackingStale({ ...noScan, status: 'DELIVERED' }, [], 72, Date.parse(T.shippingAt) + 999 * 3_600_000)).toBe(false);
  });

  it('đơn huỷ trước khi giao: rẽ nhánh như thanh 4 bước, dòng kênh của sự kiện huỷ nằm dưới bước Đã huỷ, mốc hãng (nếu có) cũng ở đó', () => {
    const j = buildOrderJourney(
      {
        status: 'CANCELLED',
        createdAt: T.createdAt,
        paymentMethod: 'BANK_TRANSFER',
        statusTimes: { CANCELLED: T.cancelledAt },
        shippingHistory: [{ at: T.cancelledAt, status: 'cancel' }],
        notices: [{ event: 'order.cancelled', channel: 'ZALO', at: T.cancelledAt }],
      },
      { now: NOW, etaLabel: '09/11' },
    );
    expect(j.steps.map((s) => s.key)).toEqual(['received', 'cancelled']);
    expect(j.steps[1]!.notice).toBe('Đã báo qua Zalo · 12:00 05/11');
    expect(j.steps[1]!.events).toHaveLength(1);
    expect(j.steps.every((s) => s.eta === null)).toBe(true);
  });

  it('đơn đã giao và đơn hoàn trả: mốc hãng vẫn dưới Đang giao hàng, nhánh Đã hoàn trả giữ như lõi', () => {
    const delivered = buildOrderJourney({ ...shippingOrder, status: 'DELIVERED', deliveredAt: T.deliveredAt }, { now: NOW });
    expect(delivered.steps.map((s) => s.state)).toEqual(['completed', 'completed', 'completed', 'completed']);
    expect(delivered.steps[2]!.events).toHaveLength(3);
    const returned = buildOrderJourney({ ...shippingOrder, status: 'RETURNED', statusTimes: { ...shippingOrder.statusTimes, RETURNED: T.deliveredAt } }, { now: NOW });
    expect(returned.steps.map((s) => s.key)).toEqual(['received', 'preparing', 'shipping', 'delivered', 'returned']);
    expect(returned.steps[2]!.events).toHaveLength(3);
  });

  it('hãng quét trước khi đơn chuyển Đang giao: mốc nằm dưới bước đang diễn ra', () => {
    const j = buildOrderJourney({ status: 'PACKED', createdAt: T.createdAt, paymentMethod: 'COD', shippingHistory: [{ at: T.confirmedAt, status: 'picking' }] }, { now: NOW });
    expect(j.steps[1]!.state).toBe('current');
    expect(j.steps[1]!.events).toHaveLength(1);
    expect(j.steps[2]!.events).toHaveLength(0);
  });

  it('hai tin cùng một bước: giữ tin mới nhất', () => {
    const j = buildOrderJourney(
      {
        ...shippingOrder,
        notices: [
          { event: 'order.shipping', channel: 'ZNS', at: '2026-11-06T03:05:00.000Z' },
          { event: 'order.shipping', channel: 'ZALO', at: '2026-11-06T04:10:00.000Z' },
        ],
      },
      { now: NOW },
    );
    expect(j.steps[2]!.notice).toBe('Đã báo qua Zalo · 11:10 06/11');
  });
});
