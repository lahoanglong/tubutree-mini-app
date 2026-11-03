import { alreadyPaidConflict } from './payout-paid-conflict';

const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ fullName: 'An' }) } };
const row = { paidBy: 'a1', paidAt: new Date('2026-11-01T03:00:00Z'), bankRef: 'FT1' };

describe('alreadyPaidConflict', () => {
  it('lệnh rút CTV gọi là "Lệnh rút" và dặn thu hồi khoản chuyển trùng', async () => {
    const e = await alreadyPaidConflict(prisma, row, { noun: 'Lệnh rút' });
    expect(e.message).toContain('Lệnh rút đã được An xác nhận chuyển lúc');
    expect(e.message).toContain('mã GD FT1');
    expect(e.message).toContain('thu hồi khoản chuyển trùng');
  });

  it('phiếu gian hàng chuyển đi gọi là "Phiếu đối soát"', async () => {
    const e = await alreadyPaidConflict(prisma, row, { noun: 'Phiếu đối soát' });
    expect(e.message).toContain('Phiếu đối soát đã được An xác nhận chuyển');
    expect(e.message).toContain('thu hồi');
  });

  it('phiếu âm (Tubu thu tiền): nói "đã thu", không dặn thu hồi', async () => {
    const e = await alreadyPaidConflict(prisma, row, { noun: 'Phiếu đối soát', collected: true });
    expect(e.message).toContain('Phiếu đối soát đã được An xác nhận đã thu');
    expect(e.message).not.toContain('thu hồi');
    expect(e.message).not.toContain('chuyển');
  });

  it('cùng người gửi lại với mã GD khác: 409 nói là chính bạn, giờ VN, chỉ dặn thu hồi khi đã chuyển thêm thật', async () => {
    const e = await alreadyPaidConflict(prisma, row, { noun: 'Lệnh rút', actorId: 'a1' });
    expect(e.message).toBe('Bạn đã xác nhận khoản này lúc 10:00 01/11/2026 với mã GD «FT1». Hệ thống không ghi lần hai. Nếu bạn đã chuyển thêm một lần nữa, liên hệ người nhận để thu hồi khoản chuyển trùng.');
    expect(e.message).not.toContain('An xác nhận');
  });

  it('cùng người, phiếu âm (Tubu thu tiền): không dặn thu hồi', async () => {
    const e = await alreadyPaidConflict(prisma, row, { noun: 'Phiếu đối soát', collected: true, actorId: 'a1' });
    expect(e.message).toBe('Bạn đã xác nhận khoản này lúc 10:00 01/11/2026 với mã GD «FT1». Hệ thống không ghi lần hai.');
  });

  it('cùng người, lần đầu bỏ trống mã: bỏ phần mã GD', async () => {
    const e = await alreadyPaidConflict(prisma, { ...row, bankRef: null }, { noun: 'Phiếu đối soát', actorId: 'a1' });
    expect(e.message).toBe('Bạn đã xác nhận khoản này lúc 10:00 01/11/2026. Hệ thống không ghi lần hai. Nếu bạn đã chuyển thêm một lần nữa, liên hệ người nhận để thu hồi khoản chuyển trùng.');
  });

  it('người khác vẫn nhận câu dặn thu hồi dù có truyền actorId', async () => {
    const e = await alreadyPaidConflict(prisma, row, { noun: 'Lệnh rút', actorId: 'a2' });
    expect(e.message).toContain('An xác nhận chuyển');
    expect(e.message).toContain('thu hồi');
  });
});
