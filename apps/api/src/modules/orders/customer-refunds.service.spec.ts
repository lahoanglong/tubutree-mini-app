import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerRefundsService } from './customer-refunds.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';

jest.mock('../wallet/wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn().mockResolvedValue({ applied: true, balanceAfter: 0, entryId: 'wtx' }),
}));

const pending = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  orderId: 'o1',
  orderCode: 'TB100',
  kind: 'CANCEL',
  userId: 'u1',
  amount: 114_000,
  method: 'MANUAL_TRANSFER',
  status: 'PENDING',
  bankName: 'Techcombank',
  bankAccountNo: '190312345678',
  bankAccountName: 'NGUYEN VAN A',
  bankRef: null,
  completedAt: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

function setup(row: Record<string, unknown> | null = pending()) {
  const tx = { orderCustomerRefund: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  const prisma = {
    orderCustomerRefund: {
      findUnique: jest.fn().mockResolvedValue(row),
      findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue(row ? [row] : []),
    },
    returnRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    payout: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
  const service = new CustomerRefundsService(prisma as never, notifications as never);
  return { service, prisma, tx, notifications };
}

describe('CustomerRefundsService.markPaid (D2: admin chuyển khoản tay rồi xác nhận)', () => {
  beforeEach(() => (applyWalletDelta as jest.Mock).mockClear());

  it('bắt buộc mã giao dịch ngân hàng', async () => {
    const { service } = setup();
    await expect(service.markPaid('a1', 'r1', { bankRef: '  ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('khoản của khách chưa có tài khoản nhận → không cho xác nhận khi admin không nhập tài khoản', async () => {
    const { service, prisma } = setup(pending({ bankAccountNo: null, bankName: null, bankAccountName: null }));
    await expect(service.markPaid('a1', 'r1', { bankRef: 'FT123' })).rejects.toThrow('chưa có tài khoản nhận');
    expect(prisma.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('xác nhận xong → báo khách kèm số tiền, tài khoản che số và mã giao dịch', async () => {
    const { service, prisma, notifications } = setup();
    await service.markPaid('a1', 'r1', { bankRef: 'FT123' });
    expect(prisma.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', method: 'MANUAL_TRANSFER', status: 'PENDING' },
      data: expect.objectContaining({ status: 'COMPLETED', bankRef: 'FT123', completedBy: 'a1' }),
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFUND_BANK_COMPLETED', {
      order_code: 'TB100',
      amount: '114.000đ',
      bank: 'Techcombank ••• 5678',
      bank_ref: 'FT123',
    });
  });

  it('khoản vừa được khách chuyển sang Ví (guard thua) → báo tải lại, không báo khách', async () => {
    const { service, prisma, notifications } = setup();
    prisma.orderCustomerRefund.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markPaid('a1', 'r1', { bankRef: 'FT123' })).rejects.toThrow('tải lại');
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('CustomerRefundsService.chooseDestination (khách chọn nơi nhận khoản chờ)', () => {
  beforeEach(() => (applyWalletDelta as jest.Mock).mockClear());

  it('chọn Ví Tubu → đóng khoản và cộng Ví đúng số tiền, khoá theo id khoản', async () => {
    const { service, tx, notifications } = setup(pending({ kind: 'LATE_PAYMENT', bankAccountNo: null }));
    await service.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', userId: 'u1', method: 'MANUAL_TRANSFER', status: 'PENDING' },
      data: expect.objectContaining({ method: 'WALLET', status: 'COMPLETED' }),
    });
    expect(applyWalletDelta).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: 'u1', delta: 114_000, refType: 'CUSTOMER_REFUND', refId: 'r1' }));
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFUND_WALLET_CREDITED', { order_code: 'TB100', amount: '114.000đ' });
  });

  it('admin vừa xác nhận đã chuyển (guard thua) → KHÔNG cộng Ví', async () => {
    const { service, tx } = setup();
    tx.orderCustomerRefund.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' })).rejects.toBeInstanceOf(BadRequestException);
    expect(applyWalletDelta).not.toHaveBeenCalled();
  });

  it('khoản của người khác → 404', async () => {
    const { service } = setup(pending({ userId: 'u2' }));
    await expect(service.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('khoản đã hoàn tất → không đổi nơi nhận', async () => {
    const { service } = setup(pending({ status: 'COMPLETED' }));
    await expect(service.chooseDestination('u1', 'r1', { refundMethod: 'BANK' })).rejects.toThrow('đã được xử lý');
  });

  it('chọn ngân hàng → chuẩn hoá và lưu tài khoản, không cộng Ví', async () => {
    const { service, prisma } = setup(pending({ bankAccountNo: null }));
    await service.chooseDestination('u1', 'r1', {
      refundMethod: 'BANK',
      bankName: 'Vietcombank',
      accountNumber: '0071 000.123-456',
      accountName: 'tran thi b',
    });
    expect(prisma.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', userId: 'u1', method: 'MANUAL_TRANSFER', status: 'PENDING' },
      data: { bankName: 'Vietcombank', bankAccountNo: '0071000123456', bankAccountName: 'TRAN THI B' },
    });
    expect(applyWalletDelta).not.toHaveBeenCalled();
  });
});

describe('CustomerRefundsService.lastBankDetails', () => {
  it('lấy tài khoản mới nhất giữa khoản hoàn, yêu cầu trả và lệnh rút Ví', async () => {
    const { service, prisma } = setup();
    prisma.orderCustomerRefund.findFirst.mockResolvedValue({
      bankName: 'ACB',
      bankAccountNo: '111111',
      bankAccountName: 'A',
      createdAt: new Date('2026-09-01'),
    });
    prisma.payout.findFirst.mockResolvedValue({
      bankInfo: { bankName: 'MB', accountNumber: '222222', accountName: 'B' },
      requestedAt: new Date('2026-10-01'),
    });
    await expect(service.lastBankDetails('u1')).resolves.toEqual({ bankName: 'MB', accountNumber: '222222', accountName: 'B' });
  });

  it('chưa từng nhập → null', async () => {
    const { service } = setup();
    await expect(service.lastBankDetails('u1')).resolves.toBeNull();
  });
});
