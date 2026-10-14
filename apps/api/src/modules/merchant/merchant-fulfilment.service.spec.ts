import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MerchantFulfilmentService, partialReversalLinesOf, reversalLineOf, saleLineOf, slaStateOf } from './merchant-fulfilment.service';
import { MerchantSlaCron } from './merchant-sla.cron';
import { payoutView } from './merchant-fulfilment.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderStatusService } from '../orders/order-status.service';

const STORE = { id: 'sf-a', type: 'MERCHANT', title: 'Xanh Shop', ownerUserId: 'u1' };
const SLA = { confirmHours: 24, shipHours: 48, deliverDays: 7 };
const NOW = new Date('2026-10-14T10:00:00Z');
const H = 3_600_000;

function build(order: Record<string, unknown> | null = { id: 'o1', code: 'TUBU1', status: 'CONFIRMED', merchantAcceptedAt: null }) {
  const setStatus = jest.fn().mockImplementation((_id: string, target: string) => Promise.resolve({ id: 'o1', status: target }));
  const notify = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    storefront: { findFirst: jest.fn().mockResolvedValue(STORE), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    merchantPayout: { create: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    merchantPayoutLine: { deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    merchantPancakeLink: { findMany: jest.fn().mockResolvedValue([]) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
    returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  const svc = new MerchantFulfilmentService(
    prisma as unknown as PrismaService,
    { setStatus } as unknown as OrderStatusService,
    { notify } as never,
  );
  return { svc, prisma, setStatus, notify };
}

describe('slaStateOf', () => {
  const base = { createdAt: new Date(NOW.getTime() - 30 * H), merchantAcceptedAt: null, shippedAt: null };
  it('chưa xác nhận quá 24 giờ → CONFIRM_OVERDUE', () => {
    expect(slaStateOf({ ...base, status: 'CONFIRMED' }, SLA, NOW).state).toBe('CONFIRM_OVERDUE');
  });
  it('đã xác nhận, chưa gửi, còn trong 48 giờ → chưa quá hạn, hạn = tạo đơn + 48 giờ', () => {
    const r = slaStateOf({ ...base, status: 'PACKED', merchantAcceptedAt: NOW }, SLA, NOW);
    expect(r.state).toBeNull();
    expect(r.dueAt).toEqual(new Date(base.createdAt.getTime() + 48 * H));
  });
  it('đang giao quá 7 ngày → DELIVER_OVERDUE; đơn đã giao → không có hạn', () => {
    expect(slaStateOf({ ...base, status: 'SHIPPING', shippedAt: new Date(NOW.getTime() - 8 * 24 * H) }, SLA, NOW).state).toBe(
      'DELIVER_OVERDUE',
    );
    expect(slaStateOf({ ...base, status: 'DELIVERED' }, SLA, NOW)).toEqual({ state: null, dueAt: null });
  });
});

describe('saleLineOf — công thức đối soát (thiết kế mục 7)', () => {
  const items = [{ total: 180_000 }, { total: 20_000 }];
  it('COD: đối tác đã thu cả tổng đơn → net = phần Tubu tài trợ − phí sàn (có thể âm)', () => {
    // hàng 200k (sau combo), mã Tubu 30k, phí giao 30k → khách trả 200k; phí sàn 15% = 30k.
    const l = saleLineOf({ id: 'o', code: 'C', paymentMethod: 'COD', total: 200_000, shippingFee: 30_000, merchantCommissionPct: new Prisma.Decimal('0.15'), deliveredAt: NOW, items });
    expect(l).toEqual(expect.objectContaining({ goodsAmount: 200_000, commissionAmount: 30_000, codCollected: 200_000, netAmount: 0 }));
  });
  it('Ví Tubu: Tubu giữ tiền → trả đối tác hàng + phí giao − phí sàn', () => {
    const l = saleLineOf({ id: 'o', code: 'C', paymentMethod: 'WALLET', total: 200_000, shippingFee: 30_000, merchantCommissionPct: 0.1, deliveredAt: NOW, items });
    expect(l.netAmount).toBe(200_000 + 30_000 - 20_000);
    expect(l.codCollected).toBe(0);
  });
});

describe('MerchantFulfilmentService — đối tác xử lý đơn', () => {
  it('gian hàng CTV không có đơn cần giao → 403', async () => {
    const { svc, prisma } = build();
    prisma.storefront.findFirst.mockResolvedValue({ ...STORE, type: 'CTV' });
    await expect(svc.listOrders('u1', undefined)).rejects.toThrow(ForbiddenException);
  });

  it('chỉ thao tác được đơn do CHÍNH gian hàng mình giao', async () => {
    const { svc, prisma } = build(null);
    await expect(svc.pack('u1', 'o-khac')).rejects.toThrow(NotFoundException);
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o-khac', fulfiller: 'MERCHANT', fulfillerStorefrontId: 'sf-a' } }),
    );
  });

  it('gửi hàng: hãng + mã vận đơn ghi trong cùng câu lật SHIPPING, actor MERCHANT, guard trạng thái vừa đọc', async () => {
    const { svc, setStatus } = build({ id: 'o1', code: 'TUBU1', status: 'PACKED', merchantAcceptedAt: null });
    await svc.ship('u1', 'o1', { carrier: ' GHTK ', trackingCode: 'S123', trackingUrl: 'https://ghtk.vn/S123' });
    expect(setStatus).toHaveBeenCalledWith(
      'o1',
      'SHIPPING',
      expect.objectContaining({
        actorType: 'MERCHANT',
        actorId: 'u1',
        expectedStatus: 'PACKED',
        patch: expect.objectContaining({ shippingPartner: 'GHTK', shippingCode: 'S123', trackingLink: 'https://ghtk.vn/S123', shippedAt: expect.any(Date) }),
      }),
    );
  });

  it('đơn vừa đổi trạng thái ở nơi khác (setStatus không lật) → 409', async () => {
    const { svc, setStatus } = build({ id: 'o1', code: 'TUBU1', status: 'CONFIRMED', merchantAcceptedAt: null });
    setStatus.mockResolvedValue({ id: 'o1', status: 'CANCELLED' });
    await expect(svc.pack('u1', 'o1')).rejects.toThrow(ConflictException);
  });

  it('huỷ chỉ được trước khi gửi hàng (D1); đã gửi thì phải báo "Giao không thành công"', async () => {
    const { svc } = build({ id: 'o1', code: 'TUBU1', status: 'SHIPPING', merchantAcceptedAt: NOW });
    await expect(svc.cancel('u1', 'o1', 'Hết hàng')).rejects.toThrow(BadRequestException);
  });

  it('đối tác huỷ: CANCELLED qua setStatus, báo khách kèm lý do', async () => {
    const { svc, setStatus } = build();
    await svc.cancel('u1', 'o1', 'Hết hàng');
    expect(setStatus).toHaveBeenCalledWith(
      'o1',
      'CANCELLED',
      expect.objectContaining({
        note: 'Hết hàng',
        notifyEvent: 'MERCHANT_ORDER_CANCELLED_BY_SELLER',
        notifyData: { reason: 'Hết hàng', store: 'Xanh Shop' },
        expectedStatus: 'CONFIRMED',
      }),
    );
  });

  it('giao thất bại chỉ từ SHIPPING', async () => {
    const { svc, setStatus } = build({ id: 'o1', code: 'TUBU1', status: 'SHIPPING', merchantAcceptedAt: NOW });
    await svc.fail('u1', 'o1', 'Khách không nghe máy');
    expect(setStatus).toHaveBeenCalledWith('o1', 'CANCELLED', expect.objectContaining({ note: 'Giao không thành công: Khách không nghe máy' }));
    const b2 = build();
    await expect(b2.svc.fail('u1', 'o1', 'x')).rejects.toThrow(BadRequestException);
  });

  it('xác nhận đơn: chỉ ghi mốc một lần (guard merchantAcceptedAt null)', async () => {
    const { svc, prisma } = build();
    await svc.accept('u1', 'o1');
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', status: { in: ['CONFIRMED', 'PACKED'] }, merchantAcceptedAt: null },
      data: { merchantAcceptedAt: expect.any(Date) },
    });
  });
});

describe('reversalLineOf — đơn đối tác bị trả, khách đã được Tubu hoàn tiền (thiết kế mục 7)', () => {
  // hàng 100k, phí giao 30k, phí sàn 15% = 15k; khách trả 130k.
  const cod = { id: 'o', code: 'C', paymentMethod: 'COD', paymentStatus: 'REFUNDED', total: 130_000 };
  const codSale = { goodsAmount: 100_000, shippingFee: 30_000, commissionAmount: 15_000, codCollected: 130_000, netAmount: -15_000 };

  it('COD đã đối soát rồi bị trả: đối tác vẫn giữ tiền mặt đã thu → tổng SALE + REVERSAL = −130k (nộp lại đúng số đã thu)', () => {
    const l = reversalLineOf(cod, codSale)!;
    expect(l).toEqual(
      expect.objectContaining({ kind: 'REVERSAL', goodsAmount: -100_000, shippingFee: -30_000, commissionAmount: -15_000, codCollected: 0 }),
    );
    expect(codSale.netAmount + l.netAmount).toBe(-130_000);
  });

  it('COD bị trả TRƯỚC khi đối soát: chưa từng lên bảng kê nhưng đối tác giữ 130k mà Tubu đã hoàn khách → dòng −130k', () => {
    const l = reversalLineOf(cod, null)!;
    expect(l).toEqual(
      expect.objectContaining({ kind: 'REVERSAL', goodsAmount: 0, shippingFee: 0, commissionAmount: 0, codCollected: 130_000, netAmount: -130_000 }),
    );
  });

  it('trả trước (Ví) đã đối soát: đảo đúng phần Tubu đã trả đối tác; chưa đối soát: không có gì để đảo', () => {
    const walletSale = { goodsAmount: 100_000, shippingFee: 30_000, commissionAmount: 15_000, codCollected: 0, netAmount: 115_000 };
    const wallet = { ...cod, paymentMethod: 'WALLET' };
    expect(reversalLineOf(wallet, walletSale)!.netAmount).toBe(-115_000);
    expect(reversalLineOf(wallet, null)).toBeNull();
  });

  it('COD bị trả mà khách chưa được hoàn (không REFUNDED) và chưa đối soát → không tạo dòng', () => {
    expect(reversalLineOf({ ...cod, paymentStatus: 'UNPAID' }, null)).toBeNull();
  });
});

describe('MerchantFulfilmentService — phiếu đối soát', () => {
  const delivered = {
    id: 'o9',
    code: 'TUBU9',
    paymentMethod: 'WALLET',
    total: 230_000,
    shippingFee: 30_000,
    merchantCommissionPct: 0.15,
    deliveredAt: new Date(NOW.getTime() - 10 * 24 * H),
    items: [{ id: 'i9', total: 200_000, quantity: 1 }],
  };

  it('bảng kê: đơn giao quá hạn giữ chưa đối soát (SALE) + đơn đã đối soát rồi bị trả (REVERSAL âm)', async () => {
    const { svc, prisma } = build();
    prisma.order.findMany
      .mockResolvedValueOnce([delivered])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'o5',
          code: 'TUBU5',
          paymentMethod: 'WALLET',
          paymentStatus: 'REFUNDED',
          total: 110,
          merchantPayoutLines: [{ kind: 'SALE', refKey: '', goodsAmount: 100, shippingFee: 10, commissionAmount: 15, codCollected: 0, netAmount: 95 }],
        },
        { id: 'o6', code: 'TUBU6', paymentMethod: 'COD', paymentStatus: 'REFUNDED', total: 130_000, merchantPayoutLines: [] },
      ]);
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.lines.map((l) => [l.orderCode, l.kind, l.netAmount])).toEqual([
      ['TUBU9', 'SALE', 200_000 + 30_000 - 30_000],
      ['TUBU5', 'REVERSAL', -95],
      ['TUBU6', 'REVERSAL', -130_000],
    ]);
    expect(st.total).toBe(200_000 - 95 - 130_000);
    expect(prisma.order.findMany.mock.calls[2][0].where).toEqual(
      expect.objectContaining({
        status: 'RETURNED',
        merchantPayoutLines: { none: { kind: 'REVERSAL', refKey: '' } },
        OR: [{ merchantPayoutLines: { some: { kind: 'SALE' } } }, { paymentMethod: 'COD', paymentStatus: 'REFUNDED' }],
      }),
    );
    const saleWhere = prisma.order.findMany.mock.calls[0][0].where;
    expect(saleWhere).toEqual(
      expect.objectContaining({
        status: 'DELIVERED',
        deliveredAt: { lte: new Date(NOW.getTime() - 7 * 24 * H) },
        merchantPayoutLines: { none: { kind: 'SALE' } },
      }),
    );
  });

  it('hai admin lập phiếu cùng lúc: lần sau đụng unique (orderId, kind) → 409, không trả hai lần', async () => {
    const { svc, prisma } = build();
    prisma.storefront.findUnique.mockResolvedValue({ ...STORE, bankName: 'VCB', bankAccountNo: '1', bankAccountName: 'A' });
    prisma.order.findMany.mockResolvedValueOnce([delivered]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prisma.merchantPayout.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expect(svc.createPayout('admin-1', 'sf-a')).rejects.toThrow(ConflictException);
  });

  it('không có dòng nào đủ điều kiện → 400', async () => {
    const { svc, prisma } = build();
    prisma.storefront.findUnique.mockResolvedValue(STORE);
    await expect(svc.createPayout('admin-1', 'sf-a')).rejects.toThrow('Không có đơn nào đủ điều kiện');
  });

  it('đánh dấu đã chuyển: chỉ phiếu PENDING, báo đối tác kèm mã giao dịch', async () => {
    const { svc, prisma, notify } = build();
    prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantPayout.findUnique.mockResolvedValue({ id: 'p1', status: 'PAID', amount: 200_000, storefront: { ownerUserId: 'u1' } });
    await svc.markPayoutPaid('admin-1', 'p1', 'FT123');
    expect(prisma.merchantPayout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1', status: 'PENDING' } }),
    );
    expect(notify).toHaveBeenCalledWith('u1', 'MERCHANT_PAYOUT_PAID', { amount: '200.000', bank_ref: 'FT123' });
  });

  it('huỷ phiếu chưa chuyển: các đơn quay lại bảng kê (xoá dòng)', async () => {
    const { svc, prisma } = build();
    prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantPayout.findUniqueOrThrow.mockResolvedValue({ id: 'p1', status: 'CANCELLED' });
    await svc.cancelPayout('admin-1', 'p1');
    expect(prisma.merchantPayoutLine.deleteMany).toHaveBeenCalledWith({ where: { payoutId: 'p1' } });
  });

  it('không huỷ được phiếu chứa SALE của đơn đã có dòng đảo ở phiếu khác (đối tác sẽ bị trừ tiền chưa từng nhận)', async () => {
    const { svc, prisma } = build();
    prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantPayoutLine.findMany.mockResolvedValue([{ orderId: 'o9' }]);
    prisma.merchantPayoutLine.findFirst.mockResolvedValue({ orderCode: 'TUBU9' });
    await expect(svc.cancelPayout('admin-1', 'p1')).rejects.toThrow(ConflictException);
    expect(prisma.merchantPayoutLine.deleteMany).not.toHaveBeenCalled();
  });

  it('trả một phần (p5) đơn đã vào phiếu → thêm một dòng REVERSAL RETURN:<id> cho phần trả; SALE không lặp lại', async () => {
    const { svc, prisma } = build();
    const settledOrder = {
      id: 'o7',
      code: 'TUBU7',
      paymentMethod: 'COD',
      total: 230_000,
      shippingFee: 30_000,
      merchantCommissionPct: 0.1,
      deliveredAt: NOW,
      items: [{ id: 'i1', total: 200_000, quantity: 4 }],
      merchantPayoutLines: [{ kind: 'SALE', refKey: '', goodsAmount: 200_000, shippingFee: 30_000, commissionAmount: 20_000, codCollected: 230_000, netAmount: -20_000 }],
    };
    prisma.$queryRaw.mockResolvedValue([{ orderId: 'o7' }]);
    prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([settledOrder]);
    prisma.returnRequest.findMany.mockResolvedValue([
      { id: 'rr1', orderId: 'o7', reviewedAt: NOW, shippingRefund: 0, items: [{ orderItemId: 'i1', quantity: 1 }] },
    ]);
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.lines).toEqual([
      expect.objectContaining({ orderCode: 'TUBU7', kind: 'REVERSAL', refKey: 'RETURN:rr1', goodsAmount: -50_000, commissionAmount: -5_000, codCollected: 0, netAmount: -45_000 }),
    ]);
  });

  it('SALE vừa đủ hạn của đơn có lần trả một phần → SALE và dòng đảo đi cùng phiếu', async () => {
    const { svc, prisma } = build();
    prisma.order.findMany.mockResolvedValueOnce([{ ...delivered, items: [{ id: 'i9', total: 200_000, quantity: 2 }] }]);
    prisma.returnRequest.findMany.mockResolvedValue([
      { id: 'rr2', orderId: 'o9', reviewedAt: NOW, shippingRefund: 30_000, items: [{ orderItemId: 'i9', quantity: 1 }] },
    ]);
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.lines.map((l) => [l.kind, l.refKey, l.netAmount])).toEqual([
      ['SALE', '', 200_000 + 30_000 - 30_000],
      ['REVERSAL', 'RETURN:rr2', -(100_000 + 30_000 - 15_000)],
    ]);
  });

  it('đơn RETURNED sau một lần trả một phần đã đảo → dòng đảo cả đơn chỉ lấy phần còn lại; SALE + mọi dòng đảo = 0', async () => {
    const { svc, prisma } = build();
    const sale = { kind: 'SALE', refKey: '', goodsAmount: 200_000, shippingFee: 30_000, commissionAmount: 20_000, codCollected: 0, netAmount: 210_000 };
    const order = {
      id: 'o8',
      code: 'TUBU8',
      paymentMethod: 'WALLET',
      paymentStatus: 'REFUNDED',
      total: 230_000,
      shippingFee: 30_000,
      merchantCommissionPct: 0.1,
      deliveredAt: NOW,
      items: [{ id: 'i1', total: 200_000, quantity: 3 }],
      merchantPayoutLines: [sale, { kind: 'REVERSAL', refKey: 'RETURN:rr3', goodsAmount: -66_667, shippingFee: 0, commissionAmount: -6_667, codCollected: 0, netAmount: -60_000 }],
    };
    prisma.order.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([order]);
    prisma.returnRequest.findMany.mockResolvedValue([
      { id: 'rr3', orderId: 'o8', reviewedAt: NOW, shippingRefund: 0, items: [{ orderItemId: 'i1', quantity: 1 }] },
    ]);
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.lines).toHaveLength(1);
    const whole = st.lines[0]!;
    expect(whole).toMatchObject({ kind: 'REVERSAL', refKey: '', goodsAmount: -133_333, shippingFee: -30_000, commissionAmount: -13_333 });
    expect(sale.netAmount - 60_000 + whole.netAmount).toBe(0);
  });
});

describe('partialReversalLinesOf — trả nhiều lần cộng lại đúng bằng trả cả dòng', () => {
  it('ba lần trả 1/3 → tổng tiền hàng đảo = tổng dòng, phí sàn không lệch làm tròn', () => {
    const order = { id: 'o', code: 'C', merchantCommissionPct: new Prisma.Decimal('0.15'), items: [{ id: 'i', total: 100_000, quantity: 3 }] };
    const reqs = ['a', 'b', 'c'].map((id, n) => ({ id, reviewedAt: new Date(NOW.getTime() + n), shippingRefund: 0, items: [{ orderItemId: 'i', quantity: 1 }] }));
    const lines = partialReversalLinesOf(order, reqs);
    expect(lines.map((l) => l.refKey)).toEqual(['RETURN:a', 'RETURN:b', 'RETURN:c']);
    expect(lines.reduce((s, l) => s + l.goodsAmount, 0)).toBe(-100_000);
    expect(lines.reduce((s, l) => s + l.commissionAmount, 0)).toBe(-15_000);
  });
});

describe('MerchantSlaCron', () => {
  it('nhắc đối tác đơn quá hạn, đánh dấu có điều kiện để không nhắc trùng', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) };
    const prisma = { order: { updateMany }, $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) };
    const overdue = [
      { id: 'o1', code: 'A', status: 'CONFIRMED', createdAt: new Date(NOW.getTime() - 30 * H), merchantAcceptedAt: null, shippedAt: null, fulfillerStorefront: { ownerUserId: 'u1' } },
      { id: 'o2', code: 'B', status: 'CONFIRMED', createdAt: new Date(NOW.getTime() - 30 * H), merchantAcceptedAt: null, shippedAt: null, fulfillerStorefront: { ownerUserId: 'u1' } },
    ];
    const fulfilment = { slaConfig: jest.fn().mockResolvedValue(SLA), overdueOrders: jest.fn().mockResolvedValue(overdue) };
    const notify = jest.fn().mockResolvedValue(undefined);
    const cron = new MerchantSlaCron(prisma as never, fulfilment as never, { notify } as never);
    const res = await cron.remind(NOW);
    expect(res).toEqual({ scanned: 2, notified: 1 });
    expect(notify).toHaveBeenCalledWith('u1', 'MERCHANT_ORDER_OVERDUE', { order_code: 'A', step: 'xác nhận đơn' });
    expect(updateMany.mock.calls[0][0].where.OR).toEqual([
      { merchantSlaNotifiedAt: null },
      { merchantSlaNotifiedAt: { lt: new Date(NOW.getTime() - 12 * H) } },
    ]);
  });

  it('R2-MERCHANT-11: lần nhắc đầu của đơn chưa gửi hàng → báo cả khách (chậm bước nào, huỷ được); nhắc lại hay đơn đang giao thì không', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) };
    const prisma = { order: { updateMany }, $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) };
    const store = { title: 'Shop B', ownerUserId: 'u1' };
    const base = { createdAt: new Date(NOW.getTime() - 30 * H), merchantAcceptedAt: null, shippedAt: null, fulfillerStorefront: store };
    const overdue = [
      { ...base, id: 'o1', code: 'A', userId: 'buyer-a', status: 'CONFIRMED', merchantSlaNotifiedAt: null },
      { ...base, id: 'o2', code: 'B', userId: 'buyer-b', status: 'CONFIRMED', merchantSlaNotifiedAt: new Date(NOW.getTime() - 13 * H) },
      {
        ...base,
        id: 'o3',
        code: 'C',
        userId: 'buyer-c',
        status: 'PACKED',
        createdAt: new Date(NOW.getTime() - 50 * H),
        merchantAcceptedAt: new Date(NOW.getTime() - 49 * H),
        merchantSlaNotifiedAt: null,
      },
      {
        ...base,
        id: 'o4',
        code: 'D',
        userId: 'buyer-d',
        status: 'SHIPPING',
        createdAt: new Date(NOW.getTime() - 9 * 24 * H),
        merchantAcceptedAt: new Date(NOW.getTime() - 9 * 24 * H),
        shippedAt: new Date(NOW.getTime() - 8 * 24 * H),
        merchantSlaNotifiedAt: null,
      },
    ];
    const fulfilment = { slaConfig: jest.fn().mockResolvedValue(SLA), overdueOrders: jest.fn().mockResolvedValue(overdue) };
    const notify = jest.fn().mockResolvedValue(undefined);
    await new MerchantSlaCron(prisma as never, fulfilment as never, { notify } as never).remind(NOW);
    const buyerCalls = notify.mock.calls.filter((c) => c[1] === 'ORDER_MERCHANT_DELAYED');
    expect(buyerCalls).toEqual([
      ['buyer-a', 'ORDER_MERCHANT_DELAYED', { order_code: 'A', store: 'Shop B', step: 'xác nhận đơn' }],
      ['buyer-c', 'ORDER_MERCHANT_DELAYED', { order_code: 'C', store: 'Shop B', step: 'gửi hàng' }],
    ]);
  });
});

describe('R2-MERCHANT-4: phiếu đối soát âm là đối tác nộp lại Tubu', () => {
  const created = new Date('2026-10-14T03:00:00Z');
  it('phiếu âm chờ xử lý: hướng TO_TUBU, nội dung chuyển khoản theo mã phiếu, hạn nộp = ngày lập + số ngày cấu hình', () => {
    const v = payoutView({ id: 'cmpayout0001abcd1234', amount: -103_500, status: 'PENDING', createdAt: created }, 7);
    expect(v).toMatchObject({ direction: 'TO_TUBU', transferMemo: 'TUBU DS ABCD1234', dueAt: new Date('2026-10-21T03:00:00Z') });
  });
  it('phiếu dương: Tubu chuyển, không có hạn nộp; phiếu âm đã thu: không còn hạn', () => {
    expect(payoutView({ id: 'p1xxxxxxxx', amount: 50_000, status: 'PENDING', createdAt: created }, 7)).toMatchObject({
      direction: 'TO_MERCHANT',
      dueAt: null,
    });
    expect(payoutView({ id: 'p2xxxxxxxx', amount: -1, status: 'PAID', createdAt: created }, 7).dueAt).toBeNull();
  });

  it('myStatement kèm tài khoản nhận của Tubu và phiếu đã gắn hướng/hạn nộp', async () => {
    const { svc, prisma } = build();
    (prisma as unknown as { merchantPayout: { findMany: jest.Mock } }).merchantPayout.findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'cmpayout0001abcd1234', amount: -103_500, status: 'PENDING', createdAt: created, lines: [] }]);
    (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
    const config = {
      get: jest.fn(async (k: string, fb: unknown) =>
        ({
          'payment.bank_name': 'Techcombank',
          'payment.bank_account_no': '9984606774',
          'payment.bank_account_name': 'CONG TY TUBU TREE',
          'merchant.negative_payout_due_days': 5,
        })[k] ?? fb,
      ),
    };
    (svc as unknown as { config: unknown }).config = config;
    const res = await svc.myStatement('u1');
    expect(res.tubuAccount).toEqual({ bankName: 'Techcombank', accountNo: '9984606774', accountName: 'CONG TY TUBU TREE' });
    expect(res.payouts[0]).toMatchObject({ direction: 'TO_TUBU', dueAt: new Date('2026-10-19T03:00:00Z') });
  });
});

describe('Q8: hàng "Tubu giao hộ" vào bảng kê theo từng dòng hàng', () => {
  const LINKED = new Date('2026-09-01T00:00:00Z');
  const order = (id: string, deliveredAt: Date) => ({
    id,
    code: id.toUpperCase(),
    total: 195_000,
    shippingFee: 25_000,
    createdAt: new Date('2026-09-20T00:00:00Z'),
    deliveredAt,
    items: [
      { id: `${id}-a`, variationId: 'vA', productName: 'Mật ong', variationName: 'Hũ', quantity: 2, total: 120_000 },
      { id: `${id}-b`, variationId: 'vB', productName: 'Xà bông', variationName: 'Bánh', quantity: 1, total: 50_000 },
      { id: `${id}-c`, variationId: 'vC', productName: 'Hàng Tubu', variationName: 'Chai', quantity: 1, total: 30_000 },
    ],
  });

  function withLinks() {
    const b = build();
    b.prisma.merchantPancakeLink.findMany.mockResolvedValue([
      { variationId: 'vA', linkedAt: LINKED, unlinkedAt: null },
      { variationId: 'vB', linkedAt: LINKED, unlinkedAt: null },
    ]);
    b.prisma.storefront.findUnique.mockResolvedValue({ commissionPct: new Prisma.Decimal('0.1'), consignmentFeePct: new Prisma.Decimal('0.02'), consignmentFeeFixed: 3_400 });
    return b;
  }

  it('đủ 7 ngày → bảng kê (A 87.360, B 36.400); chưa đủ → sắp đủ hạn; dòng hàng Tubu và dòng đã có SALE không vào', async () => {
    const { svc, prisma } = withLinks();
    const due = order('o1', new Date(NOW.getTime() - 10 * 24 * H));
    const soon = order('o2', new Date(NOW.getTime() - 2 * 24 * H));
    prisma.orderItem.findMany
      .mockResolvedValueOnce([{ id: 'o1-a', order: due }, { id: 'o1-b', order: due }, { id: 'o2-a', order: soon }])
      .mockResolvedValueOnce([]);
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.consignmentTerms).toEqual({ commissionPct: 0.1, feePct: 0.02, feeFixed: 3_400 });
    expect(st.lines.map((l) => [l.refKey, l.orderItemId, l.goodsAmount, l.commissionAmount, l.opsFeeAmount, l.netAmount])).toEqual([
      ['ITEM:o1-a', 'o1-a', 102_000, 10_200, 4_440, 87_360],
      ['ITEM:o1-b', 'o1-b', 42_500, 4_250, 1_850, 36_400],
    ]);
    expect(st.total).toBe(123_760);
    // o2-b đã vào phiếu ở lần trước (không nằm trong kết quả chưa có SALE) → chỉ còn o2-a.
    expect(st.upcoming.map((l) => [l.refKey, l.availableAt])).toEqual([['ITEM:o2-a', new Date(soon.deliveredAt.getTime() + 7 * 24 * H)]]);
    expect(prisma.orderItem.findMany.mock.calls[0][0].where).toEqual({
      variationId: { in: ['vA', 'vB'] },
      merchantPayoutLines: { none: { kind: 'SALE' } },
      order: { fulfiller: 'TUBU', status: 'DELIVERED', createdAt: { gte: LINKED } },
    });
  });

  it('gian hàng không đặt phí sàn riêng → merchant.commission_pct; mặc định không có phí giao hộ', async () => {
    const { svc, prisma } = withLinks();
    prisma.storefront.findUnique.mockResolvedValue({ commissionPct: null, consignmentFeePct: new Prisma.Decimal(0), consignmentFeeFixed: 0 });
    (svc as unknown as { config: unknown }).config = { get: jest.fn(async (k: string, fb: unknown) => (k === 'merchant.commission_pct' ? 0.12 : fb)) };
    await expect(svc.consignmentTerms('sf-a')).resolves.toEqual({ commissionPct: 0.12, feePct: 0, feeFixed: 0 });
  });

  it('dòng đã vào phiếu: trả một phần mới duyệt → REVERSAL RETURN:<id>:ITEM:<dòng>; đơn RETURNED → đảo phần còn lại ITEM:<dòng>', async () => {
    const { svc, prisma } = withLinks();
    prisma.orderItem.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'o1-a' }])
      .mockResolvedValueOnce([
        {
          id: 'o1-a',
          variationId: 'vA',
          productName: 'Mật ong',
          variationName: 'Hũ',
          quantity: 2,
          total: 120_000,
          order: { id: 'o1', code: 'O1', status: 'RETURNED' },
          merchantPayoutLines: [{ kind: 'SALE', refKey: 'ITEM:o1-a', goodsAmount: 102_000, commissionAmount: 10_200, opsFeeAmount: 4_440 }],
        },
      ]);
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ orderItemId: 'o1-a' }]);
    prisma.returnRequestItem.findMany.mockResolvedValue([{ orderItemId: 'o1-a', quantity: 1, returnRequest: { id: 'rr1', reviewedAt: NOW } }]);
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.lines.map((l) => [l.kind, l.refKey, l.netAmount])).toEqual([
      ['REVERSAL', 'RETURN:rr1:ITEM:o1-a', -43_680],
      ['REVERSAL', 'ITEM:o1-a', -43_680],
    ]);
    expect(prisma.orderItem.findMany.mock.calls[1][0].where).toEqual({
      order: { status: 'RETURNED' },
      merchantPayoutLines: { some: { kind: 'SALE', payout: { storefrontId: 'sf-a' } }, none: { kind: 'REVERSAL', refKey: { startsWith: 'ITEM:' } } },
    });
  });

  it('lập phiếu lưu dòng hàng và phí giao hộ của từng dòng', async () => {
    const { svc, prisma } = withLinks();
    const due = order('o1', new Date(NOW.getTime() - 10 * 24 * H));
    prisma.orderItem.findMany.mockResolvedValueOnce([{ id: 'o1-a', order: due }]).mockResolvedValueOnce([]);
    prisma.storefront.findUnique
      .mockResolvedValueOnce({ ...STORE, bankName: 'VCB', bankAccountNo: '1', bankAccountName: 'A' })
      .mockResolvedValue({ commissionPct: new Prisma.Decimal('0.1'), consignmentFeePct: new Prisma.Decimal('0.02'), consignmentFeeFixed: 3_400 });
    prisma.merchantPayout.create.mockResolvedValue({ id: 'p1', amount: 87_360, lines: [{}] });
    await svc.createPayout('admin-1', 'sf-a');
    const data = prisma.merchantPayout.create.mock.calls[0][0].data;
    expect(data.amount).toBe(87_360);
    expect(data.lines.create).toEqual([
      expect.objectContaining({ orderId: 'o1', kind: 'SALE', refKey: 'ITEM:o1-a', orderItemId: 'o1-a', shippingFee: 0, codCollected: 0, opsFeeAmount: 4_440, netAmount: 87_360 }),
    ]);
  });

  it('huỷ phiếu: dòng giao hộ chỉ bị chặn bởi dòng đảo của CHÍNH dòng hàng đó ở phiếu khác', async () => {
    const { svc, prisma } = build();
    prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantPayout.findUniqueOrThrow.mockResolvedValue({ id: 'p1', status: 'CANCELLED' });
    prisma.merchantPayoutLine.findMany.mockResolvedValue([
      { orderId: 'o1', orderItemId: 'o1-a' },
      { orderId: 'o9', orderItemId: null },
    ]);
    await svc.cancelPayout('admin-1', 'p1');
    expect(prisma.merchantPayoutLine.findFirst.mock.calls[0][0].where).toEqual({
      kind: 'REVERSAL',
      payoutId: { not: 'p1' },
      OR: [{ orderId: { in: ['o9'] }, orderItemId: null }, { orderItemId: { in: ['o1-a'] } }],
    });
    expect(prisma.merchantPayoutLine.deleteMany).toHaveBeenCalledWith({ where: { payoutId: 'p1' } });
  });

  it('tổng quan admin gồm cả gian hàng chỉ có hàng giao hộ, kèm số khoản giao hộ và mức phí', async () => {
    const { svc, prisma } = build();
    prisma.merchantPancakeLink.findMany.mockImplementation(async (args: { distinct?: string[] }) =>
      args.distinct ? [{ storefrontId: 'sf-c' }] : [],
    );
    (prisma.order as unknown as { count: jest.Mock }).count = jest.fn().mockResolvedValue(0);
    prisma.storefront.findMany.mockResolvedValue([
      { id: 'sf-c', title: 'Giao hộ', owner: null, commissionPct: null, consignmentFeePct: new Prisma.Decimal('0.02'), consignmentFeeFixed: 3_400 },
    ]);
    const res = await svc.adminOverview(NOW);
    expect(prisma.storefront.findMany.mock.calls[0][0].where).toEqual({
      type: 'MERCHANT',
      OR: [{ fulfilledOrders: { some: {} } }, { id: { in: ['sf-c'] } }],
    });
    expect(res.defaultCommissionPct).toBe(0.15);
    expect(res.stores[0]).toMatchObject({ storefrontId: 'sf-c', commissionPct: null, consignmentFeePct: 0.02, consignmentFeeFixed: 3_400, consignmentLines: 0 });
  });

  it('admin sửa phí: chỉ gian hàng đối tác; chỉ ghi trường được gửi', async () => {
    const { svc, prisma } = build();
    prisma.storefront.findUnique.mockResolvedValueOnce({ type: 'CTV' });
    await expect(svc.updateStoreTerms('sf-x', { consignmentFeePct: 0.01 })).rejects.toThrow(NotFoundException);
    prisma.storefront.findUnique.mockResolvedValueOnce({ type: 'MERCHANT' });
    await svc.updateStoreTerms('sf-a', { commissionPct: null, consignmentFeeFixed: 2_000 });
    expect(prisma.storefront.update.mock.calls[0][0].data).toEqual({ commissionPct: null, consignmentFeeFixed: 2_000 });
  });
});
