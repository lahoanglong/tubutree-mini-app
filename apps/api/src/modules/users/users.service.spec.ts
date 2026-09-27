import { BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

function prismaWithUpdate(updateSpy: jest.Mock, updateManySpy: jest.Mock = jest.fn().mockResolvedValue({ count: 1 })) {
  return { user: { update: updateSpy, updateMany: updateManySpy } } as unknown as PrismaService;
}
const fakeUser = { id: 'u1', zaloId: null, phone: null, email: null, fullName: 'A', dob: null, avatarUrl: null, role: 'CUSTOMER', tierId: null, referralCode: 'R', pointsBalance: 0, walletBalance: 0, cashbackPending: 0, metadata: null, tier: null };

describe('UsersService.updateMe', () => {
  it('ép dob "YYYY-MM-DD" về Date trước khi ghi Prisma (qua updateMany có khoá dob:null, không phải update)', async () => {
    const update = jest.fn().mockResolvedValue(fakeUser);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = new UsersService(prismaWithUpdate(update, updateMany));
    await svc.updateMe('u1', { dob: '1995-03-20', fullName: 'Tester' });

    const guardArgs = updateMany.mock.calls[0][0];
    expect(guardArgs.where).toEqual({ id: 'u1', dob: null });
    expect(guardArgs.data.dob).toBeInstanceOf(Date);
    expect((guardArgs.data.dob as Date).toISOString().slice(0, 10)).toBe('1995-03-20');

    const data = update.mock.calls[0][0].data;
    expect('dob' in data).toBe(false); // dob đã ghi qua updateMany ở trên, không lặp lại ở đây
    expect(data.fullName).toBe('Tester');
  });

  // A3-04 (audit 2026-09): dob trước đây sửa được tự do bất kỳ lúc nào → khách đổi dob sang
  // "ngày mai" mỗi tháng để cày voucher sinh nhật (50k, không minOrder). Khoá: dob chỉ ĐẶT
  // ĐƯỢC MỘT LẦN.
  it('A3-04: user ĐÃ có dob (khác null) → sửa lần 2 bị chặn, thông báo rõ ràng hướng dẫn CSKH, KHÔNG ghi update', async () => {
    const update = jest.fn();
    // where dob:null không khớp dòng nào (dob hiện đã khác null) → count=0.
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const svc = new UsersService(prismaWithUpdate(update, updateMany));

    await expect(svc.updateMe('u1', { dob: '1995-03-20' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.updateMe('u1', { dob: '1995-03-20' })).rejects.toThrow(/CSKH/);
    expect(update).not.toHaveBeenCalled();
  });

  it('A3-04: user MỚI (dob chưa từng đặt) → đặt lần đầu thành công, trả dob đã set', async () => {
    const update = jest.fn().mockResolvedValue({ ...fakeUser, dob: new Date('1995-03-20T00:00:00Z') });
    // where dob:null khớp đúng 1 dòng (dob đang null) → count=1, cho phép set.
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const svc = new UsersService(prismaWithUpdate(update, updateMany));

    const res = await svc.updateMe('u1', { dob: '1995-03-20' });

    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'u1', dob: null }, data: { dob: expect.any(Date) } });
    expect(res.dob).toBe('1995-03-20');
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

// A1-03 (docs/audit-2026-09/01-ia-navigation.md): nút "Gửi yêu cầu xoá tài khoản" trước đây chỉ
// hiện snackbar giả, không gọi API nào. Giờ ghi nhận YÊU CẦU thật (KHÔNG xoá thật) + báo admin.
describe('UsersService.requestAccountDeletion', () => {
  function makePrisma(over: Record<string, unknown> = {}) {
    return {
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'req1', createdAt: new Date('2026-09-27T00:00:00Z') }),
      },
      user: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', fullName: 'Nguyễn Văn A', phone: '0900000000' }),
        findMany: jest.fn().mockResolvedValue([{ id: 'admin1' }]),
      },
      ...over,
    } as unknown as PrismaService;
  }

  it('chưa từng gửi yêu cầu → tạo mới, báo TẤT CẢ admin, message KHÔNG hứa "đã xoá"', async () => {
    const notify = jest.fn().mockResolvedValue(undefined);
    const prisma = makePrisma();
    const svc = new UsersService(prisma, { notify } as unknown as NotificationsService);

    const res = await svc.requestAccountDeletion('u1', 'Không dùng nữa');

    expect(res.alreadyRequested).toBe(false);
    expect(res.message).not.toMatch(/đã xoá|đã xóa/i); // honest: KHÔNG được nói đã xoá xong
    expect(prisma.accountDeletionRequest.create).toHaveBeenCalledWith({
      data: { userId: 'u1', reason: 'Không dùng nữa' },
    });
    expect(notify).toHaveBeenCalledWith('admin1', 'ACCOUNT_DELETION_REQUESTED', {
      user: 'Nguyễn Văn A',
      phone: '0900000000',
    });
  });

  it('đã có yêu cầu PENDING → trả lại yêu cầu cũ, KHÔNG tạo dòng mới, KHÔNG báo admin lại (idempotent)', async () => {
    const notify = jest.fn();
    const existing = { id: 'req0', createdAt: new Date('2026-09-01T00:00:00Z'), status: 'PENDING' };
    const create = jest.fn();
    const prisma = makePrisma({ accountDeletionRequest: { findFirst: jest.fn().mockResolvedValue(existing), create } });
    const svc = new UsersService(prisma, { notify } as unknown as NotificationsService);

    const res = await svc.requestAccountDeletion('u1');

    expect(res.alreadyRequested).toBe(true);
    expect(res.createdAt).toBe(existing.createdAt);
    expect(create).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('không có NotificationsService wiring → vẫn ghi nhận yêu cầu thành công (không throw)', async () => {
    const prisma = makePrisma();
    const svc = new UsersService(prisma); // không truyền notifications (Optional)

    const res = await svc.requestAccountDeletion('u1');

    expect(res.alreadyRequested).toBe(false);
    expect(prisma.accountDeletionRequest.create).toHaveBeenCalled();
  });

  it('không còn tài khoản ADMIN nào → vẫn ghi nhận yêu cầu, không throw', async () => {
    const notify = jest.fn();
    const prisma = makePrisma({ user: { findUniqueOrThrow: jest.fn().mockResolvedValue(fakeUser), findMany: jest.fn().mockResolvedValue([]) } });
    const svc = new UsersService(prisma, { notify } as unknown as NotificationsService);

    const res = await svc.requestAccountDeletion('u1');

    expect(res.alreadyRequested).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
