import { Test } from '@nestjs/testing';
import { OrderReversalService } from './order-reversal.service';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { CouponsService } from '../coupons/coupons.service';
import { DealerService } from '../dealer/dealer.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';
import { NO_PARTIAL_RETURNS } from './return-ledger';
import { WALLET_DESTINATION } from './refund-destination';

// Sổ cái thật (khoá dòng + wallet_transactions) chạy trên Postgres ở
// test/integration-race/wallet-ledger*.race-spec.ts. Ở đây thay bằng đúng tác động số dư của nó
// (increment walletBalance trên tx) để các mock tx sẵn có vẫn đo được tiền vào ví.
jest.mock('../wallet/wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn(
    async (tx: { user: { update: (a: unknown) => Promise<unknown> } }, input: { userId: string; delta: number }) => {
      await tx.user.update({ where: { id: input.userId }, data: { walletBalance: { increment: input.delta } } });
      return { applied: true, balanceAfter: 0, entryId: 'wtx' };
    },
  ),
}));

/** DealerService giả — mặc định không có thưởng quý nào để thu hồi. */
const noopDealer = () => ({
  clawbackQuarterBonusForOrder: jest.fn().mockResolvedValue({ quarter: null, clawedBack: 0 }),
});

type MockTx = {
  /** Dòng `orders` đang nằm trong "DB" — updateMany chỉ sửa khi `where` khớp nó (như Postgres). */
  row: { paymentStatus: string };
  order: { updateMany: jest.Mock };
  user: { update: jest.Mock };
  coinTransaction: { create: jest.Mock; findMany: jest.Mock };
  pointsTransaction: { findMany: jest.Mock; createManyAndReturn: jest.Mock };
  orderCustomerRefund: { create: jest.Mock; createMany: jest.Mock };
  returnRequest: { findMany: jest.Mock };
  /** Đánh giá có thưởng của đơn (thu hồi khi trả hàng); mặc định không có. */
  review: { findMany: jest.Mock };
  /** Hoàn kho đi bằng SQL thô (catalog/variation-stock.ts) để sửa 3 cột nguyên tử. */
  $executeRaw: jest.Mock;
  dealerCreditLedger: { findFirst: jest.Mock; create: jest.Mock };
  orderItem: { update: jest.Mock };
  $queryRaw: jest.Mock;
};

/**
 * tx giả phản ánh ĐÚNG guard thật: `updateMany where paymentStatus:'PAID'` chỉ count=1 khi dòng trong
 * DB đang PAID — bản cũ trả count=1 cho mọi thứ nên đơn UNPAID cũng "thắng guard hoàn tiền" và test
 * không phân biệt được ảnh chụp với DB. Mặc định DB = ảnh chụp `order.paymentStatus`; test race truyền
 * `dbPaymentStatus` lệch ảnh chụp (admin xác nhận CK / webhook lật PAID sau khi caller đã đọc đơn).
 */
function makeTx(order: unknown, dbPaymentStatus?: string): MockTx {
  const row = { paymentStatus: dbPaymentStatus ?? (order as { paymentStatus: string }).paymentStatus };
  return {
    row,
    order: {
      updateMany: jest.fn(
        async ({ where, data }: { where: { id: string; paymentStatus?: string }; data: { paymentStatus?: string } }) => {
          if (where.paymentStatus !== undefined && where.paymentStatus !== row.paymentStatus) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    },
    user: { update: jest.fn().mockResolvedValue({}) },
    // Không có thưởng giới thiệu nào gắn với đơn → nhánh thu hồi không làm gì.
    coinTransaction: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    // PD-3: thưởng giới thiệu sau gộp nằm ở sổ điểm; thu hồi đọc cả hai sổ.
    pointsTransaction: {
      findMany: jest.fn().mockResolvedValue([]),
      // PD-3: hoàn đơn XU cũ ghi lô CONVERTED bằng INSERT ... ON CONFLICT DO NOTHING (points-ledger.ts).
      createManyAndReturn: jest.fn().mockResolvedValue([{ id: 'ptx' }]),
    },
    orderCustomerRefund: { create: jest.fn().mockResolvedValue({ id: 'cr1' }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    // D3: đơn đã giao chưa có lần trả một phần nào.
    returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
    review: { findMany: jest.fn().mockResolvedValue([]) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    orderItem: { update: jest.fn().mockResolvedValue({}) },
    // Đọc lại backorderedQty dưới khoá dòng (FOR UPDATE) — mặc định DB = ảnh chụp.
    $queryRaw: jest.fn(async () =>
      ((order as { items?: { id: string; backorderedQty: number }[] }).items ?? []).map((i) => ({
        id: i.id,
        backorderedQty: i.backorderedQty,
      })),
    ),
  };
}

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    code: 'TUBU1',
    userId: 'u1',
    total: 150000,
    paymentMethod: 'WALLET',
    paymentStatus: 'PAID',
    // Trạng thái NGAY TRƯỚC lần đảo này (ảnh chụp mà caller truyền vào — xem OrderStatusService.
    // setStatus/admin.reviewReturn). Mặc định DELIVERED vì phần lớn test ở đây mô phỏng cảnh
    // huỷ/trả SAU khi giao; test COD "chưa giao" bên dưới tự override giá trị này.
    status: 'DELIVERED',
    couponCode: null,
    items: [
      { id: 'i1', variationId: 'v1', quantity: 2, flashSaleItemId: null, backorderedQty: 0 },
      { id: 'i2', variationId: 'v2', quantity: 1, flashSaleItemId: 'fs1', backorderedQty: 0 },
    ],
    ...overrides,
  } as never;
}

describe('OrderReversalService', () => {
  let service: OrderReversalService;
  let flashSale: { restore: jest.Mock };
  let coupons: { release: jest.Mock };

  beforeEach(async () => {
    flashSale = { restore: jest.fn().mockResolvedValue(undefined) };
    coupons = { release: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: flashSale },
        { provide: CouponsService, useValue: coupons },
      ],
    }).compile();
    service = module.get(OrderReversalService);
  });

  it('hoàn ví cho đơn WALLET đã PAID và restock từng dòng', async () => {
    const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', paymentStatus: 'PAID' },
      data: { paymentStatus: 'REFUNDED' },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { walletBalance: { increment: 150000 } },
    });
    expect(applyWalletDelta).toHaveBeenLastCalledWith(
      tx,
      expect.objectContaining({ userId: 'u1', delta: 150000, type: 'ORDER_REFUND', refType: 'ORDER', refId: 'o1' }),
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    // Tham số của câu UPDATE hoàn kho: (số lượng, số lượng, variationId).
    expect(tx.$executeRaw.mock.calls[0]!.slice(1)).toEqual([2, 2, 'v1']);
    expect(flashSale.restore).toHaveBeenCalledWith(tx, 'fs1', 'u1', 1);
    expect(flashSale.restore).toHaveBeenCalledTimes(1);
  });

  it('hoàn thẳng vào Ví → ghi dòng vết khoản hoàn (WALLET, COMPLETED) để chi tiết đơn của khách nói đã hoàn bao nhiêu, về đâu', async () => {
    const order = makeOrder({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', status: 'CONFIRMED' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);

    expect(tx.orderCustomerRefund.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          orderId: 'o1',
          kind: 'CANCEL',
          refKey: '',
          userId: 'u1',
          customerUserId: 'u1',
          amount: 150000,
          method: 'WALLET',
          status: 'COMPLETED',
          reason: 'CANCELLED',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('đơn chưa trả tiền → không ghi dòng vết khoản hoàn nào', async () => {
    const order = makeOrder({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    expect(tx.orderCustomerRefund.createMany).not.toHaveBeenCalled();
  });

  // PD-3 (spec 6.2, OQ-8): đơn XU cũ huỷ/trả sau gộp → hoàn đúng total Điểm Xanh lô quy đổi (1 điểm = 1đ).
  // Không cộng xu (users_coins_frozen), không về Ví (xu không ra tiền, Q-03a).
  it.each([
    [150000, 150000],
    [150001, 150001],
    [999, 999],
  ])('đơn XU cũ %iđ → +%i điểm lô CONVERTED (ORDER_REFUND_XU), không cộng xu, không hoàn Ví', async (total, points) => {
    const order = makeOrder({ paymentMethod: 'XU', paymentStatus: 'PAID', total });
    const tx = makeTx(order);
    (applyWalletDelta as jest.Mock).mockClear();
    const result = await service.reverseFinancials(tx as never, order);

    expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalledWith({
      data: [
        {
          userId: 'u1', delta: points, lot: 'CONVERTED', reason: 'ORDER_REFUND_XU:TUBU1',
          refType: 'ORDER', refId: 'o1', expiresAt: null,
        },
      ],
      skipDuplicates: true,
      select: { id: true },
    });
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: points } } });
    expect(tx.coinTransaction.create).not.toHaveBeenCalled();
    expect(applyWalletDelta).not.toHaveBeenCalled();
    // Xu cũ không ra tiền: không phải "đã hoàn vào Ví", mà là N Điểm Xanh để caller báo đúng câu.
    expect(result).toMatchObject({ moneyRefunded: false, pointsRefunded: points });
  });

  // Review B1: phần điểm lô CONVERTED (tiền trả trước) hoàn TRONG tx huỷ, cùng commit với việc lật trạng thái đơn.
  describe('hoàn lô CONVERTED trong tx huỷ (review B1)', () => {
    const convertedRow = (delta: number) => ({
      data: [
        {
          userId: 'u1', delta, lot: 'CONVERTED', reason: 'ORDER_REFUND_CONVERTED:TUBU1',
          refType: 'ORDER', refId: 'o1', expiresAt: null,
        },
      ],
      skipDuplicates: true,
      select: { id: true },
    });

    it('đơn WALLET đã tiêu 120/150 điểm lô quy đổi → hoàn Ví như cũ VÀ +120 CONVERTED trong cùng tx', async () => {
      const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID', pointsUsed: 150, pointsUsedConverted: 120 });
      const tx = makeTx(order);
      await service.reverseFinancials(tx as never, order);
      expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalledWith(convertedRow(120));
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: 120 } } });
    });

    it('đơn COD huỷ khi chưa giao (không có tiền để hoàn) vẫn hoàn lô CONVERTED', async () => {
      const order = makeOrder({
        paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'CONFIRMED', pointsUsed: 50, pointsUsedConverted: 50,
      });
      const tx = makeTx(order);
      (applyWalletDelta as jest.Mock).mockClear();
      await service.reverseFinancials(tx as never, order);
      expect(applyWalletDelta).not.toHaveBeenCalled();
      expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalledWith(convertedRow(50));
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: 50 } } });
    });

    it('pointsUsedConverted lớn hơn pointsUsed (dữ liệu lệch) → hoàn tối đa pointsUsed, không tạo điểm ra từ không khí', async () => {
      const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'CONFIRMED', pointsUsed: 30, pointsUsedConverted: 80 });
      const tx = makeTx(order);
      await service.reverseFinancials(tx as never, order);
      expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalledWith(convertedRow(30));
    });

    it('dòng ORDER_REFUND_CONVERTED đã có (khoá converted_refund_unique) → không cộng lần 2', async () => {
      const order = makeOrder({ pointsUsed: 150, pointsUsedConverted: 120 });
      const tx = makeTx(order);
      tx.pointsTransaction.createManyAndReturn.mockResolvedValue([]);
      await service.reverseFinancials(tx as never, order);
      expect(tx.user.update).toHaveBeenCalledTimes(1); // chỉ phần hoàn Ví
      expect(tx.user.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { pointsConvertedBalance: expect.anything() } }));
    });

    it('đơn không dùng điểm quy đổi → không ghi dòng CONVERTED nào', async () => {
      const order = makeOrder({ pointsUsed: 40, pointsUsedConverted: 0 });
      const tx = makeTx(order);
      await service.reverseFinancials(tx as never, order);
      expect(tx.pointsTransaction.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('đơn XU cũ (pointsUsedConverted = 0 vì trả bằng xu) chỉ hoàn ORDER_REFUND_XU, không thêm ORDER_REFUND_CONVERTED', async () => {
      const order = makeOrder({ paymentMethod: 'XU', paymentStatus: 'PAID', total: 150000 });
      const tx = makeTx(order);
      await service.reverseFinancials(tx as never, order);
      expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalledTimes(1);
      expect(tx.pointsTransaction.createManyAndReturn.mock.calls[0]![0].data[0].reason).toBe('ORDER_REFUND_XU:TUBU1');
    });
  });

  // Review B1 (minor): lời báo khách phải khớp thứ thật sự được cộng. moneyRefunded chỉ true khi có tiền > 0đ vào Ví;
  // pointsRefunded là số Điểm Xanh hoàn TRONG tx (lô CONVERTED + đơn XU cũ).
  describe('kết quả báo caller: tiền vào Ví và Điểm Xanh hoàn (review B1)', () => {
    it('đơn WALLET 150.000đ đã tiêu 120 điểm quy đổi → { moneyRefunded: true, pointsRefunded: 120 }', async () => {
      const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID', pointsUsed: 150, pointsUsedConverted: 120 });
      const result = await service.reverseFinancials(makeTx(order) as never, order);
      expect(result).toMatchObject({ moneyRefunded: true, pointsRefunded: 120 });
    });

    it('đơn COD tổng 0đ đã giao rồi trả: guard UNPAID→REFUNDED thắng nhưng không có đồng nào vào Ví → moneyRefunded false', async () => {
      const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED', total: 0 });
      const tx = makeTx(order);
      (applyWalletDelta as jest.Mock).mockClear();
      const result = await service.reverseFinancials(tx as never, order);
      expect(tx.order.updateMany).toHaveBeenCalled();
      expect(applyWalletDelta).not.toHaveBeenCalled();
      expect(result).toMatchObject({ moneyRefunded: false, pointsRefunded: 0 });
    });

    it('đơn 0đ trả bằng điểm quy đổi (COD ép 0đ) đã giao rồi trả → chỉ báo điểm, không báo tiền', async () => {
      const order = makeOrder({
        paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED', total: 0, pointsUsed: 80, pointsUsedConverted: 80,
      });
      const result = await service.reverseFinancials(makeTx(order) as never, order);
      expect(result).toMatchObject({ moneyRefunded: false, pointsRefunded: 80 });
    });

    it('đơn WALLET 0đ → moneyRefunded false (không có gì để hoàn)', async () => {
      const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID', total: 0 });
      const result = await service.reverseFinancials(makeTx(order) as never, order);
      expect(result.moneyRefunded).toBe(false);
    });

    it('đơn lên hộ CTV hoàn vào Ví khách cuối là chính chủ đơn, tổng 0đ → moneyRefunded false', async () => {
      const order = makeOrder({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', total: 0, placedForCustomer: true, referrerUserId: 'ctv1', endCustomerKey: null });
      const tx = Object.assign(makeTx(order), { user: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue({ isBlocked: false }) } });
      const result = await service.reverseFinancials(tx as never, order);
      expect(result.moneyRefunded).toBe(false);
    });

    it('guard hoàn tiền thua (count=0) và đơn không dùng điểm quy đổi → { false, 0 }', async () => {
      const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
      const tx = makeTx(order);
      tx.order.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.reverseFinancials(tx as never, order)).toMatchObject({ moneyRefunded: false, pointsRefunded: 0 });
    });

    it('dòng ORDER_REFUND_CONVERTED / ORDER_REFUND_XU đã có → pointsRefunded 0 (không báo hoàn điểm đã hoàn từ trước)', async () => {
      const order = makeOrder({ paymentMethod: 'XU', paymentStatus: 'PAID', pointsUsed: 40, pointsUsedConverted: 40 });
      const tx = makeTx(order);
      tx.pointsTransaction.createManyAndReturn.mockResolvedValue([]);
      expect((await service.reverseFinancials(tx as never, order)).pointsRefunded).toBe(0);
    });
  });

  it('đơn XU cũ: dòng ORDER_REFUND_XU đã có (khoá converted_refund_unique) → không cộng lần 2', async () => {
    const order = makeOrder({ paymentMethod: 'XU', paymentStatus: 'PAID' });
    const tx = makeTx(order);
    tx.pointsTransaction.createManyAndReturn.mockResolvedValue([]);
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('đơn XU cũ gắn cờ lên hộ (không thể có, lên hộ không nhận XU) → vẫn hoàn điểm cho chủ đơn, KHÔNG hoàn tiền mặt/Ví khách cuối', async () => {
    const order = makeOrder({ paymentMethod: 'XU', paymentStatus: 'PAID', placedForCustomer: true, referrerUserId: 'ctv1' });
    const tx = makeTx(order);
    (applyWalletDelta as jest.Mock).mockClear();
    await service.reverseFinancials(tx as never, order);
    expect(tx.orderCustomerRefund.create).not.toHaveBeenCalled();
    expect(applyWalletDelta).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: 150000 } } });
  });

  it('KHÔNG hoàn tiền khi paymentStatus không còn PAID (race đã thua)', async () => {
    const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
    const tx = makeTx(order);
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await service.reverseFinancials(tx as never, order);

    expect(tx.user.update).not.toHaveBeenCalled();
    // Restock vẫn phải chạy — caller đảm bảo hàm này chỉ được gọi 1 lần tổng thể;
    // guard paymentStatus chỉ bảo vệ riêng phần tiền khỏi 2 nguồn ghi PAID khác nhau.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  // A6-06 (docs/audit-2026-09/06-web.md): KHÔNG có đường code nào trong hệ thống từng lật
  // paymentStatus của đơn COD sang PAID (xem comment lớn ở đầu nhánh COD trong reverseFinancials) —
  // paymentStatus COD LUÔN là UNPAID, kể cả khi tiền đã thu xong lúc giao. Tín hiệu ĐÚNG là
  // order.status (ảnh chụp TRƯỚC lần đảo), không phải paymentStatus.
  it('COD huỷ TRƯỚC khi giao (status snapshot != DELIVERED, tiền chưa từng thu) → KHÔNG hoàn, KHÔNG đụng guard payment', async () => {
    const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'SHIPPING' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    // isRefundableChannel=false cho case này — không được thử bất kỳ guard hoàn tiền nào.
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.coinTransaction.create).not.toHaveBeenCalled();
    expect(tx.row.paymentStatus).toBe('UNPAID');
  });

  it('COD trả hàng SAU khi đã DELIVERED (status snapshot=DELIVERED, tiền COD đã thu) → hoàn ví đúng 1 lần, flip UNPAID→REFUNDED', async () => {
    const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED' });
    const tx = makeTx(order); // DB cũng UNPAID (thực tế COD luôn vậy) — guard riêng cho COD phải khớp
    const result = await service.reverseFinancials(tx as never, order);
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', paymentMethod: 'COD', paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'REFUNDED' },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { walletBalance: { increment: 150000 } },
    });
    expect(tx.coinTransaction.create).not.toHaveBeenCalled();
    expect(tx.row.paymentStatus).toBe('REFUNDED');
    expect(result).toMatchObject({ moneyRefunded: true, pointsRefunded: 0 });
  });

  it('COD trả hàng: gọi reverseFinancials 2 lần cho CÙNG đơn (double-processing) → KHÔNG hoàn ví lần 2', async () => {
    const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  // RACE (tiền): caller đọc đơn NGOÀI tx (ảnh chụp UNPAID), rồi admin xác nhận chuyển khoản
  // (POST /admin/dealer-orders/:id/confirm-payment) / webhook Pancake/ZaloPay lật PAID TRƯỚC khi tx huỷ
  // chạy. Bản cũ chỉ thử hoàn khi ẢNH CHỤP là PAID → đơn bị huỷ mà tiền khách đã trả mất trắng.
  // COD KHÔNG nằm trong danh sách này: không có webhook/admin nào lật COD sang PAID một cách độc lập
  // với order.status (xem 2 test COD dành riêng ở trên) — race kiểu "ảnh chụp UNPAID, DB đã PAID"
  // không xảy ra trong thực tế cho COD.
  it.each([
    ['BANK_TRANSFER', 'walletBalance'],
    ['ZALOPAY', 'walletBalance'],
    ['VNPAY', 'walletBalance'],
    ['WALLET', 'walletBalance'],
  ])('ảnh chụp UNPAID nhưng DB đã PAID (%s) → vẫn hoàn ĐÚNG 1 lần vào %s', async (paymentMethod, field) => {
    const order = makeOrder({ paymentMethod, paymentStatus: 'UNPAID' });
    const tx = makeTx(order, 'PAID');
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { [field]: { increment: 150000 } } });
    expect(tx.row.paymentStatus).toBe('REFUNDED');
    // Gọi lại (retry/đường đảo khác) → guard PAID→REFUNDED thua → KHÔNG hoàn lần 2.
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
  });

  it('ảnh chụp UNPAID nhưng DB đã PAID (XU cũ) → hoàn điểm lô quy đổi đúng 1 lần, không hoàn ví, không cộng xu', async () => {
    const order = makeOrder({ paymentMethod: 'XU', paymentStatus: 'UNPAID' });
    const tx = makeTx(order, 'PAID');
    await service.reverseFinancials(tx as never, order);
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: 150000 } } });
    expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(tx.coinTransaction.create).not.toHaveBeenCalled();
  });

  it('ảnh chụp PAID nhưng DB đã REFUNDED (đường đảo khác thắng trước) → KHÔNG hoàn', async () => {
    const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
    const tx = makeTx(order, 'REFUNDED');
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('đơn không có item flash-sale thì không gọi flashSale.restore', async () => {
    const order = makeOrder({ items: [{ id: 'i1', variationId: 'v1', quantity: 3, flashSaleItemId: null, backorderedQty: 0 }] });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    expect(flashSale.restore).not.toHaveBeenCalled();
  });

  it('đơn có dùng coupon → gọi coupons.release(couponCode, orderId, tx) để hoàn voucher', async () => {
    const order = makeOrder({ couponCode: 'BDAY50K' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    expect(coupons.release).toHaveBeenCalledWith('BDAY50K', 'o1', tx);
  });

  it('đơn không dùng coupon → vẫn gọi release (couponCode=null, tự no-op bên trong CouponsService)', async () => {
    const order = makeOrder({ couponCode: null });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    expect(coupons.release).toHaveBeenCalledWith(null, 'o1', tx);
  });

  describe('lần đặt bị tách theo nơi giao (checkoutGroup): mã giảm giá chia cho mọi đơn con, lượt dùng gắn đơn đầu', () => {
    function groupTx(order: unknown, group: { id: string; status: string; couponCode: string | null }[]) {
      const tx = makeTx(order) as MockTx & { order: { findMany: jest.Mock } };
      tx.order.findMany = jest.fn().mockResolvedValue(group);
      return tx;
    }

    it('huỷ đơn đầu (giữ lượt dùng mã) khi đơn gian hàng cùng lần đặt còn sống → KHÔNG trả lượt dùng mã', async () => {
      const order = makeOrder({ id: 'o1', couponCode: 'ONCE', checkoutGroup: 'TUBU1', status: 'CONFIRMED' });
      const tx = groupTx(order, [
        { id: 'o1', status: 'CANCELLED', couponCode: 'ONCE' },
        { id: 'o2', status: 'CONFIRMED', couponCode: null },
      ]);
      await service.reverseFinancials(tx as never, order);
      expect(coupons.release).not.toHaveBeenCalled();
      const sql = tx.$executeRaw.mock.calls.map((c: [TemplateStringsArray]) => c[0].join('?'));
      expect(sql.some((q: string) => /pg_advisory_xact_lock\(hashtext\(/.test(q))).toBe(true);
      expect(tx.order.findMany).toHaveBeenCalledWith({
        where: { checkoutGroup: 'TUBU1' },
        select: { id: true, status: true, couponCode: true },
      });
    });

    it('đơn cuối cùng của nhóm bị huỷ/trả → trả lượt dùng mã theo đơn đầu (đơn đang giữ lượt)', async () => {
      const order = makeOrder({ id: 'o2', couponCode: null, checkoutGroup: 'TUBU1', status: 'CONFIRMED' });
      const tx = groupTx(order, [
        { id: 'o1', status: 'RETURNED', couponCode: 'ONCE' },
        { id: 'o2', status: 'CONFIRMED', couponCode: null },
      ]);
      await service.reverseFinancials(tx as never, order);
      expect(coupons.release).toHaveBeenCalledTimes(1);
      expect(coupons.release).toHaveBeenCalledWith('ONCE', 'o1', tx);
    });

    it('nhóm không dùng mã → không gọi release', async () => {
      const order = makeOrder({ id: 'o2', couponCode: null, checkoutGroup: 'TUBU1' });
      const tx = groupTx(order, [
        { id: 'o1', status: 'CANCELLED', couponCode: null },
        { id: 'o2', status: 'CANCELLED', couponCode: null },
      ]);
      await service.reverseFinancials(tx as never, order);
      expect(coupons.release).not.toHaveBeenCalled();
    });
  });
});

// Đơn đại lý ghi công nợ: huỷ đơn mà không đảo sổ thì đại lý vẫn NỢ tiền một đơn không còn
// tồn tại, và nợ ảo đó còn ăn vào hạn mức nên chặn luôn các đơn sau.
describe('công nợ đại lý khi huỷ đơn CREDIT', () => {
  let service: OrderReversalService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
        { provide: DealerService, useValue: noopDealer() },
      ],
    }).compile();
    service = module.get(OrderReversalService);
  });

  it('ghi dòng đối ứng ÂM đúng bằng khoản đã ghi nợ', async () => {
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const tx = makeTx(order);
    tx.dealerCreditLedger.findFirst.mockImplementation(({ where }: { where: { refType: string } }) =>
      where.refType === 'ORDER' ? Promise.resolve({ id: 'l1', delta: 150000 }) : Promise.resolve(null),
    );

    await service.reverseFinancials(tx as never, order);

    expect(tx.dealerCreditLedger.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        delta: -150000,
        refType: 'ORDER_CANCEL',
        refId: 'o1',
        note: 'Huỷ đơn TUBU1',
      },
    });
  });

  it('đã đảo rồi thì KHÔNG đảo lần hai (chống cộng hạn mức khống)', async () => {
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const tx = makeTx(order);
    tx.dealerCreditLedger.findFirst.mockResolvedValue({ id: 'x', delta: -150000 });

    await service.reverseFinancials(tx as never, order);

    expect(tx.dealerCreditLedger.create).not.toHaveBeenCalled();
  });

  it('đơn đại lý TRẢ TRƯỚC (không có dòng ghi nợ) thì không đụng sổ công nợ', async () => {
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const tx = makeTx(order);
    tx.dealerCreditLedger.findFirst.mockResolvedValue(null);

    await service.reverseFinancials(tx as never, order);

    expect(tx.dealerCreditLedger.create).not.toHaveBeenCalled();
  });

  it('SYNC-3: đơn ghi công nợ lỡ bị lật PAID → chỉ đảo công nợ, KHÔNG hoàn Ví/ngân hàng (không trả đại lý hai lần)', async () => {
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
    const tx = makeTx(order);
    tx.dealerCreditLedger.findFirst.mockImplementation(({ where }: { where: { refType: string } }) =>
      where.refType === 'ORDER' ? Promise.resolve({ id: 'l1', delta: 150000 }) : Promise.resolve(null),
    );

    const res = await service.reverseFinancials(tx as never, order);

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.orderCustomerRefund.create).not.toHaveBeenCalled();
    expect(tx.orderCustomerRefund.createMany).not.toHaveBeenCalled();
    expect(res).toMatchObject({ moneyRefunded: false, refund: null });
    expect(tx.row.paymentStatus).toBe('REFUNDED');
    expect(tx.dealerCreditLedger.create).toHaveBeenCalledWith({
      data: { userId: 'u1', delta: -150000, refType: 'ORDER_CANCEL', refId: 'o1', note: 'Huỷ đơn TUBU1' },
    });
  });

  it('đơn khách lẻ KHÔNG đụng tới sổ công nợ', async () => {
    const order = makeOrder({ type: 'B2C' });
    const tx = makeTx(order);

    await service.reverseFinancials(tx as never, order);

    expect(tx.dealerCreditLedger.findFirst).not.toHaveBeenCalled();
    expect(tx.dealerCreditLedger.create).not.toHaveBeenCalled();
  });
});

/**
 * Đơn đại lý đặt trước (backorder): `backorderedQty > 0` nghĩa là phần đó CHƯA BAO GIỜ được
 * giữ từ kho thật (xem DealerService.placeOrder). Huỷ đơn phải chỉ hoàn đúng phần ĐÃ giữ —
 * hoàn cả `quantity` là cộng khống tồn kho đúng bằng số đặt trước.
 */
describe('OrderReversalService — huỷ đơn có backorder', () => {
  let service: OrderReversalService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
        { provide: DealerService, useValue: noopDealer() },
      ],
    }).compile();
    service = module.get(OrderReversalService);
  });

  it('hoàn ĐÚNG phần đã giữ (quantity - backorderedQty), không hoàn phần đặt trước', async () => {
    const order = makeOrder({
      type: 'DEALER',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 10, flashSaleItemId: null, backorderedQty: 6 }],
    });
    const tx = makeTx(order);

    await service.reverseFinancials(tx as never, order);

    // Chỉ 4 đơn vị (10 - 6) từng thực sự bị trừ kho — chỉ hoàn 4.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0]!.slice(1)).toEqual([4, 4, 'v1']);
  });

  it('xoá backorderedQty về 0 — đơn đã chết thì không còn nhu cầu lấp hàng nữa', async () => {
    const order = makeOrder({
      type: 'DEALER',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 10, flashSaleItemId: null, backorderedQty: 6 }],
    });
    const tx = makeTx(order);

    await service.reverseFinancials(tx as never, order);

    expect(tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { backorderedQty: 0 } });
  });

  it('backorderedQty = TOÀN BỘ quantity (chưa giữ được gì) → không gọi hoàn kho, vẫn xoá cờ', async () => {
    const order = makeOrder({
      type: 'DEALER',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 5, flashSaleItemId: null, backorderedQty: 5 }],
    });
    const tx = makeTx(order);

    await service.reverseFinancials(tx as never, order);

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { backorderedQty: 0 } });
  });

  it('RACE: cron lấp hàng commit SAU khi caller đọc đơn (ảnh chụp 6, DB giờ 0) → hoàn ĐỦ 10 (gồm 6 vừa giữ), không kẹt kho', async () => {
    const order = makeOrder({
      type: 'DEALER',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 10, flashSaleItemId: null, backorderedQty: 6 }],
    });
    const tx = makeTx(order);
    tx.$queryRaw.mockResolvedValue([{ id: 'i1', backorderedQty: 0 }]);

    await service.reverseFinancials(tx as never, order);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // khoá + đọc lại dòng đặt trước
    expect(tx.$executeRaw.mock.calls[0]!.slice(1)).toEqual([10, 10, 'v1']);
    expect(tx.orderItem.update).not.toHaveBeenCalled(); // DB đã 0 — không còn gì để xoá
  });

  it('backorderedQty = 0 (đơn thường) → KHÔNG gọi orderItem.update (không có gì để xoá)', async () => {
    const order = makeOrder(); // fixture mặc định: backorderedQty 0 cho cả 2 item
    const tx = makeTx(order);

    await service.reverseFinancials(tx as never, order);

    expect(tx.orderItem.update).not.toHaveBeenCalled();
    // Đơn thường: không khoá/đọc lại dòng đặt trước; câu duy nhất là khoá hai biến thể theo id trước khi cộng kho.
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = (tx.$queryRaw.mock.calls[0]![0] as string[]).join('?');
    expect(sql).toContain('FROM "variations"');
    expect(sql).not.toContain('order_items');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$executeRaw.mock.invocationCallOrder[0]!);
  });
});

/**
 * Thưởng doanh số quý đại lý trả ngày 10 quý sau, tính trên doanh số ĐÃ CHỐT lúc đó. Đơn của quý
 * đã trả thưởng bị huỷ/trả sau đó → thu hồi phần thưởng BIÊN của chính đơn đó (DealerService, cùng
 * bậc/công thức payout), trong CÙNG transaction với lần lật trạng thái.
 */
describe('OrderReversalService — thu hồi thưởng quý đại lý', () => {
  async function build(dealer?: ReturnType<typeof noopDealer>) {
    const module = await Test.createTestingModule({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
        ...(dealer ? [{ provide: DealerService, useValue: dealer }] : []),
      ],
    }).compile();
    return module.get(OrderReversalService);
  }

  it('đơn DEALER → gọi DealerService.clawbackQuarterBonusForOrder(tx, order) SAU khi đảo công nợ', async () => {
    const dealer = noopDealer();
    const service = await build(dealer);
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const tx = makeTx(order);
    tx.dealerCreditLedger.findFirst.mockImplementation(({ where }: { where: { refType: string } }) =>
      where.refType === 'ORDER' ? Promise.resolve({ id: 'l1', delta: 150000 }) : Promise.resolve(null),
    );

    await service.reverseFinancials(tx as never, order);

    expect(dealer.clawbackQuarterBonusForOrder).toHaveBeenCalledTimes(1);
    // Đơn ghi công nợ (UNPAID) → không phải "đã thanh toán" trước lần huỷ.
    expect(dealer.clawbackQuarterBonusForOrder).toHaveBeenCalledWith(tx, order, { paidBeforeReversal: false });
    // Tính lại doanh số phải thấy đơn đã REFUNDED/đảo nợ → chạy sau cùng.
    expect(dealer.clawbackQuarterBonusForOrder.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.dealerCreditLedger.create.mock.invocationCallOrder[0]!,
    );
  });

  // Thu hồi chỉ tính phần biên của đơn nếu đơn ĐANG được tính vào doanh số đã chốt ngay trước lần
  // huỷ (DealerService). "Đã thanh toán" lấy từ CHÍNH guard hoàn tiền PAID→REFUNDED trong tx (count=1
  // chứng minh DB đang PAID), không chỉ từ ảnh chụp paymentStatus đọc trước đó.
  it('đơn DEALER trả trước đã PAID: guard hoàn tiền thắng (count=1) → paidBeforeReversal=true', async () => {
    const dealer = noopDealer();
    const service = await build(dealer);
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    expect(dealer.clawbackQuarterBonusForOrder).toHaveBeenCalledWith(tx, order, { paidBeforeReversal: true });
  });

  it('ảnh chụp UNPAID nhưng admin vừa xác nhận CK (DB PAID) → hoàn ví đại lý 1 lần + paidBeforeReversal=true', async () => {
    const dealer = noopDealer();
    const service = await build(dealer);
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });
    const tx = makeTx(order, 'PAID');
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).toHaveBeenCalledTimes(1);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { walletBalance: { increment: 150000 } } });
    expect(dealer.clawbackQuarterBonusForOrder).toHaveBeenCalledWith(tx, order, { paidBeforeReversal: true });
  });

  it('ảnh chụp PAID nhưng guard hoàn tiền thua (DB đã không còn PAID) → paidBeforeReversal=false', async () => {
    const dealer = noopDealer();
    const service = await build(dealer);
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID' });
    const tx = makeTx(order);
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    await service.reverseFinancials(tx as never, order);
    expect(dealer.clawbackQuarterBonusForOrder).toHaveBeenCalledWith(tx, order, { paidBeforeReversal: false });
  });

  it('đơn khách lẻ → KHÔNG gọi thu hồi thưởng đại lý', async () => {
    const dealer = noopDealer();
    const service = await build(dealer);
    const order = makeOrder({ type: 'RETAIL' });
    await service.reverseFinancials(makeTx(order) as never, order);
    expect(dealer.clawbackQuarterBonusForOrder).not.toHaveBeenCalled();
  });

  it('lỗi DB khi thu hồi → ném ra để cả transaction huỷ đơn rollback (không nuốt lỗi tiền)', async () => {
    const dealer = noopDealer();
    dealer.clawbackQuarterBonusForOrder.mockRejectedValueOnce(new Error('db down'));
    const service = await build(dealer);
    const order = makeOrder({ type: 'DEALER', paymentStatus: 'UNPAID' });
    await expect(service.reverseFinancials(makeTx(order) as never, order)).rejects.toThrow('db down');
  });

  it('DealerService chưa wiring (dựng tay / module thiếu) → vẫn huỷ đơn, log lỗi to thay vì sập', async () => {
    const { Logger } = jest.requireActual('@nestjs/common');
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = await build(undefined);
    const order = makeOrder({ type: 'DEALER', paymentStatus: 'UNPAID' });
    const tx = makeTx(order);
    // Đơn DEALER mặc định paymentMethod='WALLET' (fixture) + paymentStatus UNPAID → guard PAID
    // thua (count=0) → không có gì được hoàn.
    await expect(service.reverseFinancials(tx as never, order)).resolves.toMatchObject({ moneyRefunded: false, pointsRefunded: 0 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('thưởng quý'));
    error.mockRestore();
  });
});

describe('OrderReversalService — resolve DealerService xuyên module (đúng wiring thật)', () => {
  it('OrdersModule KHÔNG import DealerModule (tránh vòng DealerModule→PancakeModule→OrdersModule) vẫn tìm được DealerService', async () => {
    const { Module } = jest.requireActual('@nestjs/common');
    const dealer = noopDealer();
    @Module({ providers: [{ provide: DealerService, useValue: dealer }], exports: [DealerService] })
    class FakeDealerModule {}
    @Module({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
      exports: [OrderReversalService],
    })
    class FakeOrdersModule {}
    const app = await Test.createTestingModule({ imports: [FakeOrdersModule, FakeDealerModule] }).compile();
    const service = app.get(OrderReversalService);
    const order = makeOrder({ type: 'DEALER', paymentStatus: 'UNPAID' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    expect(dealer.clawbackQuarterBonusForOrder).toHaveBeenCalledWith(tx, order, { paidBeforeReversal: false });
  });
});

describe('OrderReversalService — nơi nhận tiền hoàn và phần đã trả trước (D2/D3)', () => {
  let service: OrderReversalService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(OrderReversalService);
    (applyWalletDelta as jest.Mock).mockClear();
  });

  it('BUYERMINI-9: huỷ đơn chuyển khoản đã trả, khách chọn ngân hàng → ghi khoản chờ chuyển khoản, KHÔNG cộng Ví', async () => {
    const order = makeOrder({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PAID', status: 'CONFIRMED', total: 114_000 });
    const tx = makeTx(order);
    const res = await service.reverseFinancials(tx as never, order, {
      destination: { method: 'BANK', bank: { bankName: 'Techcombank', accountNumber: '190312345678', accountName: 'NGUYEN VAN A' } },
    });
    expect(applyWalletDelta).not.toHaveBeenCalled();
    expect(tx.orderCustomerRefund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'CANCEL',
        amount: 114_000,
        method: 'MANUAL_TRANSFER',
        status: 'PENDING',
        userId: 'u1',
        bankAccountNo: '190312345678',
      }),
    });
    expect(res).toMatchObject({ refund: { amount: 114_000, to: 'BANK' } });
    expect(tx.row.paymentStatus).toBe('REFUNDED');
  });

  it('đơn trả bằng Ví luôn hoàn về Ví dù có nơi nhận ngân hàng', async () => {
    const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID', status: 'CONFIRMED' });
    const tx = makeTx(order);
    const res = await service.reverseFinancials(tx as never, order, {
      destination: { method: 'BANK', bank: { bankName: 'VCB', accountNumber: '123456789', accountName: 'A' } },
    });
    expect(tx.orderCustomerRefund.create).not.toHaveBeenCalled();
    expect(res.refund).toEqual({ amount: 150000, to: 'WALLET' });
  });

  it('đơn đã trả một phần trước đó → lần đảo cả đơn chỉ hoàn phần còn lại, không cộng kho dòng đã nhận về', async () => {
    const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED' });
    const tx = makeTx(order);
    tx.returnRequest.findMany.mockResolvedValue([
      {
        refundAmount: 40_000,
        shippingRefund: 10_000,
        pointsRefunded: 0,
        convertedPointsRefunded: 0,
        pointsReversed: 0,
        commissionReversed: 0,
        receivedAt: new Date(),
        items: [{ orderItemId: 'i2', quantity: 1 }],
      },
    ]);
    const res = await service.reverseFinancials(tx as never, order);
    expect(res.refund).toEqual({ amount: 100_000, to: 'WALLET' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('trả một phần đã duyệt nhưng CHƯA nhận hàng về → lần đảo cả đơn không cộng kho phần đó (nhận về sẽ cộng)', async () => {
    const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED' });
    const tx = makeTx(order);
    tx.returnRequest.findMany.mockResolvedValue([
      {
        refundAmount: 40_000,
        shippingRefund: 0,
        pointsRefunded: 0,
        convertedPointsRefunded: 0,
        pointsReversed: 0,
        commissionReversed: 0,
        receivedAt: null,
        items: [
          { orderItemId: 'i1', quantity: 1 },
          { orderItemId: 'i2', quantity: 1 },
        ],
      },
    ]);
    await service.reverseFinancials(tx as never, order);
    // i1: 2 - 1 đã duyệt = 1 đơn vị; i2: 1 - 1 = 0 → chỉ một lần cộng kho.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const sqlValues = (tx.$executeRaw.mock.calls[0] as unknown[]).slice(1);
    expect(sqlValues).toContain(1);
    expect(sqlValues).toContain('v1');
  });

  it('trả hàng chờ nhận về: restock=false → không cộng kho lúc duyệt', async () => {
    const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED' });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order, { restock: false });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('OrderReversalService.reversePartialReturn — hoa hồng CTV và nền doanh số mốc (MONEY-2)', () => {
  let service: OrderReversalService;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(OrderReversalService);
  });

  /** i1: 3 × (100.000 thực trả, 10%); i2: 2 × (95.000, 5%); i3: 1 × 15.000 không hoa hồng. Hoa hồng 10.000 + 4.750, nền 195.000. */
  const order = (items?: unknown[]) =>
    ({
      id: 'o1',
      code: 'TUBU1',
      userId: 'buyer',
      total: 210_000,
      shippingFee: 0,
      paymentMethod: 'XU',
      paymentStatus: 'PAID',
      status: 'DELIVERED',
      items: items ?? [
        { id: 'i1', variationId: 'v1', quantity: 3, total: 105_000, paidTotal: 100_000, flashSaleItemId: null, backorderedQty: 0 },
        { id: 'i2', variationId: 'v2', quantity: 2, total: 100_000, paidTotal: 95_000, flashSaleItemId: null, backorderedQty: 0 },
        { id: 'i3', variationId: 'v3', quantity: 1, total: 20_000, paidTotal: 15_000, flashSaleItemId: null, backorderedQty: 0 },
      ],
    }) as never;

  type Row = { amount: number; commissionableTotal: number; lineAmounts: unknown; status: string };
  const newRow = (over: Partial<Row> = {}): Row => ({
    amount: 14_750,
    commissionableTotal: 195_000,
    lineAmounts: { i1: 10_000, i2: 4_750 },
    status: 'LOCKED',
    ...over,
  });

  /** tx giả giữ một dòng commission; updateMany chỉ ghi khi guard (id, amount, commissionableTotal, status) còn khớp như Postgres. */
  function commissionTx(row: Row) {
    return {
      row,
      commission: {
        findMany: jest.fn(async ({ where }: { where: { status: { in: string[] } } }) =>
          where.status.in.includes(row.status)
            ? [{ id: 'c1', amount: row.amount, commissionableTotal: row.commissionableTotal, lineAmounts: row.lineAmounts }]
            : [],
        ),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { amount: number; commissionableTotal: number; status: { in: string[] } };
            data: { amount: { decrement: number }; commissionableTotal: { decrement: number } };
          }) => {
            if (where.amount !== row.amount || where.commissionableTotal !== row.commissionableTotal || !where.status.in.includes(row.status)) {
              return { count: 0 };
            }
            row.amount -= data.amount.decrement;
            row.commissionableTotal -= data.commissionableTotal.decrement;
            return { count: 1 };
          },
        ),
      },
    };
  }

  /** Một lần trả một phần: `qty` là số đơn vị trả lần này theo dòng, `done` số đã duyệt trước đó. */
  async function partial(tx: ReturnType<typeof commissionTx>, qty: Record<string, number>, done: Record<string, number>, o = order()) {
    const shares = {
      isFull: false,
      goods: 0,
      shipping: 0,
      pointsUsedBack: 0,
      convertedBack: 0,
      pointsEarnedBack: 0,
      ratioBefore: 0,
      ratioAfter: 0,
      lines: Object.entries(qty).map(([orderItemId, quantity]) => ({ orderItemId, quantity, refundAmount: 0 })),
    };
    const prior = { ...NO_PARTIAL_RETURNS, approvedQty: new Map(Object.entries(done)) };
    return service.reversePartialReturn(tx as never, o, {
      requestId: 'r1',
      shares,
      destination: WALLET_DESTINATION,
      prior,
      standardPointsExpiresAt: null,
    });
  }

  it('trả 1/3 dòng 10%: giảm hoa hồng 3.333 và nền doanh số 33.333 trong CÙNG một updateMany có guard', async () => {
    const tx = commissionTx(newRow());
    const res = await partial(tx, { i1: 1 }, {});
    expect(res.commissionCut).toBe(3_333);
    expect(tx.row).toMatchObject({ amount: 11_417, commissionableTotal: 161_667 });
    expect(tx.commission.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.commission.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', amount: 14_750, commissionableTotal: 195_000, status: { in: ['PENDING', 'LOCKED'] } },
      data: { amount: { decrement: 3_333 }, commissionableTotal: { decrement: 33_333 } },
    });
  });

  it('chỉ đọc commission PENDING/LOCKED: đã duyệt/đã chi thì không đụng gì (giống lần đảo cả đơn)', async () => {
    for (const status of ['APPROVED', 'PAID', 'REJECTED']) {
      const tx = commissionTx(newRow({ status }));
      const res = await partial(tx, { i1: 1 }, {});
      expect(res.commissionCut).toBe(0);
      expect(tx.commission.updateMany).not.toHaveBeenCalled();
      expect(tx.row).toMatchObject({ amount: 14_750, commissionableTotal: 195_000 });
    }
  });

  it('trả món không hoa hồng (0%) → không đổi hoa hồng, không đổi nền doanh số', async () => {
    const tx = commissionTx(newRow());
    const res = await partial(tx, { i3: 1 }, {});
    expect(res.commissionCut).toBe(0);
    expect(tx.commission.updateMany).not.toHaveBeenCalled();
    expect(tx.row).toMatchObject({ amount: 14_750, commissionableTotal: 195_000 });
  });

  it('trả nhiều lần (1/3, rồi thêm 1/3 + nửa dòng 5%, rồi phần còn lại của hai dòng có hoa hồng): từng bước đúng, cuối cùng về đúng 0 / 0', async () => {
    const tx = commissionTx(newRow());
    await partial(tx, { i1: 1 }, {});
    expect(tx.row).toMatchObject({ amount: 11_417, commissionableTotal: 161_667 });

    await partial(tx, { i1: 1, i2: 1 }, { i1: 1 });
    // Còn lại: 1 đơn vị i1 (33.333 / hoa hồng 3.333) + 1 đơn vị i2 (47.500 / hoa hồng 2.375).
    expect(tx.row).toMatchObject({ amount: 5_708, commissionableTotal: 80_833 });

    // i3 (0%) còn lại nên đây chưa phải lần trả nốt cả đơn.
    const last = await partial(tx, { i1: 1, i2: 1 }, { i1: 2, i2: 1 });
    expect(last.commissionCut).toBe(5_708);
    expect(tx.row).toMatchObject({ amount: 0, commissionableTotal: 0 });
    const decrements = tx.commission.updateMany.mock.calls.map((c) => c[0].data.commissionableTotal.decrement);
    expect(decrements.reduce((s, v) => s + v, 0)).toBe(195_000);
  });

  it('thứ tự các lần trả không đổi tổng: trả hết i1 một lần rồi i2 hai lần = 195.000 / 14.750', async () => {
    const tx = commissionTx(newRow());
    await partial(tx, { i1: 3 }, {});
    expect(tx.row).toMatchObject({ amount: 4_750, commissionableTotal: 95_000 });
    await partial(tx, { i2: 1 }, { i1: 3 });
    await partial(tx, { i2: 1 }, { i1: 3, i2: 1 });
    expect(tx.row).toMatchObject({ amount: 0, commissionableTotal: 0 });
  });

  it('nền doanh số không bao giờ âm: commissionableTotal hiện có nhỏ hơn phần tính ra (số cũ lệch) → chỉ giảm tối đa số hiện có', async () => {
    const tx = commissionTx(newRow({ commissionableTotal: 20_000 }));
    await partial(tx, { i1: 1 }, {});
    expect(tx.row).toMatchObject({ amount: 11_417, commissionableTotal: 0 });
    expect(tx.commission.updateMany.mock.calls[0]![0].data.commissionableTotal).toEqual({ decrement: 20_000 });
  });

  it('commissionableTotal = 0 (hoa hồng cũ chưa có nền) → chỉ giảm hoa hồng, không ghi giá trị âm', async () => {
    const tx = commissionTx(newRow({ commissionableTotal: 0 }));
    await partial(tx, { i1: 1 }, {});
    expect(tx.row).toMatchObject({ amount: 11_417, commissionableTotal: 0 });
  });

  it('hoa hồng cắt tròn về 0 nhưng nền doanh số vẫn giảm: vẫn ghi (không bỏ qua bước vì cut hoa hồng = 0)', async () => {
    // 40 × 25 = 1.000 thực trả, 1%: hoa hồng 10 → trả 1/40 = 0,25 → làm tròn 0; nền 1.000 × 1/40 = 25.
    const items = [{ id: 'i1', variationId: 'v1', quantity: 40, total: 1_000, paidTotal: 1_000, flashSaleItemId: null, backorderedQty: 0 }];
    const o = { ...(order(items) as object), total: 1_000 } as never;
    const tx = commissionTx(newRow({ amount: 10, commissionableTotal: 1_000, lineAmounts: { i1: 10 } }));
    const res = await partial(tx, { i1: 1 }, {}, o);
    expect(res.commissionCut).toBe(0);
    expect(tx.row).toMatchObject({ amount: 10, commissionableTotal: 975 });
  });

  it('dòng có mức % nhưng hoa hồng làm tròn về 0 (lineAmounts ghi 0): trả nó vẫn giảm nền doanh số, hoa hồng giữ nguyên; trả hết thì nền về đúng 0', async () => {
    // i1: 40 × 25 = 1.000 thực trả, 1% → 10; i2: 1 × 50 thực trả, 1% → 0. Nền 1.050.
    const items = [
      { id: 'i1', variationId: 'v1', quantity: 40, total: 1_000, paidTotal: 1_000, flashSaleItemId: null, backorderedQty: 0 },
      { id: 'i2', variationId: 'v2', quantity: 1, total: 50, paidTotal: 50, flashSaleItemId: null, backorderedQty: 0 },
      { id: 'i3', variationId: 'v3', quantity: 1, total: 20, paidTotal: 20, flashSaleItemId: null, backorderedQty: 0 },
    ];
    const o = { ...(order(items) as object), total: 1_070 } as never;
    const tx = commissionTx(newRow({ amount: 10, commissionableTotal: 1_050, lineAmounts: { i1: 10, i2: 0 } }));
    const res = await partial(tx, { i2: 1 }, {}, o);
    expect(res.commissionCut).toBe(0);
    expect(tx.row).toMatchObject({ amount: 10, commissionableTotal: 1_000 });
    await partial(tx, { i1: 40 }, {}, o);
    expect(tx.row).toMatchObject({ amount: 0, commissionableTotal: 0 });
  });

  it('guard thua (hoa hồng vừa được duyệt/đổi giữa lúc đọc và ghi) → không ghi gì, không báo đã cắt', async () => {
    const tx = commissionTx(newRow());
    tx.commission.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await partial(tx, { i1: 1 }, {});
    expect(res.commissionCut).toBe(0);
    expect(tx.row).toMatchObject({ amount: 14_750, commissionableTotal: 195_000 });
  });

  it('đơn cũ không có paidTotal: nền theo giá trị dòng nhân tỉ lệ thực trả (không tính phí ship)', async () => {
    // tiền hàng thực trả 90.000 trên 100.000 giá trị: dòng 60.000 → 54.000 thực trả.
    const items = [
      { id: 'i1', variationId: 'v1', quantity: 2, total: 60_000, paidTotal: null, flashSaleItemId: null, backorderedQty: 0 },
      { id: 'i2', variationId: 'v2', quantity: 1, total: 40_000, paidTotal: null, flashSaleItemId: null, backorderedQty: 0 },
    ];
    const o = { ...(order(items) as object), total: 100_000, shippingFee: 10_000 } as never;
    const tx = commissionTx(newRow({ amount: 5_400, commissionableTotal: 54_000, lineAmounts: { i1: 5_400 } }));
    await partial(tx, { i1: 1 }, {}, o);
    expect(tx.row).toMatchObject({ amount: 2_700, commissionableTotal: 27_000 });
  });

  it('hoa hồng cũ chưa có lineAmounts: nền cắt theo các dòng có hoa hồng tính lại theo mức % hiện tại của biến thể', async () => {
    const tx = commissionTx(newRow({ lineAmounts: null }));
    (tx as unknown as { variation: unknown }).variation = {
      findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: 10, product: { affiliateBlocked: false } },
        { id: 'v2', affiliateRate: 5, product: { affiliateBlocked: false } },
        { id: 'v3', affiliateRate: null, product: { affiliateBlocked: false } },
      ]),
    };
    await partial(tx, { i1: 1, i3: 1 }, {});
    expect(tx.row).toMatchObject({ amount: 11_417, commissionableTotal: 161_667 });
  });
});

/**
 * Thứ tự khoá: mọi đường tạo đơn khoá biến thể → suất giờ vàng → users, nên lần đảo tiền phải cộng kho và hoàn suất TRƯỚC mọi
 * lần ghi dòng users (hoàn Ví/điểm), nếu không đặt đơn cùng khách ‖ huỷ/trả đơn deadlock (checkout-reversal-lock-order.race-spec).
 */
describe('OrderReversalService — kho và suất giờ vàng trước mọi ghi users', () => {
  let service: OrderReversalService;
  let flashSale: { restore: jest.Mock };

  beforeEach(async () => {
    flashSale = { restore: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: flashSale },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(OrderReversalService);
    jest.mocked(applyWalletDelta).mockClear();
  });

  const orderOf = (mocks: jest.Mock[]) => mocks.flatMap((m) => m.mock.invocationCallOrder);
  /** Thời điểm các câu SQL thô có nhắc tới bảng `table` (khoá FOR … / UPDATE). */
  const rawOn = (mock: jest.Mock, table: string) =>
    mock.mock.calls.flatMap((c, i) => ((c[0] as string[]).join('').includes(`"${table}"`) ? [mock.mock.invocationCallOrder[i]!] : []));

  type OrderTx = MockTx & {
    user: { update: jest.Mock; updateMany: jest.Mock };
    pointsTransaction: MockTx['pointsTransaction'] & { create: jest.Mock; findFirst: jest.Mock };
  };
  const withUserMocks = (tx: MockTx): OrderTx =>
    Object.assign(tx, {
      user: { ...tx.user, updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      pointsTransaction: {
        ...tx.pointsTransaction,
        create: jest.fn().mockResolvedValue({ id: 'ptx' }),
        findFirst: jest.fn().mockResolvedValue({ id: 'credited' }),
      },
    });

  /**
   * Lần chạm users đầu tiên phải sau lần cộng kho/hoàn suất cuối cùng: Ví (applyWalletDelta), user.update/updateMany, dòng sổ
   * điểm (KEY SHARE qua khoá ngoại) và mọi câu SQL thô khoá/ghi "users".
   */
  function expectStockAndFlashFirst(tx: OrderTx) {
    const restored = [...rawOn(tx.$executeRaw, 'variations'), ...orderOf([flashSale.restore])];
    const userTouches = [
      ...orderOf([
        jest.mocked(applyWalletDelta),
        tx.user.update,
        tx.user.updateMany,
        tx.pointsTransaction.createManyAndReturn,
        tx.pointsTransaction.create,
      ]),
      ...rawOn(tx.$executeRaw, 'users'),
      ...rawOn(tx.$queryRaw, 'users'),
    ];
    expect(restored.length).toBeGreaterThan(0);
    expect(userTouches.length).toBeGreaterThan(0);
    expect(Math.max(...restored)).toBeLessThan(Math.min(...userTouches));
  }

  it('reverseFinancials (huỷ đơn trả Ví có dòng giờ vàng)', async () => {
    const order = makeOrder({ status: 'CONFIRMED', paymentMethod: 'WALLET', paymentStatus: 'PAID' });
    const tx = withUserMocks(makeTx(order));
    await service.reverseFinancials(tx as never, order);
    expect(flashSale.restore).toHaveBeenCalled();
    expectStockAndFlashFirst(tx);
  });

  it('reversePartialReturn (trả một phần dòng giờ vàng: hoàn Ví, trả điểm đã dùng, khoá users để thu điểm tích)', async () => {
    const order = makeOrder({ status: 'DELIVERED', paymentMethod: 'WALLET', paymentStatus: 'PAID', shippingFee: 0 });
    const tx = Object.assign(withUserMocks(makeTx(order)), { commission: { findMany: jest.fn().mockResolvedValue([]) } });
    const shares = {
      isFull: false,
      goods: 50_000,
      shipping: 0,
      pointsUsedBack: 5,
      convertedBack: 0,
      pointsEarnedBack: 3,
      ratioBefore: 0,
      ratioAfter: 0,
      lines: [{ orderItemId: 'i2', quantity: 1, refundAmount: 50_000 }],
    };
    await service.reversePartialReturn(tx as never, order, {
      requestId: 'r1',
      shares,
      destination: WALLET_DESTINATION,
      prior: NO_PARTIAL_RETURNS,
      standardPointsExpiresAt: null,
    });
    expect(flashSale.restore).toHaveBeenCalledWith(tx, 'fs1', 'u1', 1);
    // Ca này phải đi qua cả hai đường: khoá users trước khi thu điểm tích, và dòng sổ trả điểm đã dùng.
    expect(rawOn(tx.$queryRaw, 'users')).toHaveLength(1);
    expect(tx.pointsTransaction.createManyAndReturn).toHaveBeenCalled();
    expectStockAndFlashFirst(tx);
  });

  /** Dòng đơn [fsB, fsA, fsB]: hoàn suất theo id suất (như đặt đơn khoá flash_sale_items), mỗi dòng vẫn hoàn đúng số của nó. */
  const SHUFFLED = [
    { id: 'i1', variationId: 'v1', quantity: 2, flashSaleItemId: 'fsB', backorderedQty: 0 },
    { id: 'i2', variationId: 'v2', quantity: 1, flashSaleItemId: 'fsA', backorderedQty: 0 },
    { id: 'i3', variationId: 'v3', quantity: 3, flashSaleItemId: 'fsB', backorderedQty: 0 },
  ];
  const restores = () => flashSale.restore.mock.calls.map((c) => [c[1], c[3]]);

  it.each([
    ['huỷ đơn (cộng kho)', {}],
    ['trả cả đơn (restock: false)', { restock: false }],
  ])('reverseFinancials %s → hoàn suất theo id suất, sau mọi lần cộng kho', async (_what, opts) => {
    const order = makeOrder({ status: 'CONFIRMED', items: SHUFFLED });
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order, opts);
    expect(restores()).toEqual([
      ['fsA', 1],
      ['fsB', 2],
      ['fsB', 3],
    ]);
    const stock = rawOn(tx.$executeRaw, 'variations');
    expect(stock).toHaveLength('restock' in opts ? 0 : 3);
    if (stock.length > 0) expect(Math.max(...stock)).toBeLessThan(Math.min(...flashSale.restore.mock.invocationCallOrder));
  });

  it('reversePartialReturn dòng trả [fsB, fsA] → hoàn suất fsA trước fsB, đúng số trả của từng dòng', async () => {
    const order = makeOrder({ status: 'DELIVERED', paymentMethod: 'WALLET', paymentStatus: 'PAID', shippingFee: 0, items: SHUFFLED });
    const tx = Object.assign(withUserMocks(makeTx(order)), { commission: { findMany: jest.fn().mockResolvedValue([]) } });
    await service.reversePartialReturn(tx as never, order, {
      requestId: 'r1',
      shares: {
        isFull: false,
        goods: 0,
        shipping: 0,
        pointsUsedBack: 0,
        convertedBack: 0,
        pointsEarnedBack: 0,
        ratioBefore: 0,
        ratioAfter: 0,
        lines: [
          { orderItemId: 'i1', quantity: 1, refundAmount: 0 },
          { orderItemId: 'i2', quantity: 1, refundAmount: 0 },
        ],
      },
      destination: WALLET_DESTINATION,
      prior: NO_PARTIAL_RETURNS,
      standardPointsExpiresAt: null,
    });
    expect(restores()).toEqual([
      ['fsA', 1],
      ['fsB', 1],
    ]);
  });
});

describe('OrderReversalService — thưởng đánh giá khi trả hàng', () => {
  let service: OrderReversalService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrderReversalService,
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(OrderReversalService);
    jest.mocked(applyWalletDelta).mockClear();
  });

  const REVIEW = { id: 'r1', userId: 'u1', productId: 'p1', pointsEarned: 10_000 };
  const advisoryLocks = (tx: MockTx) =>
    tx.$executeRaw.mock.calls.flatMap((c, i) =>
      (c[0] as string[]).join('').includes('pg_advisory_xact_lock') ? [tx.$executeRaw.mock.invocationCallOrder[i]!] : [],
    );

  it('trả cả đơn bán lẻ đã giao: khoá thưởng đánh giá TRƯỚC mọi ghi lên Ví/users, lọc theo đơn và đánh giá có thưởng', async () => {
    const order = makeOrder({ type: 'RETAIL', placedForCustomer: false });
    const tx = makeTx(order);
    tx.review.findMany.mockResolvedValue([REVIEW]);
    Object.assign(tx.pointsTransaction, { findFirst: jest.fn().mockResolvedValue(null) });

    await service.reverseFinancials(tx as never, order);

    expect(tx.review.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'o1', pointsEarned: { gt: 0 } } }));
    const locks = advisoryLocks(tx);
    expect(locks).toHaveLength(1);
    expect(locks[0]!).toBeLessThan(jest.mocked(applyWalletDelta).mock.invocationCallOrder[0]!);
    expect(locks[0]!).toBeLessThan(tx.$executeRaw.mock.invocationCallOrder.filter((n) => n !== locks[0])[0]!);
  });

  it.each([
    ['đơn đại lý', { type: 'DEALER', placedForCustomer: false }],
    ['đơn CTV lên hộ', { type: 'RETAIL', placedForCustomer: true }],
    ['đơn chưa giao (huỷ)', { type: 'RETAIL', placedForCustomer: false, status: 'CONFIRMED' }],
  ])('%s: không có đánh giá được thưởng nên không đọc, không khoá', async (_name, over) => {
    const order = makeOrder(over);
    const tx = makeTx(order);
    await service.reverseFinancials(tx as never, order);
    expect(tx.review.findMany).not.toHaveBeenCalled();
    expect(advisoryLocks(tx)).toEqual([]);
  });

  it('trả một phần: chỉ khoá và thu hồi thưởng của sản phẩm thuộc dòng bị trả (dòng i2 → sản phẩm p2, không phải p1)', async () => {
    const order = makeOrder({ type: 'RETAIL', placedForCustomer: false, shippingFee: 0 });
    const tx = Object.assign(makeTx(order), {
      commission: { findMany: jest.fn().mockResolvedValue([]) },
      variation: { findMany: jest.fn().mockResolvedValue([{ productId: 'p2' }]) },
    });
    tx.review.findMany.mockResolvedValue([{ ...REVIEW, id: 'r2', productId: 'p2' }]);
    Object.assign(tx.pointsTransaction, { findFirst: jest.fn().mockResolvedValue(null) });
    const shares = {
      isFull: false,
      goods: 0,
      shipping: 0,
      pointsUsedBack: 0,
      convertedBack: 0,
      pointsEarnedBack: 0,
      lines: [{ orderItemId: 'i2', quantity: 1, refundAmount: 0 }],
    };

    await service.reversePartialReturn(tx as never, order, {
      requestId: 'rq1',
      shares: shares as never,
      destination: WALLET_DESTINATION,
      prior: NO_PARTIAL_RETURNS,
      standardPointsExpiresAt: null,
    });

    expect(tx.variation.findMany).toHaveBeenCalledWith({ where: { id: { in: ['v2'] } }, select: { productId: true } });
    expect(tx.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'o1', pointsEarned: { gt: 0 }, productId: { in: ['p2'] } } }),
    );
    expect(advisoryLocks(tx)).toHaveLength(1);
  });

  it('trả một phần khi sản phẩm chưa có đánh giá nào: vẫn khoá cặp (khách, sản phẩm) để đánh giá đang tạo song song thấy dòng trả đã duyệt', async () => {
    const order = makeOrder({ type: 'RETAIL', placedForCustomer: false, shippingFee: 0 });
    const tx = Object.assign(makeTx(order), {
      commission: { findMany: jest.fn().mockResolvedValue([]) },
      variation: { findMany: jest.fn().mockResolvedValue([{ productId: 'p2' }, { productId: 'p1' }]) },
    });
    const shares = {
      isFull: false,
      goods: 0,
      shipping: 0,
      pointsUsedBack: 0,
      convertedBack: 0,
      pointsEarnedBack: 0,
      lines: [{ orderItemId: 'i2', quantity: 1, refundAmount: 0 }],
    };

    await service.reversePartialReturn(tx as never, order, {
      requestId: 'rq1',
      shares: shares as never,
      destination: WALLET_DESTINATION,
      prior: NO_PARTIAL_RETURNS,
      standardPointsExpiresAt: null,
    });

    const keys = tx.$executeRaw.mock.calls.flatMap((c) => ((c[0] as string[]).join('').includes('pg_advisory_xact_lock') ? [c[1] as string] : []));
    expect(keys).toEqual(['review-reward:u1:p1', 'review-reward:u1:p2']);
  });
});
