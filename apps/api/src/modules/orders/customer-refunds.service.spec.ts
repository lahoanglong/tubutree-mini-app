import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
  const tx = {
    orderCustomerRefund: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    order: { findUnique: jest.fn().mockResolvedValue({ status: 'CANCELLED' }) },
    orderStatusHistory: { create: jest.fn().mockResolvedValue({}) },
  };
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
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'a1', fullName: 'Admin An', phone: null }]) },
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
    const { service, tx, notifications } = setup(pending({ status: 'PROCESSING', claimedBy: 'a1' }));
    await service.markPaid('a1', 'r1', { bankRef: 'FT123' });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', method: 'MANUAL_TRANSFER', OR: [{ status: 'PROCESSING', claimedBy: 'a1' }] },
      data: expect.objectContaining({ status: 'COMPLETED', bankRef: 'FT123', completedBy: 'a1' }),
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFUND_BANK_COMPLETED', {
      order_code: 'TB100',
      amount: '114.000đ',
      bank: 'Techcombank ••• 5678',
      bank_ref: 'FT123',
    });
  });

  it('khoản chưa khoá bằng "Bắt đầu chuyển khoản" → không cho xác nhận (khách còn đổi sang Ví được)', async () => {
    const { service, prisma, notifications } = setup();
    await expect(service.markPaid('a1', 'r1', { bankRef: 'FT123' })).rejects.toThrow('Bắt đầu chuyển khoản');
    expect(prisma.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('khoản khách cuối đơn CTV (không có tài khoản khách) → xác nhận thẳng từ hàng chờ được', async () => {
    const { service, tx } = setup(pending({ kind: 'END_CUSTOMER', userId: null, bankAccountNo: null }));
    await service.markPaid('a1', 'r1', { bankRef: 'FT123' });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', method: 'MANUAL_TRANSFER', OR: [{ status: 'PENDING' }] } }),
    );
  });

  it('khoản vừa được xử lý (guard thua) → báo tải lại, không báo khách', async () => {
    const { service, tx, notifications } = setup(pending({ status: 'PROCESSING', claimedBy: 'a1' }));
    tx.orderCustomerRefund.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markPaid('a1', 'r1', { bankRef: 'FT123' })).rejects.toThrow('tải lại');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('R3-MONEY-4: admin khác người đang chuyển khoản → không xác nhận được, nói rõ ai đang chuyển', async () => {
    const { service, tx, notifications } = setup(pending({ status: 'PROCESSING', claimedBy: 'a1', claimedAt: new Date('2026-10-14T03:05:00Z') }));
    await expect(service.markPaid('a2', 'r1', { bankRef: 'FT999' })).rejects.toThrow(
      'Khoản này đang do Admin An chuyển khoản từ 10:05 14/10/2026',
    );
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('R3-MONEY-4: admin khác chọn "Tiếp quản" kèm lý do → xác nhận được, ghi lịch sử đơn trong cùng tx', async () => {
    const { service, tx } = setup(pending({ status: 'PROCESSING', claimedBy: 'a1', claimedAt: new Date('2026-10-14T03:05:00Z') }));
    await service.markPaid('a2', 'r1', { bankRef: 'FT999', takeOver: true, takeOverReason: 'An nghỉ phép, đã kiểm tra sao kê' });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', method: 'MANUAL_TRANSFER', OR: [{ status: 'PROCESSING', claimedBy: 'a1' }] } }),
    );
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'o1',
        actorType: 'ADMIN',
        actorId: 'a2',
        note: expect.stringMatching(/tiếp quản khoản Admin An.*Lý do: An nghỉ phép, đã kiểm tra sao kê · Mã GD FT999/),
      }),
    });
  });
});

describe('CustomerRefundsService.claim (R2-LIFECYCLE-2: "Đang chuyển khoản" khoá nơi nhận)', () => {
  it('khoá khoản PENDING có tài khoản → PROCESSING, ghi ai nhận', async () => {
    const { service, prisma } = setup();
    await service.claim('a1', 'r1');
    expect(prisma.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', method: 'MANUAL_TRANSFER', status: 'PENDING' },
      data: expect.objectContaining({ status: 'PROCESSING', claimedBy: 'a1', claimedAt: expect.any(Date) }),
    });
  });

  it('khách đã chọn Ví trước → báo rõ thời điểm, dặn KHÔNG chuyển khoản', async () => {
    const { service, prisma } = setup();
    prisma.orderCustomerRefund.updateMany.mockResolvedValue({ count: 0 });
    prisma.orderCustomerRefund.findUnique
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending({ method: 'WALLET', status: 'COMPLETED', completedAt: new Date('2026-10-14T03:05:00Z') }));
    await expect(service.claim('a1', 'r1')).rejects.toThrow('Khách đã chọn nhận khoản này về Ví Tubu lúc 10:05 14/10/2026');
  });

  it('chưa có tài khoản và admin không nhập → không cho nhận', async () => {
    const { service, prisma } = setup(pending({ bankAccountNo: null }));
    await expect(service.claim('a1', 'r1')).rejects.toThrow('chưa có tài khoản nhận');
    expect(prisma.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('trả về hàng chờ → PENDING, xoá người nhận', async () => {
    const { service, tx } = setup(pending({ status: 'PROCESSING', claimedBy: 'a1' }));
    await service.release('a1', 'r1');
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', method: 'MANUAL_TRANSFER', status: 'PROCESSING', claimedBy: 'a1' },
      data: { status: 'PENDING', claimedBy: null, claimedAt: null },
    });
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
  });

  it('R3-MONEY-4: admin khác không trả được khoản người khác đang chuyển về hàng chờ (khách sẽ rút được về Ví)', async () => {
    const { service, tx } = setup(pending({ status: 'PROCESSING', claimedBy: 'a1' }));
    await expect(service.release('a2', 'r1')).rejects.toThrow('Chỉ người đó được trả về hàng chờ');
    await expect(service.release('a2', 'r1', { takeOver: true, takeOverReason: ' ' })).rejects.toThrow('Tiếp quản');
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });
});

describe('CustomerRefundsService.chooseDestination (khách chọn nơi nhận khoản chờ)', () => {
  it('admin đang chuyển khoản (PROCESSING) → khách không đổi được sang Ví, nói rõ lý do', async () => {
    const { service, tx } = setup(pending({ status: 'PROCESSING' }));
    await expect(service.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' })).rejects.toThrow('Tubu đang chuyển khoản');
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
    expect(applyWalletDelta).not.toHaveBeenCalled();
  });

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

const unverified = (over: Record<string, unknown> = {}) =>
  pending({
    kind: 'OVERPAYMENT',
    refKey: 'PANCAKE:paid:228000',
    status: 'UNVERIFIED',
    reason: 'CONFIRMED',
    bankName: null,
    bankAccountNo: null,
    bankAccountName: null,
    ...over,
  });

describe('CustomerRefundsService — khoản tiền dư Pancake chờ đối soát (UNVERIFIED)', () => {
  beforeEach(() => (applyWalletDelta as jest.Mock).mockClear());

  it('khách không thấy khoản chờ đối soát / đã bỏ qua ở chi tiết đơn', async () => {
    const { service, prisma } = setup();
    await service.listMine('u1', 'o1');
    expect(prisma.orderCustomerRefund.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', orderId: 'o1', status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] } } }),
    );
  });

  it.each(['UNVERIFIED', 'DISMISSED'])('khách KHÔNG chọn Ví được cho khoản %s (không cộng Ví, không ghi)', async (status) => {
    const { service, prisma, tx } = setup(unverified({ status }));
    await expect(service.chooseDestination('u1', 'r1', { refundMethod: 'WALLET' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.chooseDestination('u1', 'r1', { refundMethod: 'BANK', bankName: 'ACB', accountNumber: '123456', accountName: 'A' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
    expect(applyWalletDelta).not.toHaveBeenCalled();
  });

  it('admin không "Bắt đầu chuyển khoản" được khoản chưa đối soát — nói rõ phải xác nhận trước', async () => {
    const { service, prisma } = setup(unverified({ bankAccountNo: '190312345678' }));
    prisma.orderCustomerRefund.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.claim('a1', 'r1')).rejects.toThrow('chưa được xác nhận là tiền khách trả dư');
  });

  it('xác nhận đã đối chiếu sao kê → PENDING (khách chọn nơi nhận), ghi lịch sử đơn, báo khách số tiền', async () => {
    const { service, tx, notifications } = setup(unverified());
    await service.verifyOverpayment('a1', 'r1', { note: 'Sao kê VCB 14/10 có 2 lần chuyển' });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', kind: 'OVERPAYMENT', status: 'UNVERIFIED' },
      data: { status: 'PENDING', amount: 114_000, adminNote: 'Sao kê VCB 14/10 có 2 lần chuyển' },
    });
    expect(tx.orderCustomerRefund.createMany).not.toHaveBeenCalled();
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'o1',
        actorType: 'ADMIN',
        actorId: 'a1',
        note: expect.stringContaining('Xác nhận tiền trả dư 114.000đ'),
      }),
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFUND_OVERPAYMENT', { order_code: 'TB100', amount: '114.000đ' });
  });

  it('sao kê chỉ có một phần → khoản còn đúng số thực nhận, phần còn lại ghi "đã bỏ qua" (Pancake báo lại không đẻ thêm)', async () => {
    const { service, tx, notifications } = setup(unverified());
    await service.verifyOverpayment('a1', 'r1', { amount: 50_000 });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', kind: 'OVERPAYMENT', status: 'UNVERIFIED' },
      data: expect.objectContaining({ status: 'PENDING', amount: 50_000 }),
    });
    expect(tx.orderCustomerRefund.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          orderId: 'o1',
          kind: 'OVERPAYMENT',
          refKey: 'PANCAKE:paid:228000:rest',
          amount: 64_000,
          status: 'DISMISSED',
          completedBy: 'a1',
        }),
      ],
      skipDuplicates: true,
    });
    expect(notifications.notify).toHaveBeenCalledWith('u1', 'REFUND_OVERPAYMENT', { order_code: 'TB100', amount: '50.000đ' });
  });

  it.each([0, -1, 114_001, 1.5])('số tiền xác nhận %p ngoài 1đ..số Pancake báo dư → từ chối', async (amount) => {
    const { service, tx } = setup(unverified());
    await expect(service.verifyOverpayment('a1', 'r1', { amount })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('khoản không còn chờ đối soát (admin khác vừa xử lý) → báo tải lại, không báo khách', async () => {
    const { service, tx, notifications } = setup(unverified());
    tx.orderCustomerRefund.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.verifyOverpayment('a1', 'r1', {})).rejects.toThrow('không còn chờ đối soát');
    expect(tx.orderStatusHistory.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('khoản thường (đã PENDING) → không phải việc đối soát', async () => {
    const { service, tx } = setup(pending({ kind: 'OVERPAYMENT' }));
    await expect(service.verifyOverpayment('a1', 'r1', {})).rejects.toThrow('không còn chờ đối soát');
    await expect(service.dismissOverpayment('a1', 'r1', { reason: 'Không có trên sao kê' })).rejects.toThrow('không còn chờ đối soát');
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('"Không phải tiền dư" bắt buộc lý do ≥ 5 ký tự', async () => {
    const { service, tx } = setup(unverified());
    await expect(service.dismissOverpayment('a1', 'r1', { reason: ' ab ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('"Không phải tiền dư" → DISMISSED, ghi ai/lý do vào khoản và lịch sử đơn, KHÔNG báo khách', async () => {
    const { service, tx, notifications } = setup(unverified());
    await service.dismissOverpayment('a1', 'r1', { reason: 'Nhân viên thêm phí ship trên Pancake, khách trả đúng' });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', kind: 'OVERPAYMENT', status: 'UNVERIFIED' },
      data: {
        status: 'DISMISSED',
        adminNote: 'Nhân viên thêm phí ship trên Pancake, khách trả đúng',
        completedBy: 'a1',
        completedAt: expect.any(Date),
      },
    });
    expect(tx.orderStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: 'a1', note: expect.stringContaining('Không phải tiền trả dư') }),
    });
    expect(notifications.notify).not.toHaveBeenCalled();
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

// R4-ADMIN-3: thẻ "Hoàn tiền khách" ở trang chủ đếm UNVERIFIED + PENDING + PROCESSING; bấm vào phải ra đúng ngần ấy dòng.
describe('CustomerRefundsService.list — bộ lọc "Đang mở"', () => {
  function listSetup() {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const prisma = {
      orderCustomerRefund: { findMany, count },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    return { service: new CustomerRefundsService(prisma as never), findMany, count };
  }

  it('OPEN = chờ đối soát + chờ chuyển khoản + đang chuyển khoản, cũ nhất trước; số đếm cùng điều kiện', async () => {
    const { service, findMany, count } = listSetup();
    await service.list('OPEN', 1, 20);
    const where = { status: { in: ['UNVERIFIED', 'PENDING', 'PROCESSING'] } };
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, orderBy: { createdAt: 'asc' } }));
    expect(count).toHaveBeenCalledWith({ where });
  });

  it('OPEN kèm loại khoản; trạng thái cụ thể giữ như cũ', async () => {
    const { service, findMany } = listSetup();
    await service.list('OPEN', 1, 20, 'LATE_PAYMENT');
    expect(findMany.mock.calls[0][0].where).toEqual({ status: { in: ['UNVERIFIED', 'PENDING', 'PROCESSING'] }, kind: 'LATE_PAYMENT' });
    await service.list('COMPLETED', 1, 20);
    expect(findMany.mock.calls[1][0]).toMatchObject({ where: { status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
  });
});

// MONEY-1: khoản tiền về muộn / trả dư của đơn CTV lên hộ là của khách cuối (userId null) — cùng đường xử lý với END_CUSTOMER.
describe('CustomerRefundsService — khoản của khách cuối đơn CTV lên hộ không phải END_CUSTOMER (userId null)', () => {
  beforeEach(() => (applyWalletDelta as jest.Mock).mockClear());

  const endCustomerLate = (over: Record<string, unknown> = {}) =>
    pending({
      kind: 'LATE_PAYMENT',
      refKey: 'PANCAKE:paid:228000',
      userId: null,
      phone: '0912345678',
      recipientName: 'Khach That',
      bankName: null,
      bankAccountNo: null,
      bankAccountName: null,
      reason: 'CANCELLED',
      ...over,
    });

  it.each(['LATE_PAYMENT', 'OVERPAYMENT', 'RETURN'])('%s không chủ tài khoản: admin xác nhận thẳng từ hàng chờ, không bắt gõ tài khoản', async (kind) => {
    const { service, tx } = setup(endCustomerLate({ kind }));
    await service.markPaid('a1', 'r1', { bankRef: 'FT123' });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', method: 'MANUAL_TRANSFER', OR: [{ status: 'PENDING' }] } }),
    );
  });

  it('không chủ tài khoản: "Bắt đầu chuyển khoản" không đòi tài khoản nhận', async () => {
    const { service, prisma } = setup(endCustomerLate());
    await service.claim('a1', 'r1');
    expect(prisma.orderCustomerRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1', method: 'MANUAL_TRANSFER', status: 'PENDING' } }),
    );
  });

  it('khoản của khách có tài khoản (userId có giá trị) vẫn bắt buộc tài khoản nhận', async () => {
    const { service, prisma } = setup(endCustomerLate({ userId: 'u1' }));
    await expect(service.claim('a1', 'r1')).rejects.toThrow('chưa có tài khoản nhận');
    await expect(service.markPaid('a1', 'r1', { bankRef: 'FT123' })).rejects.toThrow('chưa có tài khoản nhận');
    expect(prisma.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('CTV (chủ đơn) không chọn được nơi nhận khoản của khách cuối: 404, không cộng Ví, không ghi', async () => {
    const { service, prisma, tx } = setup(endCustomerLate());
    await expect(service.chooseDestination('ctv1', 'r1', { refundMethod: 'WALLET' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.chooseDestination('ctv1', 'r1', { refundMethod: 'BANK', bankName: 'ACB', accountNumber: '123456', accountName: 'CTV' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(applyWalletDelta).not.toHaveBeenCalled();
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
    expect(prisma.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('xác nhận tiền dư một phần: khoản còn lại mang SĐT + tên khách cuối, không báo ai', async () => {
    const { service, tx, notifications } = setup(unverified({ userId: null, phone: '0912345678', recipientName: 'Khach That' }));
    await service.verifyOverpayment('a1', 'r1', { amount: 50_000 });
    expect(tx.orderCustomerRefund.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ refKey: 'PANCAKE:paid:228000:rest', userId: null, phone: '0912345678', recipientName: 'Khach That', status: 'DISMISSED' })],
      skipDuplicates: true,
    });
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('xác nhận xong khoản không chủ tài khoản → không có ai để báo REFUND_BANK_COMPLETED', async () => {
    const { service, notifications } = setup(endCustomerLate());
    await service.markPaid('a1', 'r1', { bankRef: 'FT123' });
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('CustomerRefundsService — nhân viên Kế toán xử lý hoàn tiền (D1-05)', () => {
  const typed = { bankName: 'ACB', accountNumber: '999988887777', accountName: 'Tran Van B' };

  it('nhân viên không đổi được tài khoản khách đã có lúc "Bắt đầu chuyển khoản" (chuyển tiền về tài khoản khác)', async () => {
    const { service, prisma } = setup();
    await expect(service.claim('s1', 'r1', { ...typed, byStaff: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('nhân viên không đổi được tài khoản khách đã có lúc xác nhận đã chuyển', async () => {
    const { service, tx, notifications } = setup(pending({ status: 'PROCESSING', claimedBy: 's1' }));
    await expect(service.markPaid('s1', 'r1', { bankRef: 'FT1', ...typed, byStaff: true })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('khoản chưa có tài khoản: nhân viên nhập tài khoản khách gửi qua kênh khác được', async () => {
    const { service, prisma } = setup(pending({ bankAccountNo: null, bankName: null, bankAccountName: null }));
    await service.claim('s1', 'r1', { ...typed, byStaff: true });
    expect(prisma.orderCustomerRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bankAccountNo: '999988887777', claimedBy: 's1' }) }),
    );
  });

  it('quản trị viên vẫn sửa được tài khoản đã có (khách báo đổi tài khoản)', async () => {
    const { service, prisma } = setup();
    await service.claim('a1', 'r1', typed);
    expect(prisma.orderCustomerRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ bankAccountNo: '999988887777' }) }),
    );
  });

  it('nhân viên không "Bắt đầu chuyển khoản" khoản hoàn của chính mình', async () => {
    const { service, prisma } = setup(pending({ userId: 's1' }));
    await expect(service.claim('s1', 'r1', { byStaff: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('nhân viên không xác nhận đã chuyển khoản hoàn của chính mình', async () => {
    const { service, tx } = setup(pending({ userId: 's1', status: 'PROCESSING', claimedBy: 's1' }));
    await expect(service.markPaid('s1', 'r1', { bankRef: 'FT1', byStaff: true })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('nhân viên không xác nhận / bỏ qua tiền dư của chính mình', async () => {
    const { service, tx } = setup(unverified({ userId: 's1' }));
    await expect(service.verifyOverpayment('s1', 'r1', { byStaff: true })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.dismissOverpayment('s1', 'r1', { reason: 'Cùng một lần chuyển', byStaff: true })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.orderCustomerRefund.updateMany).not.toHaveBeenCalled();
  });

  it('nhân viên xử lý khoản của khách khác như thường', async () => {
    const { service, tx } = setup(unverified());
    await service.verifyOverpayment('s1', 'r1', { byStaff: true });
    expect(tx.orderCustomerRefund.updateMany).toHaveBeenCalled();
  });
});
