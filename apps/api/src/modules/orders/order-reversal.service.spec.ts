import { Test } from '@nestjs/testing';
import { OrderReversalService } from './order-reversal.service';
import { FlashSaleService } from '../flash-sale/flash-sale.service';

type MockTx = {
  order: { updateMany: jest.Mock };
  user: { update: jest.Mock };
  coinTransaction: { create: jest.Mock };
  variation: { update: jest.Mock };
};

function makeTx(): MockTx {
  return {
    order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { update: jest.fn().mockResolvedValue({}) },
    coinTransaction: { create: jest.fn().mockResolvedValue({}) },
    variation: { update: jest.fn().mockResolvedValue({}) },
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
    items: [
      { id: 'i1', variationId: 'v1', quantity: 2, flashSaleItemId: null },
      { id: 'i2', variationId: 'v2', quantity: 1, flashSaleItemId: 'fs1' },
    ],
    ...overrides,
  } as never;
}

describe('OrderReversalService', () => {
  let service: OrderReversalService;
  let flashSale: { restore: jest.Mock };

  beforeEach(async () => {
    flashSale = { restore: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [OrderReversalService, { provide: FlashSaleService, useValue: flashSale }],
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
    expect(tx.variation.update).toHaveBeenCalledTimes(2);
    expect(tx.variation.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { stock: { increment: 2 } },
    });
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
    expect(tx.variation.update).toHaveBeenCalledTimes(2);
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
    const order = makeOrder({ items: [{ id: 'i1', variationId: 'v1', quantity: 3, flashSaleItemId: null }] });
    await service.reverseFinancials(tx as never, order);
    expect(flashSale.restore).not.toHaveBeenCalled();
  });
});
