import { Test } from '@nestjs/testing';
import { OrderReversalService } from './order-reversal.service';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { CouponsService } from '../coupons/coupons.service';
import { DealerService } from '../dealer/dealer.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';

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
  orderCustomerRefund: { create: jest.Mock };
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
    orderCustomerRefund: { create: jest.fn().mockResolvedValue({}) },
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

  // PD-3 (spec 6.2, OQ-8): đơn XU cũ huỷ/trả sau gộp → hoàn ceil(total/1000) Điểm Xanh lô quy đổi.
  // Không cộng xu (users_coins_frozen), không về Ví (xu không ra tiền, Q-03a).
  it.each([
    [150000, 150],
    [150001, 151],
    [999, 1],
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
    expect(result).toEqual({ moneyRefunded: false, pointsRefunded: points });
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
      expect(result).toEqual({ moneyRefunded: true, pointsRefunded: 120 });
    });

    it('đơn COD tổng 0đ đã giao rồi trả: guard UNPAID→REFUNDED thắng nhưng không có đồng nào vào Ví → moneyRefunded false', async () => {
      const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED', total: 0 });
      const tx = makeTx(order);
      (applyWalletDelta as jest.Mock).mockClear();
      const result = await service.reverseFinancials(tx as never, order);
      expect(tx.order.updateMany).toHaveBeenCalled();
      expect(applyWalletDelta).not.toHaveBeenCalled();
      expect(result).toEqual({ moneyRefunded: false, pointsRefunded: 0 });
    });

    it('đơn 0đ trả bằng điểm quy đổi (COD ép 0đ) đã giao rồi trả → chỉ báo điểm, không báo tiền', async () => {
      const order = makeOrder({
        paymentMethod: 'COD', paymentStatus: 'UNPAID', status: 'DELIVERED', total: 0, pointsUsed: 80, pointsUsedConverted: 80,
      });
      const result = await service.reverseFinancials(makeTx(order) as never, order);
      expect(result).toEqual({ moneyRefunded: false, pointsRefunded: 80 });
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
      expect(await service.reverseFinancials(tx as never, order)).toEqual({ moneyRefunded: false, pointsRefunded: 0 });
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
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: 150 } } });
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
    expect(result).toEqual({ moneyRefunded: true, pointsRefunded: 0 });
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
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { pointsConvertedBalance: { increment: 150 } } });
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
    expect(tx.$queryRaw).not.toHaveBeenCalled(); // đơn thường: không khoá/đọc lại thêm
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
    await expect(service.reverseFinancials(tx as never, order)).resolves.toEqual({ moneyRefunded: false, pointsRefunded: 0 });
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
