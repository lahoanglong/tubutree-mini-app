import { bankRefUsedByOrderMessage, findOrderUsingBankRef } from './bank-ref';

const db = (over: { history?: unknown[]; late?: unknown[]; order?: unknown }) =>
  ({
    orderStatusHistory: { findMany: jest.fn().mockResolvedValue(over.history ?? []) },
    orderCustomerRefund: { findMany: jest.fn().mockResolvedValue(over.late ?? []) },
    order: { findFirst: jest.fn().mockResolvedValue(over.order ?? null) },
  }) as never;

describe('bank-ref: mã giao dịch đã gắn với đơn', () => {
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
  });
});
