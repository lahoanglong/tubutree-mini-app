import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { WasteFeeBankService, wasteFeeMemo } from './waste-fee-bank.service';

const mockAssertAdmin = jest.fn();
jest.mock('../../../common/staff-access', () => ({ assertActiveAdmin: (...a: unknown[]) => mockAssertAdmin(...a) }));
const mockAssertBankRef = jest.fn();
jest.mock('../../../common/bank-ref', () => ({ assertBankRefUnusedByWasteFee: (...a: unknown[]) => mockAssertBankRef(...a) }));
const mockCreditWallet = jest.fn();
jest.mock('../../wallet/wallet-anonymized-guard', () => ({ creditWalletUnlessAnonymized: (...a: unknown[]) => mockCreditWallet(...a) }));
const mockEvent = jest.fn();
jest.mock('../core/waste-events', () => ({ writeWasteEvent: (...a: unknown[]) => mockEvent(...a) }));
const mockAdminDetail = jest.fn();
jest.mock('../receiving/waste-admin-detail.mapper', () => ({ loadAdminRequestDetail: (...a: unknown[]) => mockAdminDetail(...a) }));
const mockEnqueuePush = jest.fn();
jest.mock('../../integrations/gomdon/gomdon-queue', () => ({ enqueueGomdonWastePush: (...a: unknown[]) => mockEnqueuePush(...a) }));

const BASE_REQ = {
  id: 'r1',
  code: 'TR-A2C4E',
  userId: 'u1',
  pointId: 'wh',
  method: 'HOME_PICKUP',
  status: 'OPEN',
  expiresAt: new Date('2026-11-17T10:00:00.000Z'),
  shipFeeCashVnd: 17000,
  shipFeeCashMethod: 'BANK_TRANSFER',
  shipFeeCashPaidAt: null as Date | null,
  shipFeeCashRefundedVnd: null as number | null,
  shipFeeBankRef: null as string | null,
};

function setup(
  over: Partial<typeof BASE_REQ> | null = {},
  opts: { flip?: number; bankConfigured?: boolean } = {},
) {
  const row = over === null ? null : { ...BASE_REQ, ...over };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'r1' }]),
    wasteRequest: {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: opts.flip ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    wasteRequest: { findFirst: jest.fn().mockResolvedValue(row) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const configured = opts.bankConfigured ?? true;
  const systemConfig = {
    get: jest.fn(async (k: string, fb: string) => {
      if (!configured) return fb;
      const map: Record<string, string> = {
        'payment.bank_bin': '970422',
        'payment.bank_account_no': '0123456789',
        'payment.bank_account_name': 'TUBU TREE',
        'payment.bank_name': 'MB Bank',
      };
      return map[k] ?? fb;
    }),
  };
  const config = { snapshot: jest.fn().mockResolvedValue({ requestHoldDays: 7 }) };
  const access = {};
  const queue = { name: 'gomdon-push' };
  const svc = new WasteFeeBankService(prisma as never, systemConfig as never, config as never, access as never, queue as never);
  return { svc, prisma, tx, systemConfig, queue };
}

beforeEach(() => {
  mockAssertAdmin.mockReset().mockResolvedValue({ id: 'a1', role: 'ADMIN' });
  mockAssertBankRef.mockReset().mockResolvedValue(undefined);
  mockCreditWallet.mockReset().mockResolvedValue({ credited: true, balanceAfter: 17000, anonymizedAt: null });
  mockEvent.mockReset().mockResolvedValue({ id: 'ev1' });
  mockAdminDetail.mockReset().mockResolvedValue({ id: 'r1', code: 'TR-A2C4E' });
  mockEnqueuePush.mockReset().mockResolvedValue(undefined);
});

describe('WasteFeeBankService.getFeeQr', () => {
  it('sinh VietQR động gắn đúng mã phiếu (WR + mã bỏ gạch) và hạn thanh toán', async () => {
    expect(wasteFeeMemo('TR-A2C4E')).toBe('WRTRA2C4E');
    const { svc } = setup();
    const qr = await svc.getFeeQr('u1', 'r1');
    expect(qr).toMatchObject({
      orderCode: 'TR-A2C4E',
      amount: 17000,
      paymentStatus: 'UNPAID',
      paymentDeadline: '2026-11-17T10:00:00.000Z',
      bank: { bin: '970422', name: 'MB Bank', accountNo: '0123456789', accountName: 'TUBU TREE' },
      memo: 'WRTRA2C4E',
    });
    expect(qr.qrString).toContain('WRTRA2C4E');
    expect(qr.qrImageUrl).toContain('amount=17000');
    expect(qr.qrImageUrl).toContain('addInfo=WRTRA2C4E');
  });

  it('từ chối phiếu không thuộc khách / không phải BANK_TRANSFER / đã đóng khi chưa thu / thiếu cấu hình ngân hàng', async () => {
    await expect(setup(null).svc.getFeeQr('u1', 'r1')).rejects.toThrow(NotFoundException);
    await expect(setup({ shipFeeCashMethod: 'WALLET' }).svc.getFeeQr('u1', 'r1')).rejects.toThrow(BadRequestException);
    await expect(setup({ status: 'EXPIRED' }).svc.getFeeQr('u1', 'r1')).rejects.toThrow(BadRequestException);
    await expect(setup({}, { bankConfigured: false }).svc.getFeeQr('u1', 'r1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('phiếu đã thu hoặc đã hoàn vẫn trả trạng thái PAID / REFUNDED để giao diện dừng đếm ngược', async () => {
    const paid = await setup({ shipFeeCashPaidAt: new Date() }).svc.getFeeQr('u1', 'r1');
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.paymentDeadline).toBeNull();
    const refunded = await setup({ status: 'CANCELLED', shipFeeCashPaidAt: new Date(), shipFeeCashRefundedVnd: 17000 }).svc.getFeeQr('u1', 'r1');
    expect(refunded.paymentStatus).toBe('REFUNDED');
  });
});

describe('WasteFeeBankService.confirmFeeBankPaid', () => {
  it('phiếu OPEN: kiểm bankRef, khớp đúng shipFeeCashVnd, CAS PaidAt, kéo dài hạn giữ 7 ngày, ghi FEE_BANK_PAID và xếp job đẩy Gomdon', async () => {
    const { svc, tx, queue } = setup();
    const res = await svc.confirmFeeBankPaid('r1', { amount: 17000, bankRef: ' FT999 ', actorId: 'a1' });
    expect(res).toEqual({ outcome: 'PAID', request: { id: 'r1', code: 'TR-A2C4E' } });
    expect(mockAssertBankRef).toHaveBeenCalledWith(tx, 'FT999', 'r1');
    expect(tx.wasteRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'OPEN', shipFeeCashMethod: 'BANK_TRANSFER', shipFeeCashPaidAt: null },
      data: { shipFeeCashPaidAt: expect.any(Date), shipFeeBankRef: 'FT999', expiresAt: expect.any(Date) },
    });
    expect(mockEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ kind: 'FEE_BANK_PAID', actorUserId: 'a1', actorRole: 'ADMIN' }));
    expect(mockEnqueuePush).toHaveBeenCalledWith(queue, 'r1', 'TR-A2C4E');
  });

  it('số tiền lệch shipFeeCashVnd -> 400, không chốt PaidAt, không đẩy Gomdon', async () => {
    const { svc, tx } = setup();
    await expect(svc.confirmFeeBankPaid('r1', { amount: 15000, bankRef: 'FT999', actorId: 'a1' })).rejects.toThrow(BadRequestException);
    expect(tx.wasteRequest.updateMany).not.toHaveBeenCalled();
    expect(mockEnqueuePush).not.toHaveBeenCalled();
  });

  it('tiền về sau khi phiếu đã đóng (CANCELLED / EXPIRED): cộng thẳng vào Ví Tubu (WASTE_FEE_REFUND), KHÔNG mở lại phiếu, KHÔNG đẩy Gomdon', async () => {
    const { svc, tx } = setup({ status: 'EXPIRED' });
    const res = await svc.confirmFeeBankPaid('r1', { amount: 17000, bankRef: 'FT-LATE', actorId: 'a1' });
    expect(res.outcome).toBe('CREDITED_LATE_TO_WALLET');
    expect(tx.wasteRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: { in: ['CANCELLED', 'EXPIRED'] }, shipFeeCashMethod: 'BANK_TRANSFER', shipFeeCashPaidAt: null, shipFeeCashRefundedVnd: null },
      data: { shipFeeCashPaidAt: expect.any(Date), shipFeeBankRef: 'FT-LATE', shipFeeCashRefundedVnd: 17000 },
    });
    expect(mockCreditWallet).toHaveBeenCalledWith(tx, expect.objectContaining({ userId: 'u1', delta: 17000, type: 'WASTE_FEE_REFUND', refId: 'r1' }));
    expect(mockEnqueuePush).not.toHaveBeenCalled();
  });

  it('phát lại cùng bankRef -> ALREADY_PAID không đẩy lại; khác bankRef trên phiếu đã thu -> 409', async () => {
    const same = setup({ shipFeeCashPaidAt: new Date(), shipFeeBankRef: 'FT999' });
    await expect(same.svc.confirmFeeBankPaid('r1', { amount: 17000, bankRef: 'ft999', actorId: 'a1' })).resolves.toMatchObject({ outcome: 'ALREADY_PAID' });
    expect(mockEnqueuePush).not.toHaveBeenCalled();

    const diff = setup({ shipFeeCashPaidAt: new Date(), shipFeeBankRef: 'FT999' });
    await expect(diff.svc.confirmFeeBankPaid('r1', { amount: 17000, bankRef: 'FT000', actorId: 'a1' })).rejects.toThrow(ConflictException);
  });
});
