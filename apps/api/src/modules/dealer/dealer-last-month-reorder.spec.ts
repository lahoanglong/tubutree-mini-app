import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DealerService } from './dealer.service';
import { aggregateReorderLines, creditAfterOrder, vnPreviousMonthBounds, type ReorderSourceItem } from './dealer-last-month-reorder';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const item = (id: string, variationId: string | null, quantity: number, extra: Partial<ReorderSourceItem> = {}): ReorderSourceItem => ({
  id,
  variationId,
  quantity,
  isGift: false,
  productName: `SP ${variationId}`,
  variationName: '1L',
  ...extra,
});

describe('vnPreviousMonthBounds', () => {
  it('tháng liền trước theo giờ VN, mốc là 00:00 giờ VN (17:00 UTC hôm trước)', () => {
    const m = vnPreviousMonthBounds(new Date('2026-11-24T05:00:00Z'));
    expect(m.label).toBe('10/2026');
    expect(m.start.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(m.end.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('tháng 1 lùi về tháng 12 năm trước; 23:30 giờ VN ngày 31/12 vẫn là tháng 12 nên tháng trước là 11', () => {
    expect(vnPreviousMonthBounds(new Date('2027-01-05T00:00:00Z')).label).toBe('12/2026');
    expect(vnPreviousMonthBounds(new Date('2026-12-31T16:30:00Z')).label).toBe('11/2026');
    // 00:30 giờ VN ngày 01/01/2027 đã sang tháng 1.
    expect(vnPreviousMonthBounds(new Date('2026-12-31T17:30:00Z')).label).toBe('12/2026');
  });
});

describe('aggregateReorderLines', () => {
  it('bỏ quà 0đ và dòng không có phân loại, cộng hai dòng cùng phân loại theo thứ tự xuất hiện', () => {
    const lines = aggregateReorderLines(
      [
        { items: [item('i1', 'v2', 3), item('i2', 'gift', 1, { isGift: true }), item('i3', null, 5)] },
        { items: [item('i4', 'v1', 2), item('i5', 'v2', 4)] },
      ],
      new Map(),
    );
    expect(lines).toEqual([
      { variationId: 'v2', quantity: 7, name: 'SP v2 – 1L' },
      { variationId: 'v1', quantity: 2, name: 'SP v1 – 1L' },
    ]);
  });

  it('trừ phần đã trả theo từng dòng đơn; trả hết thì bỏ dòng', () => {
    const lines = aggregateReorderLines(
      [{ items: [item('i1', 'v1', 10), item('i2', 'v2', 2)] }, { items: [item('i3', 'v1', 5)] }],
      new Map([
        ['i1', 4],
        ['i2', 2],
      ]),
    );
    expect(lines).toEqual([{ variationId: 'v1', quantity: 11, name: 'SP v1 – 1L' }]);
  });

  it('kẹp số lượng ở 9999 như ô số lượng của bảng giá', () => {
    const lines = aggregateReorderLines([{ items: [item('i1', 'v1', 9000)] }, { items: [item('i2', 'v1', 5000)] }], new Map());
    expect(lines[0]!.quantity).toBe(9999);
  });

  it('tên trống thì ghi "Mặt hàng"', () => {
    const lines = aggregateReorderLines([{ items: [item('i1', 'v1', 1, { productName: ' ', variationName: null })] }], new Map());
    expect(lines[0]!.name).toBe('Mặt hàng');
  });
});

describe('creditAfterOrder', () => {
  it('còn lại trước đơn không âm, sau đơn âm là phần vượt', () => {
    expect(creditAfterOrder(10_000_000, 4_000_000, 5_000_000)).toEqual({ limit: 10_000_000, debt: 4_000_000, available: 6_000_000, after: 1_000_000 });
    expect(creditAfterOrder(10_000_000, 12_000_000, 1_000_000)).toEqual({ limit: 10_000_000, debt: 12_000_000, available: 0, after: -3_000_000 });
  });
});

// ── DealerService ─────────────────────────────────────────────────────────

const NOW = new Date('2026-11-24T05:00:00Z');
const RULES_OFF: Record<string, unknown> = {
  'dealer.min_order_value_vnd': 0,
  'dealer.shipping_fee_below_threshold_vnd': 0,
  'dealer.block_credit_when_overdue': false,
};
const makeConfig = (values: Record<string, unknown> = {}): SystemConfigService => {
  const all = { ...RULES_OFF, ...values };
  return { get: async <T>(key: string, fb?: T): Promise<T> => (key in all ? all[key] : fb) as T } as unknown as SystemConfigService;
};

const GOLD = { id: 'GOLD', name: 'Vàng', discountRules: { default: 0.2 }, creditLimit: 10_000_000, paymentTerms: 'NET 30' };

interface Setup {
  user?: { id: string; role: string; metadata: unknown };
  tier?: typeof GOLD | null;
  orders?: { code: string; items: ReorderSourceItem[] }[];
  returned?: { orderItemId: string; quantity: number }[];
  variations?: { id: string; sku: string; retailPrice: number; dealerPrices: unknown; stock: number }[];
  ledger?: { delta: number; refType: string; refId: string | null; createdAt: Date }[];
  existingByKey?: { id: string; userId: string } | null;
}

function build(o: Setup = {}, config: Record<string, unknown> = {}) {
  const ledger = o.ledger ?? [];
  const debt = ledger.reduce((s, r) => s + r.delta, 0);
  const tx = {
    dealerCreditLedger: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { delta: ledger.length ? debt : null } }),
      findMany: jest.fn().mockResolvedValue(ledger),
    },
  };
  const prisma = {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(o.user ?? { id: 'd1', role: 'DEALER', metadata: { dealerTierId: 'GOLD' } }) },
    dealerTier: { findUnique: jest.fn().mockResolvedValue(o.tier === undefined ? GOLD : o.tier) },
    order: {
      findMany: jest.fn().mockResolvedValue(o.orders ?? []),
      findUnique: jest.fn().mockResolvedValue(o.existingByKey ?? null),
    },
    returnRequestItem: { findMany: jest.fn().mockResolvedValue(o.returned ?? []) },
    variation: { findMany: jest.fn().mockResolvedValue(o.variations ?? []) },
    dealerCreditLedger: tx.dealerCreditLedger,
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const svc = new DealerService(prisma as unknown as PrismaService, makeConfig(config));
  return { svc, prisma, tx };
}

const OCT_ORDERS = [
  { code: 'DL-2', items: [item('i3', 'v1', 10), item('i4', 'v2', 4)] },
  { code: 'DL-1', items: [item('i1', 'v1', 5), item('i2', 'gone', 3, { productName: 'Nước rửa cũ', variationName: '5L' })] },
];
const VARS = [
  { id: 'v1', sku: 'SKU-1', retailPrice: 100_000, dealerPrices: null, stock: 50 },
  { id: 'v2', sku: 'SKU-2', retailPrice: 250_000, dealerPrices: { GOLD: 180_000 }, stock: 0 },
];

describe('DealerService.lastMonthReorder', () => {
  it('gộp đơn đã nhận của tháng trước theo giá hôm nay, nêu món không còn bán sỉ, kiểm trước hạn mức còn lại', async () => {
    const { svc, prisma, tx } = build({ orders: OCT_ORDERS, variations: VARS, ledger: [{ delta: 2_000_000, refType: 'ORDER', refId: 'o0', createdAt: NOW }] });
    const r = await svc.lastMonthReorder('d1', NOW);

    const where = prisma.order.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ userId: 'd1', type: 'DEALER', status: { in: ['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED'] } });
    expect(where.createdAt).toEqual({ gte: new Date('2026-09-30T17:00:00Z'), lt: new Date('2026-10-31T17:00:00Z') });
    expect(r.month).toBe('10/2026');
    expect(r.orderCodes).toEqual(['DL-2', 'DL-1']);
    expect(r.lines).toEqual([
      { variationId: 'v1', sku: 'SKU-1', name: 'SP v1 – 1L', quantity: 15, unitPrice: 80_000, lineTotal: 1_200_000, stock: 50 },
      { variationId: 'v2', sku: 'SKU-2', name: 'SP v2 – 1L', quantity: 4, unitPrice: 180_000, lineTotal: 720_000, stock: 0 },
    ]);
    expect(r.skipped).toEqual(['Nước rửa cũ – 5L']);
    expect(r).toMatchObject({ goodsTotal: 1_920_000, shippingFee: 0, total: 1_920_000, block: null });
    expect(r.credit).toEqual({ limit: 10_000_000, debt: 2_000_000, available: 8_000_000, after: 6_080_000 });
    expect(r.quote).toMatch(/^[0-9a-f]{32}$/);
    // Dư nợ đọc trong snapshot REPEATABLE READ.
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(tx.dealerCreditLedger.aggregate).toHaveBeenCalledWith({ where: { userId: 'd1' }, _sum: { delta: true } });
  });

  it('trừ phần đã trả theo yêu cầu trả đã duyệt', async () => {
    const { svc, prisma } = build({ orders: OCT_ORDERS, variations: VARS, returned: [{ orderItemId: 'i3', quantity: 10 }] });
    const r = await svc.lastMonthReorder('d1', NOW);
    expect(prisma.returnRequestItem.findMany.mock.calls[0]![0].where).toMatchObject({ returnRequest: { status: 'APPROVED' } });
    expect(r.lines.find((l) => l.variationId === 'v1')!.quantity).toBe(5);
  });

  it('không có đơn nào tháng trước: NO_ORDERS, hạn mức vẫn là số thật (đã trừ dư nợ)', async () => {
    const { svc } = build({ ledger: [{ delta: 3_000_000, refType: 'ORDER', refId: 'o0', createdAt: NOW }] });
    const r = await svc.lastMonthReorder('d1', NOW);
    expect(r.block).toEqual({ code: 'NO_ORDERS', message: 'Tháng 10/2026 bạn chưa có đơn sỉ nào đã nhận để đặt lại.' });
    expect(r.lines).toEqual([]);
    expect(r.credit).toEqual({ limit: 10_000_000, debt: 3_000_000, available: 7_000_000, after: 7_000_000 });
  });

  it('mọi món không còn bán sỉ: NOTHING_SELLABLE', async () => {
    const { svc } = build({ orders: OCT_ORDERS, variations: [] });
    expect((await svc.lastMonthReorder('d1', NOW)).block?.code).toBe('NOTHING_SELLABLE');
  });

  it('vượt hạn mức còn lại: OVER_LIMIT nêu số còn lại', async () => {
    const { svc } = build({ orders: OCT_ORDERS, variations: VARS, ledger: [{ delta: 9_000_000, refType: 'ORDER', refId: 'o0', createdAt: NOW }] });
    const r = await svc.lastMonthReorder('d1', NOW);
    expect(r.credit).toEqual({ limit: 10_000_000, debt: 9_000_000, available: 1_000_000, after: -920_000 });
    expect(r.block).toEqual({
      code: 'OVER_LIMIT',
      message: `Đơn ${(1_920_000).toLocaleString('vi-VN')}đ vượt hạn mức công nợ còn lại ${(1_000_000).toLocaleString('vi-VN')}đ. Bạn giảm số lượng hoặc chọn Trả trước trong giỏ nhé.`,
    });
  });

  it('đúng bằng hạn mức còn lại vẫn đặt được (cùng điều kiện `debt + total > limit` của placeOrder)', async () => {
    const { svc } = build({ orders: OCT_ORDERS, variations: VARS, ledger: [{ delta: 8_080_000, refType: 'ORDER', refId: 'o0', createdAt: NOW }] });
    const r = await svc.lastMonthReorder('d1', NOW);
    expect(r.credit.after).toBe(0);
    expect(r.block).toBeNull();
  });

  it('chưa gán bậc: NO_TIER (hạn mức 0)', async () => {
    const { svc } = build({ orders: OCT_ORDERS, variations: VARS, tier: null, user: { id: 'd1', role: 'DEALER', metadata: null } });
    const r = await svc.lastMonthReorder('d1', NOW);
    expect(r.block?.code).toBe('NO_TIER');
    expect(r.credit.limit).toBe(0);
  });

  it('còn nợ quá hạn khi bật khoá: OVERDUE mang đúng lời của placeOrder', async () => {
    const old = new Date('2026-09-01T03:00:00Z');
    const { svc } = build(
      { orders: OCT_ORDERS, variations: VARS, ledger: [{ delta: 1_000_000, refType: 'ORDER', refId: 'o0', createdAt: old }] },
      { 'dealer.block_credit_when_overdue': true },
    );
    const r = await svc.lastMonthReorder('d1', NOW);
    expect(r.block?.code).toBe('OVERDUE');
    expect(r.block?.message).toMatch(/^Bạn còn nợ đơn ngày 01\/09\/2026 đã quá hạn thanh toán \(NET 30\)/);
  });

  it('dưới mức tối thiểu: BELOW_MIN; dưới ngưỡng miễn phí giao thì cộng phí giao vào tổng', async () => {
    const below = build({ orders: OCT_ORDERS, variations: VARS }, { 'dealer.min_order_value_vnd': 3_000_000 });
    expect((await below.svc.lastMonthReorder('d1', NOW)).block?.code).toBe('BELOW_MIN');

    const fee = build({ orders: OCT_ORDERS, variations: VARS }, { 'dealer.free_ship_threshold_vnd': 5_000_000, 'dealer.shipping_fee_below_threshold_vnd': 30_000 });
    const r = await fee.svc.lastMonthReorder('d1', NOW);
    expect(r).toMatchObject({ goodsTotal: 1_920_000, shippingFee: 30_000, total: 1_950_000 });
    expect(r.credit.after).toBe(10_000_000 - 1_950_000);
  });

  it('người chưa là đại lý: 403', async () => {
    const { svc } = build({ user: { id: 'u1', role: 'CUSTOMER', metadata: null } });
    await expect(svc.lastMonthReorder('u1', NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('dấu `quote` đổi khi giá đổi, giữ nguyên khi đọc lại cùng số', async () => {
    const a = await build({ orders: OCT_ORDERS, variations: VARS }).svc.lastMonthReorder('d1', NOW);
    const b = await build({ orders: OCT_ORDERS, variations: VARS }).svc.lastMonthReorder('d1', NOW);
    const c = await build({ orders: OCT_ORDERS, variations: [VARS[0]!, { ...VARS[1]!, dealerPrices: { GOLD: 170_000 } }] }).svc.lastMonthReorder('d1', NOW);
    expect(a.quote).toBe(b.quote);
    expect(c.quote).not.toBe(a.quote);
  });
});

describe('DealerService.placeLastMonthReorder', () => {
  const placed = { id: 'o-new', code: 'DL-NEW' };

  it('đúng dấu: tạo đơn CREDIT qua placeOrder với các dòng máy chủ tự gộp, cùng Idempotency-Key, kèm tổng bản xem trước để placeOrder so lại', async () => {
    const { svc } = build({ orders: OCT_ORDERS, variations: VARS });
    const { quote, total } = await svc.lastMonthReorder('d1', NOW);
    const place = jest.spyOn(svc, 'placeOrder').mockResolvedValue(placed as never);
    await expect(svc.placeLastMonthReorder('d1', quote, ' k-1 ', NOW)).resolves.toBe(placed);
    expect(place).toHaveBeenCalledWith(
      'd1',
      { items: [{ variationId: 'v1', quantity: 15 }, { variationId: 'v2', quantity: 4 }], paymentMethod: 'CREDIT' },
      'k-1',
      { total, month: '10/2026' },
    );
  });

  it('gửi lại cùng khoá trong lúc lần đầu đang chạy: lần đầu commit giữa chừng làm bản xem báo vượt hạn mức, vẫn trả lại đơn đã tạo', async () => {
    const { svc, prisma } = build({ orders: OCT_ORDERS, variations: VARS, ledger: [{ delta: 9_500_000, refType: 'ORDER', refId: 'o0', createdAt: NOW }] });
    const { quote } = await svc.lastMonthReorder('d1', NOW);
    prisma.order.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'o-first', userId: 'd1' });
    const view = jest.spyOn(svc as unknown as { orderForDealer: (id: string) => Promise<unknown> }, 'orderForDealer').mockResolvedValue({ code: 'DL-FIRST' });
    const place = jest.spyOn(svc, 'placeOrder');
    await expect(svc.placeLastMonthReorder('d1', quote, 'k-1', NOW)).resolves.toEqual({ code: 'DL-FIRST' });
    expect(view).toHaveBeenCalledWith('o-first');
    expect(place).not.toHaveBeenCalled();
  });

  it('placeOrder báo tổng đổi (giá đổi sau khi khớp dấu): 409 lan ra ngoài, không có đơn cùng khoá để trả lại', async () => {
    const { svc } = build({ orders: OCT_ORDERS, variations: VARS });
    const { quote } = await svc.lastMonthReorder('d1', NOW);
    const changed = new ConflictException({ code: 'DEALER_REORDER_CHANGED', message: 'x' });
    jest.spyOn(svc, 'placeOrder').mockRejectedValue(changed);
    await expect(svc.placeLastMonthReorder('d1', quote, 'k-1', NOW)).rejects.toBe(changed);
  });

  it('thiếu Idempotency-Key: 400, không đọc gì', async () => {
    const { svc, prisma } = build({ orders: OCT_ORDERS, variations: VARS });
    await expect(svc.placeLastMonthReorder('d1', 'a'.repeat(32), '  ', NOW)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('cùng khoá đã tạo đơn (mạng báo lỗi lần trước): trả lại đơn đó, không xem lại (đơn vừa ghi nợ sẽ làm bản xem báo vượt hạn mức)', async () => {
    const { svc, prisma } = build({ orders: OCT_ORDERS, variations: VARS, existingByKey: { id: 'o-old', userId: 'd1' } });
    const view = jest.spyOn(svc as unknown as { orderForDealer: (id: string) => Promise<unknown> }, 'orderForDealer').mockResolvedValue({ code: 'DL-OLD' });
    const place = jest.spyOn(svc, 'placeOrder');
    await expect(svc.placeLastMonthReorder('d1', 'a'.repeat(32), 'k-1', NOW)).resolves.toEqual({ code: 'DL-OLD' });
    expect(view).toHaveBeenCalledWith('o-old');
    expect(prisma.order.findMany).not.toHaveBeenCalled();
    expect(place).not.toHaveBeenCalled();
  });

  it('khoá của người khác: 400', async () => {
    const { svc } = build({ existingByKey: { id: 'o-x', userId: 'someone' } });
    await expect(svc.placeLastMonthReorder('d1', 'a'.repeat(32), 'k-1', NOW)).rejects.toThrow('Idempotency-Key đã được sử dụng');
  });

  it('dấu khác (giá vừa đổi): 409 DEALER_REORDER_CHANGED kèm tổng mới, không tạo đơn', async () => {
    const { svc } = build({ orders: OCT_ORDERS, variations: VARS });
    const place = jest.spyOn(svc, 'placeOrder');
    const err = await svc.placeLastMonthReorder('d1', 'f'.repeat(32), 'k-1', NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'DEALER_REORDER_CHANGED' });
    expect((err as ConflictException).message).toMatch(/^Giá hoặc phí giao của đơn tháng 10\/2026 vừa đổi, tổng mới là /);
    expect(place).not.toHaveBeenCalled();
  });

  it('bị chặn (vượt hạn mức): 400 DEALER_REORDER_OVER_LIMIT, không tạo đơn dù dấu khớp', async () => {
    const { svc } = build({ orders: OCT_ORDERS, variations: VARS, ledger: [{ delta: 9_500_000, refType: 'ORDER', refId: 'o0', createdAt: NOW }] });
    const { quote } = await svc.lastMonthReorder('d1', NOW);
    const place = jest.spyOn(svc, 'placeOrder');
    const err = await svc.placeLastMonthReorder('d1', quote, 'k-1', NOW).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'DEALER_REORDER_OVER_LIMIT' });
    expect(place).not.toHaveBeenCalled();
  });
});

describe('DealerService.creditLedger (w23-03 #5)', () => {
  it('đọc 200 dòng và tổng sổ trong CÙNG một transaction REPEATABLE READ, cả hai câu qua client của transaction', async () => {
    const rows = [{ id: 'l2', delta: -50_000 }, { id: 'l1', delta: 300_000 }];
    const { svc, prisma, tx } = build({ ledger: rows as never });
    const outerFind = jest.fn();
    (prisma as unknown as { dealerCreditLedger: unknown }).dealerCreditLedger = { findMany: outerFind, aggregate: outerFind };
    await expect(svc.creditLedger('d1')).resolves.toEqual({ balance: 250_000, entries: rows });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(tx.dealerCreditLedger.findMany).toHaveBeenCalledWith({ where: { userId: 'd1' }, orderBy: { createdAt: 'desc' }, take: 200 });
    expect(tx.dealerCreditLedger.aggregate).toHaveBeenCalledWith({ where: { userId: 'd1' }, _sum: { delta: true } });
    expect(outerFind).not.toHaveBeenCalled();
  });
});
