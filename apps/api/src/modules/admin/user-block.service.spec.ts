import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SessionStateService } from '../auth/session-state.service';
import { UserBlockService } from './user-block.service';

function txWith(target: { id: string; role: string; isBlocked: boolean } | null, otherActiveAdmins: number) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    user: {
      findUnique: jest.fn().mockResolvedValue(target),
      update: jest.fn().mockResolvedValue({ id: target?.id, isBlocked: true }),
      count: jest.fn().mockResolvedValue(otherActiveAdmins),
    },
    userAdminEvent: { create: jest.fn().mockResolvedValue({}) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = { $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) } as unknown as PrismaService;
  const sessions = { invalidate: jest.fn() } as unknown as SessionStateService;
  return { svc: new UserBlockService(prisma, sessions), tx };
}

// R4-ADMIN-6: khoá tài khoản cũng bớt một admin hoạt động — hai admin cuối cùng khoá nhau cùng lúc thì không ai vào
// được trang quản trị để mở khoá.
describe('UserBlockService.block — luôn còn một quản trị viên hoạt động', () => {
  it('khoá admin hoạt động cuối cùng → từ chối, không ghi gì', async () => {
    const { svc, tx } = txWith({ id: 'u2', role: 'ADMIN', isBlocked: false }, 0);
    await expect(svc.block('admin1', 'u2', 'nghỉ việc')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.block('admin1', 'u2', 'nghỉ việc')).rejects.toThrow(/quản trị viên cuối cùng/);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.user.count).toHaveBeenCalledWith({ where: { role: 'ADMIN', isBlocked: false, id: { not: 'u2' } } });
  });

  it('khoá admin khi còn admin khác hoạt động → khoá, khoá advisory lấy trước khi đọc người bị khoá', async () => {
    const { svc, tx } = txWith({ id: 'u2', role: 'ADMIN', isBlocked: false }, 1);
    await svc.block('admin1', 'u2', 'nghỉ việc');
    expect(tx.user.update).toHaveBeenCalled();
    expect(tx.$executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(tx.user.findUnique.mock.invocationCallOrder[0]!);
  });

  it('khoá khách hàng → không cần đếm admin', async () => {
    const { svc, tx } = txWith({ id: 'u3', role: 'CUSTOMER', isBlocked: false }, 0);
    await svc.block('admin1', 'u3', 'farm voucher');
    expect(tx.user.count).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalled();
  });
});
