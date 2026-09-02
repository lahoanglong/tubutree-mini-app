import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import type { PrismaService } from '../../prisma/prisma.service';

function prismaWithUpdate(updateSpy: jest.Mock) {
  return { user: { update: updateSpy } } as unknown as PrismaService;
}
const fakeUser = { id: 'u1', zaloId: null, phone: null, email: null, fullName: 'A', dob: null, avatarUrl: null, role: 'CUSTOMER', tierId: null, referralCode: 'R', pointsBalance: 0, walletBalance: 0, cashbackPending: 0, metadata: null, tier: null };

describe('UsersService.updateMe', () => {
  it('ép dob "YYYY-MM-DD" về Date trước khi ghi Prisma', async () => {
    const update = jest.fn().mockResolvedValue(fakeUser);
    const svc = new UsersService(prismaWithUpdate(update));
    await svc.updateMe('u1', { dob: '1995-03-20', fullName: 'Tester' });

    const data = update.mock.calls[0][0].data;
    expect(data.dob).toBeInstanceOf(Date);
    expect((data.dob as Date).toISOString().slice(0, 10)).toBe('1995-03-20');
    expect(data.fullName).toBe('Tester');
  });

  it('không gắn dob khi không gửi', async () => {
    const update = jest.fn().mockResolvedValue(fakeUser);
    const svc = new UsersService(prismaWithUpdate(update));
    await svc.updateMe('u1', { fullName: 'Chỉ tên' });
    expect('dob' in update.mock.calls[0][0].data).toBe(false);
  });

  it('serialize trả dob dạng YYYY-MM-DD', async () => {
    const update = jest.fn().mockResolvedValue({ ...fakeUser, dob: new Date('1995-03-20T00:00:00Z') });
    const svc = new UsersService(prismaWithUpdate(update));
    const res = await svc.updateMe('u1', { dob: '1995-03-20' });
    expect(res.dob).toBe('1995-03-20');
  });

  it('dob khớp regex nhưng tháng không hợp lệ (2024-13-01) → BadRequestException, KHÔNG gọi update', async () => {
    const update = jest.fn();
    const svc = new UsersService(prismaWithUpdate(update));
    await expect(svc.updateMe('u1', { dob: '2024-13-01' })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('dob khớp regex nhưng ngày không tồn tại (2024-02-30 lăn âm thầm sang tháng 3) → BadRequestException', async () => {
    const update = jest.fn();
    const svc = new UsersService(prismaWithUpdate(update));
    await expect(svc.updateMe('u1', { dob: '2024-02-30' })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('dob 29/2 năm nhuận (2024) → hợp lệ, không throw', async () => {
    const update = jest.fn().mockResolvedValue(fakeUser);
    const svc = new UsersService(prismaWithUpdate(update));
    await expect(svc.updateMe('u1', { dob: '2024-02-29' })).resolves.toBeDefined();
  });

  it('dob 29/2 năm KHÔNG nhuận (2023) → BadRequestException', async () => {
    const update = jest.fn();
    const svc = new UsersService(prismaWithUpdate(update));
    await expect(svc.updateMe('u1', { dob: '2023-02-29' })).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
});

/** Mock prisma cho createAddress/updateAddress: $transaction chạy callback với `tx` = chính base. */
function prismaForAddress(opts: {
  count?: number;
  findUnique?: unknown;
  updateMany?: jest.Mock;
  create?: jest.Mock;
  update?: jest.Mock;
}) {
  const updateMany = opts.updateMany ?? jest.fn().mockResolvedValue({ count: 0 });
  const create = opts.create ?? jest.fn().mockImplementation(({ data }) => data);
  const update = opts.update ?? jest.fn().mockImplementation(({ data }) => data);
  const txSpy = jest.fn();
  const base: Record<string, unknown> = {
    address: {
      count: jest.fn().mockResolvedValue(opts.count ?? 0),
      findUnique: jest.fn().mockResolvedValue(opts.findUnique ?? { id: 'a1', userId: 'u1' }),
      updateMany,
      create,
      update,
    },
  };
  base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown, txOpts?: unknown) => {
    txSpy(txOpts);
    return cb(base);
  });
  return { prisma: base as unknown as PrismaService, updateMany, create, update, txSpy };
}

describe('UsersService.createAddress', () => {
  it('địa chỉ ĐẦU TIÊN (count=0) → luôn isDefault=true dù dto không gửi, KHÔNG cần updateMany reset (chưa có địa chỉ khác)', async () => {
    const { prisma, updateMany, create } = prismaForAddress({ count: 0 });
    const svc = new UsersService(prisma);
    await svc.createAddress('u1', { line1: 'A' } as never);
    expect(updateMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { isDefault: false } });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ isDefault: true, userId: 'u1' }) });
  });

  it('không phải địa chỉ đầu (count>0) + dto không gửi isDefault → isDefault=false, KHÔNG updateMany', async () => {
    const { prisma, updateMany, create } = prismaForAddress({ count: 2 });
    const svc = new UsersService(prisma);
    await svc.createAddress('u1', { line1: 'B' } as never);
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ isDefault: false }) });
  });

  it('chạy trong transaction Serializable (chống race 2 request cùng đọc count=0)', async () => {
    const { prisma, txSpy } = prismaForAddress({ count: 0 });
    const svc = new UsersService(prisma);
    await svc.createAddress('u1', { line1: 'A' } as never);
    expect(txSpy).toHaveBeenCalledWith({ isolationLevel: 'Serializable' });
  });
});

describe('UsersService.updateAddress', () => {
  it('dto.isDefault=true → reset các địa chỉ khác trước khi update', async () => {
    const { prisma, updateMany, update } = prismaForAddress({});
    const svc = new UsersService(prisma);
    await svc.updateAddress('u1', 'a1', { isDefault: true } as never);
    expect(updateMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { isDefault: false } });
    expect(update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { isDefault: true } });
  });

  it('dto.isDefault không gửi → KHÔNG đụng địa chỉ khác', async () => {
    const { prisma, updateMany } = prismaForAddress({});
    const svc = new UsersService(prisma);
    await svc.updateAddress('u1', 'a1', { line1: 'Mới' } as never);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('địa chỉ không thuộc user → ForbiddenException, không vào transaction', async () => {
    const { prisma } = prismaForAddress({ findUnique: { id: 'a1', userId: 'khac' } });
    const svc = new UsersService(prisma);
    await expect(svc.updateAddress('u1', 'a1', { isDefault: true } as never)).rejects.toThrow(
      'không thuộc về bạn',
    );
  });

  it('chạy trong transaction Serializable (chống race 2 update isDefault=true đồng thời)', async () => {
    const { prisma, txSpy } = prismaForAddress({});
    const svc = new UsersService(prisma);
    await svc.updateAddress('u1', 'a1', { isDefault: true } as never);
    expect(txSpy).toHaveBeenCalledWith({ isolationLevel: 'Serializable' });
  });
});
