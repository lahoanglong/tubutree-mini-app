import { describe, expect, it } from 'vitest';
import {
  canCancelOrder,
  canPayOrder,
  orderActionLabel,
  orderActionPlan,
  orderHeadline,
  orderStage,
  orderTrack,
  pendingReviewItem,
  returnWindowOpen,
  shippingEvents,
  shortDateTime,
  type OrderStage,
  type TrackOrder,
} from './order-tracking';

const NOW = Date.parse('2026-11-05T05:00:00Z');
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function order(over: Partial<TrackOrder> = {}): TrackOrder {
  return {
    status: 'CONFIRMED',
    createdAt: iso(-5 * HOUR),
    updatedAt: iso(-HOUR),
    paymentMethod: 'COD',
    paymentStatus: 'UNPAID',
    items: [{ id: 'l1', productSlug: 'sua-tubu', productPublic: true, reviewable: true }],
    ...over,
  };
}

interface Row {
  name: string;
  order: TrackOrder;
  stage: OrderStage;
  sentence: string;
  primary: string | null;
  more: string[];
  ctx?: Parameters<typeof orderActionPlan>[1];
}

const ROWS: Row[] = [
  {
    name: 'chờ chuyển khoản còn hạn',
    order: order({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: iso(2 * HOUR) }),
    stage: 'PAY_WAIT',
    sentence: 'Đơn đang chờ bạn thanh toán.',
    primary: 'pay',
    more: ['cancel', 'contact'],
  },
  {
    name: 'chờ chuyển khoản, Tubu xử lý tay',
    order: order({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: iso(2 * HOUR), manualHandling: true }),
    stage: 'PAY_MANUAL',
    sentence: 'Tubu đang xử lý đơn này, liên hệ CSKH nếu cần hỗ trợ.',
    primary: 'contact',
    more: [],
  },
  {
    name: 'chờ chuyển khoản đã quá hạn',
    order: order({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: iso(-HOUR) }),
    stage: 'PAY_OVERDUE',
    sentence: 'Đơn đã quá hạn thanh toán và sắp tự huỷ.',
    primary: 'contact',
    more: ['cancel'],
  },
  {
    name: 'đã xác nhận, huỷ được',
    order: order({ status: 'CONFIRMED', canCancel: true }),
    stage: 'CONFIRMED',
    sentence: 'Tubu đã nhận đơn và đang chuẩn bị hàng.',
    primary: 'cancel',
    more: ['contact'],
  },
  {
    name: 'đóng gói, huỷ được',
    order: order({ status: 'PACKED', canCancel: true }),
    stage: 'PACKED',
    sentence: 'Hàng đã đóng gói, chờ giao cho đơn vị vận chuyển.',
    primary: 'cancel',
    more: ['contact'],
  },
  {
    name: 'đóng gói nhưng API báo không huỷ được',
    order: order({ status: 'PACKED', canCancel: false }),
    stage: 'PACKED',
    sentence: 'Hàng đã đóng gói, chờ giao cho đơn vị vận chuyển.',
    primary: 'contact',
    more: [],
  },
  {
    name: 'hãng đã nhận hàng nhưng đơn chưa chuyển Đang giao',
    order: order({ status: 'PACKED', shippingCode: 'GHN123', canCancel: false }),
    stage: 'CARRIER_BOOKED',
    sentence: 'Tubu đã đặt đơn vị vận chuyển, hàng sắp được lấy.',
    primary: 'contact',
    more: [],
  },
  {
    name: 'đang giao',
    order: order({ status: 'SHIPPING', shippingCode: 'GHN123' }),
    stage: 'SHIPPING',
    sentence: 'Đơn đang trên đường giao đến bạn.',
    primary: 'contact',
    more: [],
  },
  {
    name: 'đã giao, còn dòng chưa đánh giá, trong hạn đổi/trả',
    order: order({ status: 'DELIVERED', deliveredAt: iso(-24 * HOUR) }),
    stage: 'DELIVERED',
    sentence: 'Đơn đã giao thành công.',
    primary: 'review',
    more: ['reorder', 'return', 'contact'],
  },
  {
    name: 'đã giao, đã đánh giá hết, trong hạn',
    order: order({ status: 'DELIVERED', deliveredAt: iso(-24 * HOUR), items: [{ id: 'l1', productSlug: 'a', reviewId: 'r1' }] }),
    stage: 'DELIVERED',
    sentence: 'Đơn đã giao thành công.',
    primary: 'reorder',
    more: ['return', 'contact'],
  },
  {
    name: 'đã giao quá hạn đổi/trả',
    order: order({ status: 'DELIVERED', deliveredAt: iso(-10 * 24 * HOUR), items: [{ id: 'l1', productSlug: 'a', reviewId: 'r1' }] }),
    stage: 'DELIVERED',
    sentence: 'Đơn đã giao thành công.',
    primary: 'reorder',
    more: ['contact'],
  },
  {
    name: 'đã giao, đã có yêu cầu đổi/trả chờ duyệt',
    order: order({ status: 'DELIVERED', deliveredAt: iso(-24 * HOUR), items: [{ id: 'l1', productSlug: 'a', reviewId: 'r1' }] }),
    stage: 'DELIVERED',
    sentence: 'Đơn đã giao thành công.',
    primary: 'reorder',
    more: ['contact'],
    ctx: { pendingReturn: true },
  },
  {
    name: 'đã giao, không còn dòng nào trả được',
    order: order({ status: 'DELIVERED', deliveredAt: iso(-24 * HOUR), items: [{ id: 'l1', productSlug: 'a', reviewId: 'r1' }] }),
    stage: 'DELIVERED',
    sentence: 'Đơn đã giao thành công.',
    primary: 'reorder',
    more: ['contact'],
    ctx: { returnableLeft: false },
  },
  {
    name: 'đã huỷ',
    order: order({ status: 'CANCELLED' }),
    stage: 'CANCELLED',
    sentence: 'Đơn đã huỷ.',
    primary: 'reorder',
    more: ['contact'],
  },
  {
    name: 'trạng thái lạ vẫn có đường liên hệ',
    order: order({ status: 'WEIRD' }),
    stage: 'OTHER',
    sentence: '',
    primary: 'contact',
    more: [],
  },
  {
    name: 'đã hoàn',
    order: order({ status: 'RETURNED', paymentStatus: 'PAID' }),
    stage: 'RETURNED',
    sentence: 'Đơn đã hoàn trả.',
    primary: 'reorder',
    more: ['contact'],
  },
];

describe('orderActionPlan và orderHeadline theo trạng thái', () => {
  it.each(ROWS)('$name', (row) => {
    const ctx = { now: NOW, userId: 'u1', ...row.ctx };
    const head = orderHeadline(row.order, ctx);
    const plan = orderActionPlan(row.order, ctx);
    expect(head.stage).toBe(row.stage);
    expect(head.sentence).toBe(row.sentence);
    expect(plan.primary).toBe(row.primary);
    expect(plan.more).toEqual(row.more);
  });

  it('nút chính không bao giờ lặp trong menu và mỗi trạng thái chỉ có một nút chính', () => {
    for (const row of ROWS) {
      const plan = orderActionPlan(row.order, { now: NOW, userId: 'u1', ...row.ctx });
      expect(plan.primary).not.toBeNull();
      expect(plan.more).not.toContain(plan.primary);
      expect(new Set(plan.more).size).toBe(plan.more.length);
    }
  });

  it('nút cấm không bao giờ lọt vào kế hoạch', () => {
    for (const row of ROWS) {
      const plan = orderActionPlan(row.order, { now: NOW, userId: 'u1', ...row.ctx });
      const all = [plan.primary, ...plan.more];
      if (!['PENDING_PAYMENT', 'CONFIRMED', 'PACKED'].includes(row.order.status)) expect(all).not.toContain('cancel');
      if (row.order.status !== 'PENDING_PAYMENT' || row.stage !== 'PAY_WAIT') expect(all).not.toContain('pay');
      if (row.order.status !== 'DELIVERED') {
        expect(all).not.toContain('return');
        expect(all).not.toContain('review');
      }
      if (row.order.canCancel === false) expect(all).not.toContain('cancel');
    }
  });

  it('mốc ngày giao dự kiến chỉ ở các bước trước khi giao, bước tiếp theo của khách nói rõ khi hàng đã giao hãng', () => {
    const o = order({ status: 'PACKED', shippingCode: 'GHN123', canCancel: false });
    const head = orderHeadline(o, { now: NOW, etaLabel: '06/11 – 08/11' });
    expect(head.milestone).toBe('Dự kiến giao 06/11 – 08/11');
    expect(head.next).toBe('Hàng đã giao cho đơn vị vận chuyển nên đơn không huỷ được.');
    expect(orderHeadline(order({ status: 'DELIVERED', deliveredAt: iso(-HOUR) }), { now: NOW, etaLabel: '06/11 – 08/11' }).milestone).not.toContain('Dự kiến giao');
  });

  it('đang giao: bước kế tiếp nói không huỷ được và hạn đổi/trả sau khi nhận', () => {
    const head = orderHeadline(order({ status: 'SHIPPING', shippingCode: 'GHN123' }), { now: NOW, returnDays: 7 });
    expect(head.next).toBe('Hàng đã giao cho đơn vị vận chuyển nên đơn không huỷ được. Khi nhận hàng, bạn có thể đổi/trả trong 7 ngày.');
  });

  it('chờ thanh toán: mốc là hạn trả kèm thời gian còn lại', () => {
    const o = order({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: '2026-11-05T11:30:00Z' });
    expect(orderHeadline(o, { now: NOW, deadlineLeft: '6 giờ 30 phút' }).milestone).toBe('Thanh toán trước 18:30 05/11, còn 6 giờ 30 phút.');
    expect(orderHeadline(o, { now: NOW }).milestone).toBe('Thanh toán trước 18:30 05/11.');
  });

  it('đã giao: mốc là hạn đổi/trả theo ngày giao, hết hạn thì nói hết hạn', () => {
    const open = order({ status: 'DELIVERED', deliveredAt: '2026-11-03T05:00:00Z' });
    expect(orderHeadline(open, { now: NOW, returnDays: 7 }).milestone).toBe('Đổi/trả được đến 10/11.');
    const closed = order({ status: 'DELIVERED', deliveredAt: '2026-10-20T05:00:00Z' });
    expect(orderHeadline(closed, { now: NOW, returnDays: 7 }).milestone).toBe('Đã hết hạn đổi/trả.');
  });

  it('đơn chuyển khoản chưa trả bị huỷ vào hạn thanh toán thì nói tự huỷ vì quá hạn, huỷ khác thì chỉ nói đã huỷ', () => {
    const overdue = order({ status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: iso(-3 * HOUR), statusTimes: { CANCELLED: iso(-3 * HOUR + 60_000) } });
    expect(orderHeadline(overdue, { now: NOW }).sentence).toBe('Đơn tự huỷ vì quá hạn thanh toán.');
    const byUser = order({ status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', paymentDeadline: iso(2 * HOUR), statusTimes: { CANCELLED: iso(-HOUR) } });
    expect(orderHeadline(byUser, { now: NOW }).sentence).toBe('Đơn đã huỷ.');
  });
});

describe('điều kiện từng nút', () => {
  it('canPayOrder: chuyển khoản còn hạn, Tubu không xử lý tay', () => {
    const base = order({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: iso(HOUR) });
    expect(canPayOrder(base, NOW)).toBe(true);
    expect(canPayOrder({ ...base, paymentDeadline: iso(-1) }, NOW)).toBe(false);
    expect(canPayOrder({ ...base, manualHandling: true }, NOW)).toBe(false);
    expect(canPayOrder({ ...base, paymentMethod: 'COD' }, NOW)).toBe(false);
    expect(canPayOrder({ ...base, status: 'CONFIRMED' }, NOW)).toBe(false);
    expect(canPayOrder({ ...base, paymentDeadline: null }, NOW)).toBe(true);
  });

  it('canCancelOrder: API trả cờ thì theo cờ, chỉ ở các trạng thái trước bàn giao', () => {
    expect(canCancelOrder(order({ status: 'CONFIRMED', canCancel: true }))).toBe(true);
    expect(canCancelOrder(order({ status: 'CONFIRMED', canCancel: false }))).toBe(false);
    expect(canCancelOrder(order({ status: 'SHIPPING', canCancel: true }))).toBe(false);
    expect(canCancelOrder(order({ status: 'DELIVERED', canCancel: true }))).toBe(false);
    expect(canCancelOrder(order({ status: 'CANCELLED', canCancel: true }))).toBe(false);
  });

  it('canCancelOrder: API cũ chưa trả cờ thì tự xét như máy chủ', () => {
    expect(canCancelOrder(order({ status: 'PACKED' }))).toBe(true);
    expect(canCancelOrder(order({ status: 'PACKED', type: 'DEALER' }))).toBe(false);
    expect(canCancelOrder(order({ status: 'CONFIRMED', type: 'DEALER' }))).toBe(true);
    expect(canCancelOrder(order({ status: 'CONFIRMED', manualHandling: true }))).toBe(false);
    expect(canCancelOrder(order({ status: 'PACKED', shippingCode: 'GHN123' }))).toBe(false);
    expect(canCancelOrder(order({ status: 'PACKED', shippingCode: 'GOM1', gomdonOrderId: 'GOM1' }))).toBe(true);
    expect(canCancelOrder(order({ status: 'CONFIRMED', hasRecyclingPickup: true, gomdonStatus: '3' }))).toBe(false);
    expect(canCancelOrder(order({ status: 'CONFIRMED', hasRecyclingPickup: true, gomdonStatus: '1' }))).toBe(true);
    expect(
      canCancelOrder(order({ status: 'CONFIRMED', placedForCustomer: true, paymentStatus: 'PAID', referrerUserId: 'u1' }), 'u1'),
    ).toBe(false);
    expect(
      canCancelOrder(order({ status: 'CONFIRMED', placedForCustomer: true, paymentStatus: 'PAID', referrerUserId: 'u1' }), 'u2'),
    ).toBe(true);
  });

  it('returnWindowOpen: tính từ ngày giao, thiếu thì updatedAt, không có mốc nào thì để máy chủ quyết', () => {
    expect(returnWindowOpen(order({ deliveredAt: iso(-6 * 24 * HOUR) }), 7, NOW)).toBe(true);
    expect(returnWindowOpen(order({ deliveredAt: iso(-8 * 24 * HOUR) }), 7, NOW)).toBe(false);
    expect(returnWindowOpen(order({ deliveredAt: null, updatedAt: iso(-8 * 24 * HOUR) }), 7, NOW)).toBe(false);
    expect(returnWindowOpen(order({ deliveredAt: null, updatedAt: null }), 7, NOW)).toBe(true);
  });

  it('pendingReviewItem: bỏ dòng đã đánh giá, không có trang sản phẩm, không được đánh giá', () => {
    const o = order({
      status: 'DELIVERED',
      items: [
        { id: 'a', productSlug: 'a', reviewId: 'r' },
        { id: 'b', productSlug: null },
        { id: 'c', productSlug: 'c', reviewable: false },
        { id: 'd', productSlug: 'd', productPublic: false },
        { id: 'e', productSlug: 'e' },
      ],
    });
    expect(pendingReviewItem(o)?.id).toBe('e');
    expect(pendingReviewItem({ ...o, status: 'SHIPPING' })).toBeNull();
  });

  it('nhãn nút', () => {
    expect(orderActionLabel('pay')).toBe('Thanh toán ngay');
    expect(orderActionLabel('cancel')).toBe('Huỷ đơn');
    expect(orderActionLabel('return')).toBe('Yêu cầu đổi/trả');
    expect(orderActionLabel('return', { returnMore: true })).toBe('Trả thêm sản phẩm');
  });
});

describe('orderStage', () => {
  it('trạng thái lạ rơi vào OTHER, hết hạn đúng lúc hạn tới tính là quá hạn', () => {
    expect(orderStage(order({ status: 'WEIRD' }), NOW)).toBe('OTHER');
    expect(
      orderStage(order({ status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentDeadline: iso(0) }), NOW),
    ).toBe('PAY_OVERDUE');
  });
});

describe('shippingEvents', () => {
  it('mới nhất trên cùng, gộp các mốc liền nhau cùng chữ và giữ giờ lúc bắt đầu', () => {
    const events = shippingEvents([
      { at: '2026-11-04T01:00:00Z', status: 'Đã lấy hàng' },
      { at: '2026-11-04T05:00:00Z', status: 'Đang vận chuyển' },
      { at: '2026-11-04T07:00:00Z', status: 'Đang vận chuyển' },
      { at: '2026-11-04T09:00:00Z', status: 'Đang vận chuyển' },
      { at: '2026-11-05T01:00:00Z', status: 'Đang giao hàng' },
    ]);
    expect(events.map((e) => e.label)).toEqual(['Đang giao hàng', 'Đang vận chuyển', 'Đã lấy hàng']);
    expect(events[1]?.at).toBe('2026-11-04T05:00:00Z');
    expect(events.map((e) => e.latest)).toEqual([true, false, false]);
  });

  it('bỏ phần tử rác và lịch sử trống', () => {
    expect(shippingEvents(null)).toEqual([]);
    expect(shippingEvents([null, undefined, {}])).toEqual([]);
  });
});

describe('orderTrack', () => {
  it('đang giao: các bước trước xong, bước hiện tại là Đang giao và giữ các mốc hãng', () => {
    const track = orderTrack(
      order({
        status: 'SHIPPING',
        paymentMethod: 'BANK_TRANSFER',
        statusTimes: { CONFIRMED: iso(-4 * HOUR), PACKED: iso(-3 * HOUR), SHIPPING: iso(-2 * HOUR) },
        shippingHistory: [
          { at: iso(-2 * HOUR), status: 'Đã lấy hàng' },
          { at: iso(-HOUR), status: 'Đang giao hàng' },
        ],
      }),
      { etaLabel: '06/11 – 08/11' },
    );
    expect(track).not.toBeNull();
    expect(track!.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'upcoming']);
    expect(track!.current).toBe(3);
    const ship = track!.steps[3]!;
    expect(ship.label).toBe('Đang giao');
    expect(ship.events.map((e) => e.label)).toEqual(['Đang giao hàng', 'Đã lấy hàng']);
    expect(track!.steps[4]?.at).toBeNull();
    expect(track!.steps[4]?.eta).toBe('Dự kiến giao 06/11 – 08/11');
    expect(track!.steps[0]?.at).toBe(iso(-5 * HOUR));
  });

  it('COD và Ví Tubu bỏ bước Chờ thanh toán', () => {
    for (const paymentMethod of ['COD', 'WALLET']) {
      const track = orderTrack(order({ status: 'CONFIRMED', paymentMethod }));
      expect(track!.steps.map((s) => s.key)).toEqual(['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED']);
      expect(track!.steps[0]?.state).toBe('current');
    }
  });

  it('đã giao: mọi bước xong, chỉ bước cuối là current, mốc hãng nằm ở bước Đang giao', () => {
    const track = orderTrack(
      order({
        status: 'DELIVERED',
        statusTimes: { CONFIRMED: iso(-9 * HOUR), PACKED: iso(-8 * HOUR), SHIPPING: iso(-7 * HOUR), DELIVERED: iso(-HOUR) },
        shippingHistory: [{ at: iso(-7 * HOUR), status: 'Đã lấy hàng' }],
      }),
    );
    expect(track!.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current']);
    expect(track!.steps[2]?.events).toHaveLength(1);
    expect(track!.steps[3]?.events).toHaveLength(0);
    expect(track!.steps[3]?.eta).toBeNull();
  });

  it('đã huỷ hoặc hoàn không có hành trình', () => {
    expect(orderTrack(order({ status: 'CANCELLED' }))).toBeNull();
    expect(orderTrack(order({ status: 'RETURNED' }))).toBeNull();
  });
});

describe('shortDateTime', () => {
  it('theo giờ Việt Nam bất kể múi giờ máy', () => {
    expect(shortDateTime('2026-11-05T11:30:00Z', NOW)).toBe('18:30 05/11');
    expect(shortDateTime('2026-12-31T17:30:00Z', NOW)).toBe('00:30 01/01/2027');
    expect(shortDateTime('2025-12-31T16:30:00Z', NOW)).toBe('23:30 31/12/2025');
  });
});
