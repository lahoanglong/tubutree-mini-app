import { describe, expect, it } from 'vitest';
import { SHOP_COPY } from '../shop-copy';
import { buildOrderTimelineSteps, formatOrderShareSummary, orderTimelineStamps } from './order-timeline';

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
