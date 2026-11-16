import { ConflictException } from '@nestjs/common';
import {
  assertBankRefUnusedByOrder,
  assertBankRefUnusedByWasteFee,
  bankRefUsedByOrderMessage,
  bankRefUsedByWasteMessage,
  findOrderUsingBankRef,
  findWasteRequestUsingBankRef,
} from './bank-ref';

const db = (over: { history?: unknown[]; late?: unknown[]; order?: unknown; waste?: unknown; dealer?: unknown[] }) =>
  ({
    $executeRaw: jest.fn().mockResolvedValue(1),
    orderStatusHistory: { findMany: jest.fn().mockResolvedValue(over.history ?? []) },
    orderCustomerRefund: { findMany: jest.fn().mockResolvedValue(over.late ?? []) },
    order: { findFirst: jest.fn().mockResolvedValue(over.order ?? null) },
    dealerCreditLedger: { findMany: jest.fn().mockResolvedValue(over.dealer ?? []) },
    wasteRequest: { findFirst: jest.fn().mockResolvedValue(over.waste ?? null) },
  }) as never;

describe('bank-ref: mã giao dịch đã gắn với đơn hoặc phí thu gom', () => {
  it('mã nằm trong lịch sử xác nhận đơn: nói đã dùng để xác nhận đơn', async () => {
    const used = await findOrderUsingBankRef(db({ history: [{ orderId: 'o1', note: 'Admin xác nhận · Mã GD FT1' }], order: { code: 'TB1' } }), 'FT1');
    expect(used).toEqual({ code: 'TB1', late: false });
    expect(bankRefUsedByOrderMessage('FT1', used!)).toBe('Mã giao dịch FT1 đã dùng để xác nhận đơn TB1. Kiểm tra lại mã hoặc bỏ trống ô mã.');
  });

  it('mã chỉ nằm ở khoản hoàn tiền về muộn của đơn đã huỷ: không nói "xác nhận đơn", nói đã ghi cho tiền về muộn của đơn đã đóng', async () => {
    const used = await findOrderUsingBankRef(db({ late: [{ orderId: 'o2', adminNote: 'Admin ghi nhận tiền về muộn · Mã GD FT2' }], order: { code: 'TB2' } }), 'FT2');
    expect(used).toEqual({ code: 'TB2', late: true });
    const msg = bankRefUsedByOrderMessage('FT2', used!);
    expect(msg).toBe('Mã giao dịch FT2 đã ghi cho khoản tiền về muộn của đơn TB2 (đơn đã đóng). Kiểm tra lại mã hoặc bỏ trống ô mã.');
    expect(msg).not.toContain('xác nhận đơn');
  });

  it('không đâu dùng mã: null', async () => {
    expect(await findOrderUsingBankRef(db({}), 'FT3')).toBeNull();
    expect(await findWasteRequestUsingBankRef(db({}), 'FT3')).toBeNull();
  });

  it('mã đã dùng cho phí thu gom rác: chặn xác nhận đơn và chặn xác nhận phiếu thu gom khác', async () => {
    const tx = db({ waste: { code: 'TR-A2C4E' } });
    expect(await findWasteRequestUsingBankRef(tx, 'FT4')).toEqual({ code: 'TR-A2C4E' });
    expect(bankRefUsedByWasteMessage('FT4', { code: 'TR-A2C4E' })).toContain('TR-A2C4E');
    await expect(assertBankRefUnusedByOrder(tx, 'FT4', 'o9')).rejects.toThrow(ConflictException);
    await expect(assertBankRefUnusedByWasteFee(tx, 'FT4', 'r9')).rejects.toThrow(ConflictException);
  });

  it('mã đã dùng cho đơn hàng: chặn xác nhận phí thu gom rác', async () => {
    const tx = db({ history: [{ orderId: 'o1', note: 'Admin xác nhận · Mã GD FT5' }], order: { code: 'TB5' } });
    await expect(assertBankRefUnusedByWasteFee(tx, 'FT5', 'r1')).rejects.toThrow('Mã giao dịch FT5 đã dùng để xác nhận đơn TB5');
  });
});
