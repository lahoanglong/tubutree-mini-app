import type { JwtPayload } from '@tubutree/shared-types';
import { ReturnsAdminController } from './returns-admin.controller';
import type { OrderReturnsService } from './order-returns.service';

const row = { id: 'r1', status: 'APPROVED', bankName: 'MB', bankAccountNo: '0123456789', bankAccountName: 'NGUYEN A', refundMethod: 'BANK', refundAmount: 100_000,
  refund: { method: 'MANUAL_TRANSFER', status: 'PENDING', amount: 100_000, bankName: 'MB', bankAccountNo: '0123456789', completedAt: null } };

function setup() {
  const returns = {
    listForAdmin: jest.fn().mockResolvedValue({ data: [{ ...row }], meta: { page: 1, limit: 20, total: 1 } }),
    review: jest.fn().mockResolvedValue({ ...row }),
    markReceived: jest.fn().mockResolvedValue({ ...row }),
  };
  return { returns, controller: new ReturnsAdminController(returns as unknown as OrderReturnsService) };
}
const viewer = (over: Partial<JwtPayload>) => ({ sub: 'v1', role: 'STAFF', ...over }) as JwtPayload;
const query = { page: 1, limit: 20 } as never;

describe('ReturnsAdminController — RB-05: tài khoản ngân hàng nhận hoàn chỉ ADMIN/CSKH thấy', () => {
  it('nhân viên chỉ KHO: danh sách không có bank*', async () => {
    const { controller } = setup();
    const res = await controller.list(query, viewer({ staffPermissions: ['KHO'] }));
    expect(res.data[0]).not.toHaveProperty('bankAccountNo');
    expect(res.data[0]).not.toHaveProperty('bankAccountName');
    expect(res.data[0]).not.toHaveProperty('bankName');
    expect(res.data[0]).toMatchObject({ id: 'r1', refundMethod: 'BANK', refundAmount: 100_000 });
    const refund = (res.data[0] as { refund: unknown }).refund;
    expect(refund).not.toHaveProperty('bankAccountNo');
    expect(refund).not.toHaveProperty('bankName');
    expect(refund).toMatchObject({ method: 'MANUAL_TRANSFER', status: 'PENDING', amount: 100_000 });
  });

  it('nhân viên KHO bấm "Đã nhận hàng về": phản hồi cũng không có bank*', async () => {
    const { controller } = setup();
    const res = (await controller.received('v1', 'r1', viewer({ staffPermissions: ['KHO'] }))) as Record<string, unknown> & { refund: Record<string, unknown> };
    expect(res).not.toHaveProperty('bankAccountNo');
    expect(res.refund).not.toHaveProperty('bankAccountNo');
    expect(res.refund).not.toHaveProperty('bankName');
  });

  it('CSKH và ADMIN vẫn thấy đủ', async () => {
    const { controller } = setup();
    const cskh = await controller.list(query, viewer({ staffPermissions: ['CSKH', 'KHO'] }));
    expect(cskh.data[0]).toMatchObject({ bankAccountNo: '0123456789', refund: { bankAccountNo: '0123456789' } });
    const admin = await controller.list(query, viewer({ role: 'ADMIN' }));
    expect(admin.data[0]).toMatchObject({ bankAccountNo: '0123456789' });
  });

  it('duyệt: nhân viên được đánh dấu byStaff, quản trị viên thì không', async () => {
    const { controller, returns } = setup();
    await controller.review('v1', 'STAFF', 'r1', { approve: true } as never);
    expect(returns.review).toHaveBeenLastCalledWith('v1', 'r1', { approve: true }, { byStaff: true });
    await controller.review('a1', 'ADMIN', 'r1', { approve: true } as never);
    expect(returns.review).toHaveBeenLastCalledWith('a1', 'r1', { approve: true }, { byStaff: false });
  });
});
