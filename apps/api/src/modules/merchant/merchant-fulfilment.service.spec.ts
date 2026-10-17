import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MerchantFulfilmentService, partialReversalLinesOf, reversalLineOf, saleLineOf, slaStateOf } from './merchant-fulfilment.service';
import { MerchantSlaCron } from './merchant-sla.cron';
import { payoutView, withLineItems } from './merchant-fulfilment.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrderStatusService } from '../orders/order-status.service';

const STORE = { id: 'sf-a', type: 'MERCHANT', title: 'Xanh Shop', ownerUserId: 'u1' };
const SLA = { confirmHours: 24, shipHours: 48, deliverDays: 7 };
const NOW = new Date('2026-10-14T10:00:00Z');
const H = 3_600_000;
const CREATED = new Date('2026-10-10T03:00:00Z');

const PAYOUT_LINE = {
  id: 'l1',
  payoutId: 'p1',
  orderId: 'o1',
  orderCode: 'TUBU1',
  kind: 'SALE',
  refKey: '',
  orderItemId: null,
  goodsAmount: 200_000,
  shippingFee: 30_000,
  commissionAmount: 20_000,
  opsFeeAmount: 0,
  codCollected: 0,
  netAmount: 210_000,
  createdAt: CREATED,
  orderItem: null,
};

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
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    merchantPayout: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ storefrontId: 'sf-a', amount: 200_000, createdAt: CREATED, storefront: { ownerUserId: 'u1' } }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'p1', status: 'CANCELLED', amount: 200_000, createdAt: CREATED, lines: [], cancelSnapshot: null }),
    },
    merchantPayoutLine: { deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    merchantPancakeLink: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({}),
    },
    storefrontTermsHistory: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
    returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
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
  const items = [{ id: 'a', total: 180_000 }, { id: 'b', total: 20_000 }];
  it('COD: tiền hàng = tiền khách thực trả cho hàng; gian hàng đã thu cả tổng đơn → nộp phí sàn trên phần đó', () => {
    // hàng 200k (sau combo), mã Tubu 30k, phí giao 30k → khách trả 200k, tiền hàng thực trả 170k; phí sàn 15% = 25,5k.
    const l = saleLineOf({ id: 'o', code: 'C', paymentMethod: 'COD', total: 200_000, shippingFee: 30_000, merchantCommissionPct: new Prisma.Decimal('0.15'), deliveredAt: NOW, items });
    expect(l).toEqual(expect.objectContaining({ goodsAmount: 170_000, shippingFee: 30_000, commissionAmount: 25_500, codCollected: 200_000, netAmount: -25_500 }));
  });
  it('Ví Tubu: Tubu giữ tiền → trả gian hàng tiền hàng khách trả + phí giao − phí sàn; ví là cách trả, không phải giảm giá', () => {
    const l = saleLineOf({ id: 'o', code: 'C', paymentMethod: 'WALLET', total: 200_000, shippingFee: 30_000, merchantCommissionPct: 0.1, deliveredAt: NOW, items });
    expect(l.goodsAmount).toBe(170_000);
    expect(l.netAmount).toBe(170_000 + 30_000 - 17_000);
    expect(l.codCollected).toBe(0);
  });
  it('đơn không giảm giá: tiền hàng = tổng dòng như trước', () => {
    const l = saleLineOf({ id: 'o', code: 'C', paymentMethod: 'WALLET', total: 230_000, shippingFee: 30_000, merchantCommissionPct: 0.1, deliveredAt: NOW, items });
    expect(l).toMatchObject({ goodsAmount: 200_000, commissionAmount: 20_000, netAmount: 210_000 });
  });
});

describe('Đơn tự giao — ví dụ tính tay (giống race spec merchant-selfship-paid-base)', () => {
  // A 2 × 100k, B 1 × 100k; mã giảm 50k; phí giao 30k → khách trả 280k; phí sàn 10%.
  const order = {
    id: 'o',
    code: 'C',
    paymentMethod: 'COD',
    paymentStatus: 'REFUNDED',
    total: 280_000,
    shippingFee: 30_000,
    merchantCommissionPct: 0.1,
    deliveredAt: NOW,
    items: [
      { id: 'iA', total: 200_000, quantity: 2 },
      { id: 'iB', total: 100_000, quantity: 1 },
    ],
  };
  const r1 = { id: 'r1', reviewedAt: NOW, shippingRefund: 0, items: [{ orderItemId: 'iA', quantity: 1 }] };

  it('SALE −25.000; trả 1 × A −75.001; trả nốt −179.999; hàng/phí giao/phí sàn cộng lại = 0, thực nhận = −280.000 tiền COD', () => {
    const sale = saleLineOf(order);
    expect(sale).toMatchObject({ goodsAmount: 250_000, shippingFee: 30_000, commissionAmount: 25_000, codCollected: 280_000, netAmount: -25_000 });
    const [partial] = partialReversalLinesOf(order, [r1]);
    expect(partial).toMatchObject({ refKey: 'RETURN:r1', goodsAmount: -83_334, shippingFee: 0, commissionAmount: -8_333, netAmount: -75_001 });
    const whole = reversalLineOf(order, sale, [partial!])!;
    expect(whole).toMatchObject({ goodsAmount: -166_666, shippingFee: -30_000, commissionAmount: -16_667, codCollected: 0, netAmount: -179_999 });
    const all = [sale, partial!, whole];
    const total = (k: 'goodsAmount' | 'shippingFee' | 'commissionAmount' | 'netAmount') => all.reduce((s, l) => s + l[k], 0);
    expect([total('goodsAmount'), total('shippingFee'), total('commissionAmount')]).toEqual([0, 0, 0]);
    expect(total('netAmount')).toBe(-280_000);
  });

  it('SALE đã lưu theo nền cũ (tiền hàng 300.000) → dòng đảo chia trên số đã lưu: trả 1 × A = −100.000, phí sàn −10.000', () => {
    const [partial] = partialReversalLinesOf(order, [r1], 300_000);
    expect(partial).toMatchObject({ goodsAmount: -100_000, commissionAmount: -10_000, netAmount: -90_000 });
  });

  it('SALE đã lưu khác nền: phần dư làm tròn chia theo id dòng — thứ tự dòng DB trả về không đổi số', () => {
    const two = { ...order, total: 130_000, items: [{ id: 'iB', total: 50_000, quantity: 1 }, { id: 'iA', total: 50_000, quantity: 1 }] };
    const rA = { ...r1, items: [{ orderItemId: 'iA', quantity: 1 }] };
    const goodsOf = (o: typeof two) => partialReversalLinesOf(o, [rA], 100_001)[0]!.goodsAmount;
    expect(goodsOf(two)).toBe(-50_001);
    expect(goodsOf({ ...two, items: [...two.items].reverse() })).toBe(-50_001);
  });

  it('SALE đã lưu theo nền mới → dòng đảo giống hệt khi tính cùng SALE', () => {
    expect(partialReversalLinesOf(order, [r1], 250_000)).toEqual(partialReversalLinesOf(order, [r1]));
  });
});

describe('MerchantFulfilmentService — đối tác xử lý đơn', () => {
  it('gian hàng CTV không có đơn cần giao → 403', async () => {
    const { svc, prisma } = build();
    prisma.storefront.findFirst.mockResolvedValue({ ...STORE, type: 'CTV' });
    await expect(svc.listOrders('u1', undefined)).rejects.toThrow(ForbiddenException);
  });

  it('R5-PARTNER-6: danh sách và mọi phản hồi sau thao tác chỉ chọn trường giao hàng, không có tài khoản người mua (user) hay mã nhóm đặt hàng', async () => {
    const { svc, prisma } = build({ id: 'o1', code: 'TUBU1', status: 'CONFIRMED', merchantAcceptedAt: null });
    await svc.listOrders('u1', undefined);
    await svc.accept('u1', 'o1');
    await svc.pack('u1', 'o1');
    const selects = [
      ...prisma.order.findMany.mock.calls.map((c) => c[0].select),
      ...prisma.order.findUniqueOrThrow.mock.calls.map((c) => c[0].select),
    ].filter(Boolean);
    expect(selects.length).toBeGreaterThanOrEqual(3);
    for (const select of selects) {
      expect(select).not.toHaveProperty('user');
      expect(select).not.toHaveProperty('userId');
      expect(select).not.toHaveProperty('checkoutGroup');
    }
    expect(prisma.order.findMany.mock.calls[0]![0].select).toMatchObject({ shippingAddress: true, note: true });
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

  it('giao thất bại hoặc huỷ với lý do chỉ có khoảng trắng bị từ chối, đơn không đổi trạng thái (R4-PARTNER-1)', async () => {
    const { svc, setStatus } = build({ id: 'o1', code: 'TUBU1', status: 'SHIPPING', merchantAcceptedAt: NOW });
    await expect(svc.fail('u1', 'o1', '   ')).rejects.toThrow('Cần nhập lý do để báo khách.');
    const b2 = build();
    await expect(b2.svc.cancel('u1', 'o1', ' \n ')).rejects.toThrow('Cần nhập lý do để báo khách.');
    expect(setStatus).not.toHaveBeenCalled();
    expect(b2.setStatus).not.toHaveBeenCalled();
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

  it('sắp đủ hạn: bỏ đơn đã có SALE (mốc giao bị sửa lùi sau khi đã vào phiếu không làm đơn hiện lại)', async () => {
    const { svc, prisma } = build();
    await svc.statementFor('sf-a', NOW);
    const upcomingWhere = prisma.order.findMany.mock.calls[1][0].where;
    expect(upcomingWhere.deliveredAt).toHaveProperty('gt');
    expect(upcomingWhere.merchantPayoutLines).toEqual({ none: { kind: 'SALE' } });
  });

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

  describe('thông báo lập phiếu (R4-PARTNER-5)', () => {
    function created(amount: number, lines: { orderId: string }[]) {
      const b = build();
      b.prisma.storefront.findUnique.mockResolvedValue({ ...STORE, bankName: 'VCB', bankAccountNo: '1', bankAccountName: 'A' });
      b.prisma.order.findMany.mockResolvedValueOnce([delivered]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      b.prisma.merchantPayout.create.mockResolvedValue({ id: 'cmpayout0001abcd1234', amount, status: 'PENDING', createdAt: CREATED, lines });
      return b;
    }

    it('phiếu dương: đếm số đơn khác nhau, không đếm dòng (SALE, dòng đảo, từng món cùng đơn là một đơn)', async () => {
      const { svc, notify } = created(300_000, [{ orderId: 'o1' }, { orderId: 'o1' }, { orderId: 'o2' }]);
      await svc.createPayout('admin-1', 'sf-a');
      expect(notify).toHaveBeenCalledWith('u1', 'MERCHANT_PAYOUT_CREATED', { amount: '300.000', count: '2' });
    });

    it('phiếu âm: nói gian hàng phải chuyển cho Tubu bao nhiêu, hạn nào, nội dung gì — không in số âm', async () => {
      const { svc, notify } = created(-80_236, [{ orderId: 'o1' }, { orderId: 'o1' }, { orderId: 'o2' }]);
      await svc.createPayout('admin-1', 'sf-a');
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith('u1', 'MERCHANT_PAYOUT_CREATED_TO_TUBU', {
        amount: '80.236',
        count: '2',
        due_date: '17/10/2026',
        memo: 'TUBU DS ABCD1234',
      });
    });

    it('đánh dấu đã thu phiếu âm: báo số tiền dương, không in dấu trừ', async () => {
      const { svc, prisma, notify } = build();
      prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
      prisma.merchantPayout.findUnique.mockResolvedValue({ id: 'p1', status: 'PAID', amount: -80_236, storefront: { ownerUserId: 'u1' } });
      await svc.markPayoutPaid('admin-1', 'p1', 'FT9');
      expect(notify).toHaveBeenCalledWith('u1', 'MERCHANT_PAYOUT_PAID', { amount: '80.236', bank_ref: 'FT9' });
    });
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

  it('huỷ phiếu chưa chuyển: các đơn quay lại bảng kê (xoá dòng), lưu lý do và ảnh chụp dòng, không đè ghi chú', async () => {
    const { svc, prisma } = build();
    prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantPayoutLine.findMany.mockResolvedValue([PAYOUT_LINE, { ...PAYOUT_LINE, id: 'l2', kind: 'REVERSAL', refKey: 'RETURN:r1' }]);
    await svc.cancelPayout('admin-1', 'p1', '  Sai số tài khoản nhận  ');
    expect(prisma.merchantPayoutLine.deleteMany).toHaveBeenCalledWith({ where: { payoutId: 'p1' } });
    const data = prisma.merchantPayout.updateMany.mock.calls[0][0].data;
    expect(data).toEqual({
      status: 'CANCELLED',
      cancelledAt: expect.any(Date),
      cancelledBy: 'admin-1',
      cancelReason: 'Sai số tài khoản nhận',
      cancelSnapshot: expect.objectContaining({ lineCount: 2, orderCount: 1 }),
    });
    expect(data).not.toHaveProperty('note');
    expect(JSON.stringify(data)).not.toContain('Huỷ bởi');
    expect(data.cancelSnapshot.lines[0]).toEqual(expect.objectContaining({ id: 'l1', orderCode: 'TUBU1', kind: 'SALE', netAmount: 210_000, item: null }));
    expect(data.cancelSnapshot.lines[0]).not.toHaveProperty('payoutId');
  });

  it('huỷ phiếu: báo gian hàng kèm lý do (phiếu dương) hoặc kèm dặn chưa cần nộp (phiếu âm)', async () => {
    const a = build();
    a.prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    await a.svc.cancelPayout('admin-1', 'p1', 'Sai số tài khoản nhận');
    expect(a.notify).toHaveBeenCalledWith('u1', 'MERCHANT_PAYOUT_CANCELLED', { amount: '200.000', created: '10/10/2026', reason: 'Sai số tài khoản nhận' });

    const b = build();
    b.prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    b.prisma.merchantPayout.findUnique.mockResolvedValue({ storefrontId: 'sf-a', amount: -80_236, createdAt: CREATED, storefront: { ownerUserId: 'u1' } });
    await b.svc.cancelPayout('admin-1', 'p1', 'Lập nhầm kỳ');
    expect(b.notify).toHaveBeenCalledWith('u1', 'MERCHANT_PAYOUT_CANCELLED_TO_TUBU', { amount: '80.236', created: '10/10/2026', reason: 'Lập nhầm kỳ' });
  });

  it('huỷ phiếu thiếu lý do (rỗng, toàn khoảng trắng) → 400, không mở transaction, không báo', async () => {
    const { svc, prisma, notify } = build();
    await expect(svc.cancelPayout('admin-1', 'p1', '   ')).rejects.toThrow('Cần nhập lý do huỷ phiếu để báo gian hàng.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('phiếu vừa được đánh dấu đã chuyển (không còn PENDING) → 409, không xoá dòng, không báo huỷ', async () => {
    const { svc, prisma, notify } = build();
    prisma.merchantPayout.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.cancelPayout('admin-1', 'p1', 'Lập nhầm')).rejects.toThrow(ConflictException);
    expect(prisma.merchantPayoutLine.deleteMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('không huỷ được phiếu chứa SALE của đơn đã có dòng đảo ở phiếu khác (đối tác sẽ bị trừ tiền chưa từng nhận)', async () => {
    const { svc, prisma, notify } = build();
    prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantPayoutLine.findMany.mockResolvedValue([{ ...PAYOUT_LINE, orderId: 'o9' }]);
    prisma.merchantPayoutLine.findFirst.mockResolvedValue({ orderCode: 'TUBU9' });
    await expect(svc.cancelPayout('admin-1', 'p1', 'Lập nhầm')).rejects.toThrow(ConflictException);
    expect(prisma.merchantPayoutLine.deleteMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('phiếu đã huỷ hiện lại các dòng từ ảnh chụp kèm lý do, không lộ ảnh chụp thô', () => {
    const view = withLineItems({
      status: 'CANCELLED',
      lines: [],
      cancelSnapshot: { lineCount: 2, orderCount: 1, lines: [{ id: 'l1', orderCode: 'TUBU1', netAmount: 210_000 }] },
    });
    expect(view.lines).toEqual([{ id: 'l1', orderCode: 'TUBU1', netAmount: 210_000 }]);
    expect(view).toMatchObject({ cancelledLineCount: 2, cancelledOrderCount: 1 });
    expect(view).not.toHaveProperty('cancelSnapshot');
    const live = withLineItems({ status: 'PENDING', lines: [{ id: 'l1', orderItem: { productName: 'Trà', variationName: null, quantity: 2 } }] });
    expect(live.lines).toEqual([{ id: 'l1', item: { productName: 'Trà', variationName: null, quantity: 2 } }]);
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
    const order = { id: 'o', code: 'C', total: 100_000, shippingFee: 0, merchantCommissionPct: new Prisma.Decimal('0.15'), items: [{ id: 'i', total: 100_000, quantity: 3 }] };
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

  it('phiếu đã huỷ xếp theo mốc huỷ với phiếu cũ chưa có mốc (NULL) xuống cuối, nên phiếu vừa huỷ luôn nằm trong số được hiện', async () => {
    const { svc, prisma } = build();
    const findMany = jest.fn().mockResolvedValue([]);
    (prisma as unknown as { merchantPayout: { findMany: jest.Mock } }).merchantPayout.findMany = findMany;
    (prisma.order.findMany as jest.Mock).mockResolvedValue([]);
    await svc.myStatement('u1');
    const cancelledQuery = findMany.mock.calls.map((c) => c[0]).find((q) => q.where.status === 'CANCELLED');
    expect(cancelledQuery.orderBy).toEqual([{ cancelledAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }]);
  });
});

describe('Q8: hàng "Tubu giao hộ" vào bảng kê theo từng dòng hàng', () => {
  const CREATED = new Date('2026-09-20T00:00:00Z');
  const items = (id: string) => [
    { id: `${id}-a`, orderId: id, variationId: 'vA', productName: 'Mật ong', variationName: 'Hũ', quantity: 2, total: 120_000 },
    { id: `${id}-b`, orderId: id, variationId: 'vB', productName: 'Xà bông', variationName: 'Bánh', quantity: 1, total: 50_000 },
    { id: `${id}-c`, orderId: id, variationId: 'vC', productName: 'Hàng Tubu', variationName: 'Chai', quantity: 1, total: 30_000 },
  ];
  const pending = (orderItemId: string, orderId: string, deliveredAt: Date, createdAt = CREATED) => ({
    orderItemId,
    orderId,
    code: orderId.toUpperCase(),
    total: 195_000,
    shippingFee: 25_000,
    createdAt,
    deliveredAt,
  });
  const queryOf = (call: unknown[]) => Prisma.sql(call[0] as readonly string[], ...(call.slice(1) as Prisma.Sql[]));
  const sqlOf = (call: unknown[]) => queryOf(call).sql;

  it('mốc bắt đầu đối soát giao hộ sai (2026-13-01): không lỗi 500, tạm không giới hạn, ghi cảnh báo một lần (Q8 review S6)', async () => {
    const { svc, prisma } = withLinks();
    const warn = jest.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    prisma.systemConfig.findUnique.mockResolvedValue({ value: '2026-13-01' });
    await expect(svc.statementFor('sf-a', NOW)).resolves.toMatchObject({ lines: [] });
    await expect(svc.statementFor('sf-a', NOW)).resolves.toMatchObject({ lines: [] });
    const pendingSql = prisma.$queryRaw.mock.calls.map((c: unknown[]) => sqlOf(c)).filter((q: string) => q.includes('merchant_pancake_links'));
    expect(pendingSql.length).toBeGreaterThan(0);
    for (const q of pendingSql) expect(q).not.toContain('system_configs');
    expect(warn.mock.calls.filter(([m]) => String(m).includes('merchant.consignment_settle_from'))).toHaveLength(1);
  });

  function withLinks() {
    const b = build();
    b.prisma.merchantPancakeLink.findMany.mockResolvedValue([{ id: 'l1' }]);
    b.prisma.storefront.findUnique.mockResolvedValue({ commissionPct: new Prisma.Decimal('0.1'), consignmentFeePct: new Prisma.Decimal('0.02'), consignmentFeeFixed: 3_400 });
    return b;
  }

  it('đủ 7 ngày → bảng kê (A 87.360, B 36.400); chưa đủ → sắp đủ hạn; chỉ dòng SQL trả về là của gian hàng', async () => {
    const { svc, prisma } = withLinks();
    const dueAt = new Date(NOW.getTime() - 10 * 24 * H);
    const soonAt = new Date(NOW.getTime() - 2 * 24 * H);
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pending('o1-a', 'o1', dueAt), pending('o1-b', 'o1', dueAt), pending('o2-a', 'o2', soonAt)])
      .mockResolvedValueOnce([]);
    prisma.orderItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([...items('o1'), ...items('o2')]);
    prisma.systemConfig.findUnique.mockResolvedValue({ value: '2026-10-01T00:00:00Z' });
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.consignmentTerms).toEqual({ commissionPct: 0.1, feePct: 0.02, feeFixed: 3_400 });
    expect(st.lines.map((l) => [l.refKey, l.orderItemId, l.goodsAmount, l.commissionAmount, l.opsFeeAmount, l.netAmount])).toEqual([
      ['ITEM:o1-a', 'o1-a', 102_000, 10_200, 4_440, 87_360],
      ['ITEM:o1-b', 'o1-b', 42_500, 4_250, 1_850, 36_400],
    ]);
    expect(st.total).toBe(123_760);
    expect(st.upcoming.map((l) => [l.refKey, l.availableAt])).toEqual([['ITEM:o2-a', new Date(soonAt.getTime() + 7 * 24 * H)]]);
    const sql = sqlOf(prisma.$queryRaw.mock.calls[1]);
    expect(sql).toContain(`(o."paymentStatus" = 'PAID' OR o."paymentMethod" = 'COD')`);
    expect(sql).toContain(`AND o."createdAt" >= ?\n`);
    expect(queryOf(prisma.$queryRaw.mock.calls[1]).values).toContainEqual(new Date('2026-10-01T00:00:00Z'));
    expect(sql).toContain(`(NOT l."takeover" OR (l."consignmentConfirmedAt" IS NOT NULL AND o."createdAt" >= l."consignmentConfirmedAt"))`);
    expect(sql).toContain(`(l."unlinkedAt" IS NULL OR o."createdAt" < l."unlinkedAt")`);
    expect(sql).toContain(`FROM "order_status_history" h WHERE h."orderId" = o."id" AND h."toStatus" = 'DELIVERED'`);
    expect(prisma.orderItem.findMany.mock.calls[1][0].where).toEqual({ orderId: { in: ['o1', 'o2'] } });
  });

  it('hàng giao hộ chưa vào đối soát tự động (đặt trước mốc, liên kết takeover chưa xác nhận): danh sách chỉ đọc kèm lý do và tiền khách trả cho món (Q8 review S5)', async () => {
    const { svc, prisma } = withLinks();
    prisma.systemConfig.findUnique.mockResolvedValue({ value: '2026-10-01T00:00:00Z' });
    const confirmedAt = new Date('2026-10-08T00:00:00Z');
    prisma.$queryRaw.mockResolvedValueOnce([
      { orderItemId: 'o1-b', orderId: 'o1', beforeSettleFrom: true, confirmedAt: null, linkPending: false, total: 3 },
      { orderItemId: 'o2-a', orderId: 'o2', beforeSettleFrom: false, confirmedAt: null, linkPending: true, total: 3 },
      { orderItemId: 'o3-a', orderId: 'o3', beforeSettleFrom: false, confirmedAt, linkPending: false, total: 3 },
    ]);
    prisma.order.findMany.mockResolvedValueOnce([
      { id: 'o1', code: 'TUBU1', total: 195_000, shippingFee: 25_000, createdAt: new Date('2026-09-20T00:00:00Z'), deliveredAt: new Date('2026-09-22T00:00:00Z'), items: items('o1') },
      { id: 'o2', code: 'TUBU2', total: 195_000, shippingFee: 25_000, createdAt: new Date('2026-10-05T00:00:00Z'), deliveredAt: null, items: items('o2') },
      { id: 'o3', code: 'TUBU3', total: 195_000, shippingFee: 25_000, createdAt: new Date('2026-10-06T00:00:00Z'), deliveredAt: null, items: items('o3') },
    ]);
    const out = await svc.consignmentExcluded('sf-a');
    expect(out.total).toBe(3);
    expect(out.settleFrom).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(out.lines.map((l) => [l.orderCode, l.orderItemId, l.reason, l.linkPending, l.goodsAmount, l.quantity, l.confirmedAt])).toEqual([
      ['TUBU1', 'o1-b', 'BEFORE_SETTLE_FROM', false, 42_500, 1, null],
      ['TUBU2', 'o2-a', 'TAKEOVER_UNCONFIRMED', true, 102_000, 2, null],
      // R4-PARTNER-3: liên kết đã xác nhận hàng ký gửi nhưng đơn đặt trước lúc xác nhận → đối soát riêng ngoài phiếu, không còn "chờ xác nhận".
      ['TUBU3', 'o3-a', 'TAKEOVER_BEFORE_CONFIRM', false, 102_000, 2, confirmedAt],
    ]);
    const sql = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(sql).toContain('NOT (');
    expect(sql).toContain('LIMIT 200');
    expect(sql).toContain(`(NOT l."takeover" OR (l."consignmentConfirmedAt" IS NOT NULL AND o."createdAt" >= l."consignmentConfirmedAt"))`);
    expect(sql).toContain(`l."takeover" AND l."consignmentConfirmedAt" IS NULL AND l."unlinkedAt" IS NULL`);
  });

  it('phí đổi sau khi đặt: dòng tính theo mức hiệu lực lúc đặt đơn, không theo mức hiện tại', async () => {
    const { svc, prisma } = withLinks();
    prisma.storefront.findUnique.mockResolvedValue({ commissionPct: new Prisma.Decimal('0.3'), consignmentFeePct: new Prisma.Decimal('0.05'), consignmentFeeFixed: 9_000 });
    prisma.storefrontTermsHistory.findMany.mockResolvedValue([
      { commissionPct: new Prisma.Decimal('0.1'), consignmentFeePct: new Prisma.Decimal('0.02'), consignmentFeeFixed: 3_400, effectiveFrom: new Date(0) },
      { commissionPct: new Prisma.Decimal('0.3'), consignmentFeePct: new Prisma.Decimal('0.05'), consignmentFeeFixed: 9_000, effectiveFrom: new Date('2026-10-01T00:00:00Z') },
    ]);
    const dueAt = new Date(NOW.getTime() - 10 * 24 * H);
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([pending('o1-a', 'o1', dueAt)]).mockResolvedValueOnce([]);
    prisma.orderItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(items('o1'));
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.consignmentTerms).toEqual({ commissionPct: 0.3, feePct: 0.05, feeFixed: 9_000 });
    expect(st.lines.map((l) => [l.commissionAmount, l.opsFeeAmount, l.netAmount])).toEqual([[10_200, 2_040 + 3_400, 86_360]]);
  });

  it('gian hàng không đặt phí sàn riêng → merchant.commission_pct; mặc định không có phí giao hộ', async () => {
    const { svc, prisma } = withLinks();
    prisma.storefront.findUnique.mockResolvedValue({ commissionPct: null, consignmentFeePct: new Prisma.Decimal(0), consignmentFeeFixed: 0 });
    (svc as unknown as { config: unknown }).config = { get: jest.fn(async (k: string, fb: unknown) => (k === 'merchant.commission_pct' ? 0.12 : fb)) };
    await expect(svc.consignmentTerms('sf-a')).resolves.toEqual({ commissionPct: 0.12, feePct: 0, feeFixed: 0 });
  });

  it('gian hàng chưa có liên kết nào → không có phần giao hộ, không chạy truy vấn giao hộ', async () => {
    const { svc, prisma } = build();
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.consignmentTerms).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('dòng đã vào phiếu: trả một phần mới duyệt → REVERSAL RETURN:<id>:ITEM:<dòng>; đơn RETURNED → đảo phần còn lại ITEM:<dòng>', async () => {
    const { svc, prisma } = withLinks();
    prisma.orderItem.findMany.mockResolvedValueOnce([{ id: 'o1-a' }]).mockResolvedValueOnce([
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
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ orderItemId: 'o1-a' }]);
    prisma.returnRequestItem.findMany.mockResolvedValue([{ orderItemId: 'o1-a', quantity: 1, returnRequest: { id: 'rr1', reviewedAt: NOW } }]);
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.lines.map((l) => [l.kind, l.refKey, l.netAmount])).toEqual([
      ['REVERSAL', 'RETURN:rr1:ITEM:o1-a', -43_680],
      ['REVERSAL', 'ITEM:o1-a', -43_680],
    ]);
    expect(prisma.orderItem.findMany.mock.calls[0][0].where).toEqual({
      order: { status: 'RETURNED' },
      merchantPayoutLines: { some: { kind: 'SALE', payout: { storefrontId: 'sf-a' } }, none: { kind: 'REVERSAL', refKey: { startsWith: 'ITEM:' } } },
    });
  });

  function payoutReady() {
    const b = withLinks();
    const dueAt = new Date(NOW.getTime() - 10 * 24 * H);
    b.prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([pending('o1-a', 'o1', dueAt)]).mockResolvedValueOnce([]);
    b.prisma.orderItem.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(items('o1'));
    b.prisma.storefront.findUnique
      .mockResolvedValueOnce({ ...STORE, bankName: 'VCB', bankAccountNo: '1', bankAccountName: 'A' })
      .mockResolvedValue({ commissionPct: new Prisma.Decimal('0.1'), consignmentFeePct: new Prisma.Decimal('0.02'), consignmentFeeFixed: 3_400 });
    b.prisma.merchantPayout.create.mockResolvedValue({ id: 'p1', amount: 86_360, lines: [{}] });
    return b;
  }

  it('lập phiếu: khoá gian hàng trong transaction rồi mới tính bảng kê; lưu dòng hàng và phí giao hộ của từng dòng', async () => {
    const { svc, prisma } = payoutReady();
    await svc.createPayout('admin-1', 'sf-a', undefined, 86_360);
    expect(sqlOf(prisma.$executeRaw.mock.calls[0])).toContain('pg_advisory_xact_lock(hashtext(');
    expect(prisma.$executeRaw.mock.calls[0][1]).toBe('merchant-payout:sf-a');
    expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[0]!);
    const data = prisma.merchantPayout.create.mock.calls[0][0].data;
    expect(data.amount).toBe(86_360);
    expect(data.lines.create).toEqual([
      expect.objectContaining({ orderId: 'o1', kind: 'SALE', refKey: 'ITEM:o1-a', orderItemId: 'o1-a', shippingFee: 0, codCollected: 0, opsFeeAmount: 5_440, netAmount: 86_360 }),
    ]);
  });

  it('lập phiếu với tổng xem trước khác tổng hiện tại → 409, không tạo phiếu', async () => {
    const { svc, prisma } = payoutReady();
    await expect(svc.createPayout('admin-1', 'sf-a', undefined, 90_000)).rejects.toThrow(
      'Số tiền chờ đối soát vừa thay đổi (90.000đ → 86.360đ). Tải lại bảng kê rồi lập phiếu.',
    );
    expect(prisma.merchantPayout.create).not.toHaveBeenCalled();
  });

  it('huỷ phiếu: khoá cùng gian hàng; dòng giao hộ chỉ bị chặn bởi dòng đảo của CHÍNH dòng hàng đó ở phiếu khác', async () => {
    const { svc, prisma } = build();
    prisma.merchantPayout.updateMany.mockResolvedValue({ count: 1 });
    prisma.merchantPayoutLine.findMany.mockResolvedValue([
      { ...PAYOUT_LINE, id: 'l1', orderId: 'o1', orderItemId: 'o1-a', orderItem: { productName: 'Trà', variationName: null, quantity: 1 } },
      { ...PAYOUT_LINE, id: 'l2', orderId: 'o9', orderItemId: null },
    ]);
    await svc.cancelPayout('admin-1', 'p1', 'Lập nhầm');
    expect(prisma.$executeRaw.mock.calls[0][1]).toBe('merchant-payout:sf-a');
    expect(prisma.merchantPayoutLine.findFirst.mock.calls[0][0].where).toEqual({
      kind: 'REVERSAL',
      payoutId: { not: 'p1' },
      OR: [{ orderId: { in: ['o9'] }, orderItemId: null }, { orderItemId: { in: ['o1-a'] } }],
    });
    expect(prisma.merchantPayoutLine.deleteMany).toHaveBeenCalledWith({ where: { payoutId: 'p1' } });
  });

  it('huỷ phiếu không tồn tại → 409, không mở transaction', async () => {
    const { svc, prisma } = build();
    prisma.merchantPayout.findUnique.mockResolvedValue(null);
    await expect(svc.cancelPayout('admin-1', 'p-x', 'Lập nhầm')).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('tổng quan admin: gồm gian hàng chỉ có hàng giao hộ; chỉ dựng bảng kê cho gian hàng có khoản chờ; đơn đang xử lý đếm gộp', async () => {
    const { svc, prisma } = build();
    prisma.merchantPancakeLink.findMany.mockImplementation(async (args: { distinct?: string[] }) =>
      args.distinct ? [{ storefrontId: 'sf-c' }] : [],
    );
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'sf-d' }]);
    prisma.order.groupBy.mockResolvedValue([{ fulfillerStorefrontId: 'sf-d', _count: { _all: 3 } }]);
    prisma.storefront.findMany.mockResolvedValue([
      { id: 'sf-c', title: 'Giao hộ', type: 'MERCHANT', isPartner: false, owner: null, commissionPct: null, consignmentFeePct: new Prisma.Decimal('0.02'), consignmentFeeFixed: 3_400 },
      { id: 'sf-d', title: 'Tự giao', type: 'CTV', isPartner: true, owner: null, commissionPct: new Prisma.Decimal('0.1'), consignmentFeePct: new Prisma.Decimal(0), consignmentFeeFixed: 0 },
    ]);
    const spy = jest.spyOn(svc, 'statementFor').mockResolvedValue({ lines: [{ orderItemId: 'x', netAmount: 5 }], total: 5 } as never);
    const res = await svc.adminOverview(NOW);
    expect(prisma.storefront.findMany.mock.calls[0][0].where).toEqual({
      AND: [
        { OR: [{ OR: [{ type: 'MERCHANT' }, { isPartner: true }] }, { id: { in: ['sf-d'] } }] },
        { OR: [{ isPartner: true }, { fulfilledOrders: { some: {} } }, { id: { in: ['sf-c'] } }] },
      ],
    });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['sf-d']);
    expect(prisma.order.groupBy).toHaveBeenCalledTimes(1);
    expect(res.defaultCommissionPct).toBe(0.15);
    expect(res.stores).toEqual([
      expect.objectContaining({ storefrontId: 'sf-c', type: 'MERCHANT', isPartner: false, activeOrders: 0, settleableLines: 0, settleableAmount: 0, consignmentFeePct: 0.02, consignmentFeeFixed: 3_400 }),
      expect.objectContaining({ storefrontId: 'sf-d', type: 'CTV', isPartner: true, activeOrders: 3, settleableLines: 1, settleableAmount: 5, consignmentLines: 1, commissionPct: 0.1 }),
    ]);
    const candidates = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(candidates).toContain('UNION');
    expect(candidates).toContain('lk."storefrontId"');
  });

  it('admin sửa phí: chỉ gian hàng đối tác; ghi mốc gốc khi chưa có lịch sử rồi thêm dòng mới có người sửa; phí sàn theo mặc định lưu số đã quy ra (Q8 review S1)', async () => {
    const { svc, prisma } = build();
    prisma.storefront.findUnique.mockResolvedValueOnce({ type: 'CTV' });
    await expect(svc.updateStoreTerms('admin-1', 'sf-x', { consignmentFeePct: 0.01 })).rejects.toThrow(NotFoundException);
    const old = { commissionPct: new Prisma.Decimal('0.1'), consignmentFeePct: new Prisma.Decimal(0), consignmentFeeFixed: 0 };
    prisma.storefront.findUnique.mockResolvedValueOnce({ type: 'MERCHANT', ...old });
    prisma.storefront.update.mockResolvedValue({ id: 'sf-a', commissionPct: null, consignmentFeePct: new Prisma.Decimal(0), consignmentFeeFixed: 2_000 });
    await svc.updateStoreTerms('admin-1', 'sf-a', { commissionPct: null, consignmentFeeFixed: 2_000 });
    expect(prisma.storefront.update.mock.calls[0][0].data).toEqual({ commissionPct: null, consignmentFeeFixed: 2_000 });
    const rows = prisma.storefrontTermsHistory.create.mock.calls.map((c) => c[0].data);
    expect(rows).toEqual([
      { storefrontId: 'sf-a', ...old, effectiveFrom: new Date(0) },
      expect.objectContaining({ storefrontId: 'sf-a', commissionPct: 0.15, consignmentFeeFixed: 2_000, changedById: 'admin-1' }),
    ]);
    expect(rows[1].effectiveFrom).toBeInstanceOf(Date);

    // Mặc định đọc thẳng DB trong transaction (bộ nhớ đệm cấu hình có thể cũ), mốc gốc của gian hàng đang theo mặc định cũng
    // lưu số.
    prisma.storefrontTermsHistory.create.mockClear();
    prisma.systemConfig.findUnique.mockResolvedValueOnce({ value: 0.2 });
    prisma.storefront.findUnique.mockResolvedValueOnce({ type: 'MERCHANT', ...old, commissionPct: null });
    await svc.updateStoreTerms('admin-1', 'sf-a', { consignmentFeeFixed: 2_000 });
    expect(prisma.systemConfig.findUnique).toHaveBeenLastCalledWith({ where: { key: 'merchant.commission_pct' }, select: { value: true } });
    expect(prisma.storefrontTermsHistory.create.mock.calls.map((c) => c[0].data.commissionPct)).toEqual([0.2, 0.2]);

    prisma.storefrontTermsHistory.create.mockClear();
    prisma.storefrontTermsHistory.count.mockResolvedValue(2);
    prisma.storefront.findUnique.mockResolvedValueOnce({ type: 'MERCHANT', ...old });
    await svc.updateStoreTerms('admin-1', 'sf-a', { consignmentFeePct: 0.01 });
    expect(prisma.storefrontTermsHistory.create).toHaveBeenCalledTimes(1);
  });

  it('xác nhận hàng ký gửi: chỉ liên kết takeover còn hiệu lực; bấm lại không đổi mốc', async () => {
    const { svc, prisma } = build();
    prisma.merchantPancakeLink.findUnique.mockResolvedValueOnce(null);
    await expect(svc.confirmConsignment('admin-1', 'l0')).rejects.toThrow(NotFoundException);
    prisma.merchantPancakeLink.findUnique.mockResolvedValueOnce({ variationId: 'v1' }).mockResolvedValueOnce({ takeover: false, unlinkedAt: null });
    await expect(svc.confirmConsignment('admin-1', 'l1')).rejects.toThrow(BadRequestException);
    prisma.merchantPancakeLink.findUnique.mockResolvedValueOnce({ variationId: 'v1' }).mockResolvedValueOnce({ takeover: true, unlinkedAt: NOW });
    await expect(svc.confirmConsignment('admin-1', 'l2')).rejects.toThrow('Liên kết đã gỡ.');
    prisma.merchantPancakeLink.findUnique.mockResolvedValueOnce({ variationId: 'v1' }).mockResolvedValueOnce({ takeover: true, unlinkedAt: null });
    prisma.$queryRaw.mockClear();
    await svc.confirmConsignment('admin-1', 'l3');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const lock = prisma.$queryRaw.mock.calls[0] as [string[], ...unknown[]];
    expect(lock[0].join('?')).toContain('FOR NO KEY UPDATE');
    expect(lock[1]).toBe('v1');
    // mốc xác nhận lấy SAU khi giành khoá biến thể
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.merchantPancakeLink.updateMany.mock.invocationCallOrder[0]!);
    expect(prisma.merchantPancakeLink.updateMany).toHaveBeenCalledWith({
      where: { id: 'l3', consignmentConfirmedAt: null },
      data: { consignmentConfirmedAt: expect.any(Date), consignmentConfirmedBy: 'admin-1' },
    });
  });
});

describe('R4-ADMIN-7: việc admin phải làm với đối tác', () => {
  it('listPayouts lọc theo trạng thái để phiếu chờ chuyển/thu cũ không bị đẩy khỏi trang đầu', async () => {
    const { svc, prisma } = build();
    const mp = prisma.merchantPayout as unknown as { count: jest.Mock; findMany: jest.Mock };
    mp.count = jest.fn().mockResolvedValue(1);
    mp.findMany = jest.fn().mockResolvedValue([]);

    await svc.listPayouts(undefined, 1, 20, 'PENDING');
    expect(mp.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
    expect(mp.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING' } }));

    await svc.listPayouts('sf-a', 1, 20);
    expect(mp.count).toHaveBeenLastCalledWith({ where: { storefrontId: 'sf-a' } });
  });

  it('countStoresToSettle chỉ đếm gian hàng thật sự có dòng đủ hạn trong bảng kê', async () => {
    const { svc, prisma } = build();
    const internals = svc as unknown as { storesWithPending: jest.Mock; statementFor: jest.Mock; settlementConfig: jest.Mock };
    internals.storesWithPending = jest.fn().mockResolvedValue(new Set(['sf-a', 'sf-b', 'sf-c']));
    (prisma.storefront as unknown as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue(
      ['sf-a', 'sf-b', 'sf-c'].map((id) => ({ id, type: 'MERCHANT', isPartner: true })),
    );
    internals.settlementConfig = jest.fn().mockResolvedValue({ holdDays: 7, defaultCommissionPct: 0.15 });
    internals.statementFor = jest.fn(async (id: string) => ({ lines: id === 'sf-b' ? [] : [{ netAmount: 1 }] }));

    await expect(svc.countStoresToSettle(NOW)).resolves.toBe(2);
    expect(internals.statementFor).toHaveBeenCalledWith('sf-a', NOW, expect.anything(), { holdDays: 7, defaultCommissionPct: 0.15 });
  });

  it('countStoresToSettle: gian hàng đã tắt cờ chỉ tính khi có dòng REVERSAL của đơn đã có SALE đã lưu (SALE không đếm)', async () => {
    const { svc, prisma } = build();
    const internals = svc as unknown as { storesWithPending: jest.Mock; statementFor: jest.Mock; settlementConfig: jest.Mock };
    internals.storesWithPending = jest.fn().mockResolvedValue(new Set(['off-sale', 'off-rev']));
    internals.settlementConfig = jest.fn().mockResolvedValue({ holdDays: 7, defaultCommissionPct: 0.15 });
    (prisma.storefront as unknown as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([
      { id: 'off-sale', type: 'CTV', isPartner: false },
      { id: 'off-rev', type: 'CTV', isPartner: false },
    ]);
    (prisma.merchantPayoutLine as unknown as { findMany: jest.Mock }).findMany = jest.fn().mockResolvedValue([{ orderId: 'o-rev', orderItemId: null }]);
    internals.statementFor = jest.fn(async (id: string) => ({
      lines: [
        id === 'off-sale'
          ? { kind: 'SALE', netAmount: 5, orderId: 'o-sale', orderItemId: null }
          : { kind: 'REVERSAL', netAmount: -5, orderId: 'o-rev', orderItemId: null },
      ],
    }));

    await expect(svc.countStoresToSettle(NOW)).resolves.toBe(1);
    expect((prisma.merchantPayoutLine as unknown as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith({
      where: { kind: 'SALE', OR: [{ orderId: { in: ['o-rev'] }, orderItemId: null }, { orderItemId: { in: [] } }] },
      select: { orderId: true, orderItemId: true },
    });
  });

  it('openLinesOf: dòng REVERSAL giao hộ chỉ thu khi chính dòng hàng đó có SALE đã lưu; hỏi DB theo đúng orderItemId', async () => {
    const { svc, prisma } = build();
    const findMany = jest.fn().mockResolvedValue([{ orderId: 'o-c', orderItemId: 'it-a' }]);
    (prisma.merchantPayoutLine as unknown as { findMany: jest.Mock }).findMany = findMany;
    const line = (orderItemId: string | null, orderId = 'o-c') => ({ kind: 'REVERSAL', netAmount: -10, orderId, orderItemId });
    const lines = [line('it-a'), line('it-b'), line(null, 'o-self'), { kind: 'SALE', netAmount: 5, orderId: 'o-c', orderItemId: 'it-a' }];
    const internals = svc as unknown as { openLinesOf: (s: { type: string; isPartner: boolean }, l: typeof lines) => Promise<{ lines: typeof lines; total: number }> };

    const off = await internals.openLinesOf({ type: 'CTV', isPartner: false }, lines);
    expect(off.lines.map((l) => l.orderItemId)).toEqual(['it-a']);
    expect(off.total).toBe(-10);
    expect(findMany).toHaveBeenCalledWith({
      where: { kind: 'SALE', OR: [{ orderId: { in: ['o-self'] }, orderItemId: null }, { orderItemId: { in: ['it-a', 'it-b'] } }] },
      select: { orderId: true, orderItemId: true },
    });

    findMany.mockClear();
    const partner = await internals.openLinesOf({ type: 'CTV', isPartner: true }, lines);
    expect(partner.lines).toHaveLength(4);
    expect(findMany).not.toHaveBeenCalled();
  });
});
