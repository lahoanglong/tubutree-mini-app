import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MerchantFulfilmentService, saleLineOf, slaStateOf } from './merchant-fulfilment.service';
import { MerchantSlaCron } from './merchant-sla.cron';
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
    storefront: { findFirst: jest.fn().mockResolvedValue(STORE), findUnique: jest.fn() },
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    merchantPayout: { create: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    merchantPayoutLine: { deleteMany: jest.fn() },
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

describe('MerchantFulfilmentService — phiếu đối soát', () => {
  const delivered = {
    id: 'o9',
    code: 'TUBU9',
    paymentMethod: 'WALLET',
    total: 230_000,
    shippingFee: 30_000,
    merchantCommissionPct: 0.15,
    deliveredAt: new Date(NOW.getTime() - 10 * 24 * H),
    items: [{ total: 200_000 }],
  };

  it('bảng kê: đơn giao quá hạn giữ chưa đối soát (SALE) + đơn đã đối soát rồi bị trả (REVERSAL âm)', async () => {
    const { svc, prisma } = build();
    prisma.order.findMany
      .mockResolvedValueOnce([delivered])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'o5', code: 'TUBU5', merchantPayoutLines: [{ goodsAmount: 100, shippingFee: 10, commissionAmount: 15, codCollected: 0, netAmount: 95 }] },
      ]);
    const st = await svc.statementFor('sf-a', NOW);
    expect(st.lines.map((l) => [l.orderCode, l.kind, l.netAmount])).toEqual([
      ['TUBU9', 'SALE', 200_000 + 30_000 - 30_000],
      ['TUBU5', 'REVERSAL', -95],
    ]);
    expect(st.total).toBe(200_000 - 95);
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
});
