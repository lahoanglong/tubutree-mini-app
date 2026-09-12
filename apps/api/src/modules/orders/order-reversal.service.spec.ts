import { Test } from '@nestjs/testing';
import { OrderReversalService } from './order-reversal.service';
import { FlashSaleService } from '../flash-sale/flash-sale.service';
import { CouponsService } from '../coupons/coupons.service';

type MockTx = {
  order: { updateMany: jest.Mock };
  user: { update: jest.Mock };
  coinTransaction: { create: jest.Mock };
  /** Hoàn kho đi bằng SQL thô (catalog/variation-stock.ts) để sửa 3 cột nguyên tử. */
  $executeRaw: jest.Mock;
  dealerCreditLedger: { findFirst: jest.Mock; create: jest.Mock };
  orderItem: { update: jest.Mock };
};

function makeTx(): MockTx {
  return {
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { update: jest.fn().mockResolvedValue({}) },
    coinTransaction: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    orderItem: { update: jest.fn().mockResolvedValue({}) },
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
    const tx = makeTx();
    const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
    await service.reverseFinancials(tx as never, order);

    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', paymentStatus: 'PAID' },
      data: { paymentStatus: 'REFUNDED' },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { walletBalance: { increment: 150000 } },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    // Tham số của câu UPDATE hoàn kho: (số lượng, số lượng, variationId).
    expect(tx.$executeRaw.mock.calls[0]!.slice(1)).toEqual([2, 2, 'v1']);
    expect(flashSale.restore).toHaveBeenCalledWith(tx, 'fs1', 'u1', 1);
    expect(flashSale.restore).toHaveBeenCalledTimes(1);
  });

  it('hoàn XU (coinsBalance) thay vì walletBalance khi thanh toán bằng XU', async () => {
    const tx = makeTx();
    const order = makeOrder({ paymentMethod: 'XU', paymentStatus: 'PAID' });
    await service.reverseFinancials(tx as never, order);

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { coinsBalance: { increment: 150000 } },
    });
    expect(tx.coinTransaction.create).toHaveBeenCalledWith({
      data: { userId: 'u1', delta: 150000, reason: 'ORDER_REFUND:TUBU1', refType: 'ORDER', refId: 'o1' },
    });
  });

  it('KHÔNG hoàn tiền khi paymentStatus không còn PAID (race đã thua)', async () => {
    const tx = makeTx();
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    const order = makeOrder({ paymentMethod: 'WALLET', paymentStatus: 'PAID' });
    await service.reverseFinancials(tx as never, order);

    expect(tx.user.update).not.toHaveBeenCalled();
    // Restock vẫn phải chạy — caller đảm bảo hàm này chỉ được gọi 1 lần tổng thể;
    // guard paymentStatus chỉ bảo vệ riêng phần tiền khỏi 2 nguồn ghi PAID khác nhau.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('KHÔNG hoàn tiền cho đơn COD còn UNPAID (chưa thu tiền)', async () => {
    const tx = makeTx();
    const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'UNPAID' });
    tx.order.updateMany.mockResolvedValue({ count: 0 }); // guard paymentStatus:'PAID' không match UNPAID
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('hoàn ví cho COD đã PAID (thu hộ khi giao, trả hàng sau DELIVERED)', async () => {
    const tx = makeTx();
    const order = makeOrder({ paymentMethod: 'COD', paymentStatus: 'PAID' });
    await service.reverseFinancials(tx as never, order);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { walletBalance: { increment: 150000 } },
    });
  });

  it('đơn không có item flash-sale thì không gọi flashSale.restore', async () => {
    const tx = makeTx();
    const order = makeOrder({ items: [{ id: 'i1', variationId: 'v1', quantity: 3, flashSaleItemId: null, backorderedQty: 0 }] });
    await service.reverseFinancials(tx as never, order);
    expect(flashSale.restore).not.toHaveBeenCalled();
  });

  it('đơn có dùng coupon → gọi coupons.release(couponCode, orderId, tx) để hoàn voucher', async () => {
    const tx = makeTx();
    const order = makeOrder({ couponCode: 'BDAY50K' });
    await service.reverseFinancials(tx as never, order);
    expect(coupons.release).toHaveBeenCalledWith('BDAY50K', 'o1', tx);
  });

  it('đơn không dùng coupon → vẫn gọi release (couponCode=null, tự no-op bên trong CouponsService)', async () => {
    const tx = makeTx();
    const order = makeOrder({ couponCode: null });
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
      ],
    }).compile();
    service = module.get(OrderReversalService);
  });

  it('ghi dòng đối ứng ÂM đúng bằng khoản đã ghi nợ', async () => {
    const tx = makeTx();
    tx.dealerCreditLedger.findFirst.mockImplementation(({ where }: { where: { refType: string } }) =>
      where.refType === 'ORDER' ? Promise.resolve({ id: 'l1', delta: 150000 }) : Promise.resolve(null),
    );
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });

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
    const tx = makeTx();
    tx.dealerCreditLedger.findFirst.mockResolvedValue({ id: 'x', delta: -150000 });
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });

    await service.reverseFinancials(tx as never, order);

    expect(tx.dealerCreditLedger.create).not.toHaveBeenCalled();
  });

  it('đơn đại lý TRẢ TRƯỚC (không có dòng ghi nợ) thì không đụng sổ công nợ', async () => {
    const tx = makeTx();
    tx.dealerCreditLedger.findFirst.mockResolvedValue(null);
    const order = makeOrder({ type: 'DEALER', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID' });

    await service.reverseFinancials(tx as never, order);

    expect(tx.dealerCreditLedger.create).not.toHaveBeenCalled();
  });

  it('đơn khách lẻ KHÔNG đụng tới sổ công nợ', async () => {
    const tx = makeTx();
    const order = makeOrder({ type: 'B2C' });

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
      ],
    }).compile();
    service = module.get(OrderReversalService);
  });

  it('hoàn ĐÚNG phần đã giữ (quantity - backorderedQty), không hoàn phần đặt trước', async () => {
    const tx = makeTx();
    const order = makeOrder({
      type: 'DEALER',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 10, flashSaleItemId: null, backorderedQty: 6 }],
    });

    await service.reverseFinancials(tx as never, order);

    // Chỉ 4 đơn vị (10 - 6) từng thực sự bị trừ kho — chỉ hoàn 4.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0]!.slice(1)).toEqual([4, 4, 'v1']);
  });

  it('xoá backorderedQty về 0 — đơn đã chết thì không còn nhu cầu lấp hàng nữa', async () => {
    const tx = makeTx();
    const order = makeOrder({
      type: 'DEALER',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 10, flashSaleItemId: null, backorderedQty: 6 }],
    });

    await service.reverseFinancials(tx as never, order);

    expect(tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { backorderedQty: 0 } });
  });

  it('backorderedQty = TOÀN BỘ quantity (chưa giữ được gì) → không gọi hoàn kho, vẫn xoá cờ', async () => {
    const tx = makeTx();
    const order = makeOrder({
      type: 'DEALER',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      items: [{ id: 'i1', variationId: 'v1', quantity: 5, flashSaleItemId: null, backorderedQty: 5 }],
    });

    await service.reverseFinancials(tx as never, order);

    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.orderItem.update).toHaveBeenCalledWith({ where: { id: 'i1' }, data: { backorderedQty: 0 } });
  });

  it('backorderedQty = 0 (đơn thường) → KHÔNG gọi orderItem.update (không có gì để xoá)', async () => {
    const tx = makeTx();
    const order = makeOrder(); // fixture mặc định: backorderedQty 0 cho cả 2 item

    await service.reverseFinancials(tx as never, order);

    expect(tx.orderItem.update).not.toHaveBeenCalled();
  });
});
