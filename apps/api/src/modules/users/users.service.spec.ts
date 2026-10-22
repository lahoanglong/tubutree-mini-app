import { BadRequestException, Logger } from '@nestjs/common';
import { UsersService } from './users.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

function prismaWithUpdate(updateSpy: jest.Mock, updateManySpy: jest.Mock = jest.fn().mockResolvedValue({ count: 1 })) {
  return { user: { update: updateSpy, updateMany: updateManySpy } } as unknown as PrismaService;
}
const fakeUser = { id: 'u1', zaloId: null, phone: null, email: null, fullName: 'A', dob: null, avatarUrl: null, role: 'CUSTOMER', tierId: null, referralCode: 'R', pointsBalance: 0, pointsConvertedBalance: 0, walletBalance: 0, cashbackPending: 0, metadata: null, tier: null };

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
    $executeRaw: jest.fn().mockResolvedValue(0),
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

const GEO = { provinceCode: '84_VN01', wardCode: '84_VN01_00004' };

describe('UsersService.createAddress', () => {
  it('địa chỉ ĐẦU TIÊN (count=0) → luôn isDefault=true dù dto không gửi, KHÔNG cần updateMany reset (chưa có địa chỉ khác)', async () => {
    const { prisma, updateMany, create } = prismaForAddress({ count: 0 });
    const svc = new UsersService(prisma);
    await svc.createAddress('u1', { line1: 'A', ...GEO } as never);
    expect(updateMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { isDefault: false } });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ isDefault: true, userId: 'u1' }) });
  });

  it('không phải địa chỉ đầu (count>0) + dto không gửi isDefault → isDefault=false, KHÔNG updateMany', async () => {
    const { prisma, updateMany, create } = prismaForAddress({ count: 2 });
    const svc = new UsersService(prisma);
    await svc.createAddress('u1', { line1: 'B', ...GEO } as never);
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ isDefault: false }) });
  });

  it('mở transaction bằng khoá advisory theo khách (U6-2), trước khi đếm địa chỉ, không Serializable', async () => {
    const { prisma, txSpy } = prismaForAddress({ count: 0 });
    await new UsersService(prisma).createAddress('u1', { line1: 'A', ...GEO } as never);
    const tx = prisma as unknown as { $executeRaw: jest.Mock; address: { count: jest.Mock } };
    expect(String((tx.$executeRaw.mock.calls[0] as [TemplateStringsArray])[0].join('?'))).toContain('pg_advisory_xact_lock');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.address.count.mock.invocationCallOrder[0]!);
    expect(txSpy).toHaveBeenCalledWith(undefined);
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

  it('mở transaction bằng khoá advisory theo khách, không Serializable (tránh 40001 khi giao dịch khác UPDATE users)', async () => {
    const { prisma, txSpy } = prismaForAddress({});
    await new UsersService(prisma).updateAddress('u1', 'a1', { isDefault: true } as never);
    const tx = prisma as unknown as { $executeRaw: jest.Mock; address: { updateMany: jest.Mock } };
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.address.updateMany.mock.invocationCallOrder[0]!);
    expect(txSpy).toHaveBeenCalledWith(undefined);
  });
});

/** Sổ địa chỉ trong bộ nhớ: deleteAddress cần đọc/ghi thật để kiểm "ai là mặc định sau khi xoá". */
function prismaWithBook(rows: { id: string; userId: string; isDefault: boolean }[]) {
  const book = rows.map((r) => ({ ...r }));
  const txSpy = jest.fn();
  const base: Record<string, unknown> = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn().mockResolvedValue([]),
    subscription: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    address: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => book.find((a) => a.id === where.id) ?? null),
      findFirst: jest.fn(async ({ where }: { where: { userId: string } }) =>
        [...book].filter((a) => a.userId === where.userId).sort((a, b) => (a.id < b.id ? -1 : 1))[0] ?? null),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        book.splice(book.findIndex((a) => a.id === where.id), 1);
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { isDefault: boolean } }) => {
        Object.assign(book.find((a) => a.id === where.id)!, data);
      }),
    },
  };
  base.$transaction = jest.fn(async (cb: (tx: unknown) => unknown, txOpts?: unknown) => {
    txSpy(txOpts);
    return cb(base);
  });
  return { prisma: base as unknown as PrismaService, book, txSpy };
}

describe('UsersService.deleteAddress: giữ một địa chỉ mặc định (U6-B07)', () => {
  it('xoá địa chỉ mặc định khi còn địa chỉ khác → địa chỉ đầu tiên còn lại (theo id) thành mặc định', async () => {
    const { prisma, book } = prismaWithBook([
      { id: 'a3', userId: 'u1', isDefault: false },
      { id: 'a1', userId: 'u1', isDefault: true },
      { id: 'a2', userId: 'u1', isDefault: false },
    ]);
    await expect(new UsersService(prisma).deleteAddress('u1', 'a1')).resolves.toEqual({ ok: true });
    expect(book.map((a) => [a.id, a.isDefault]).sort()).toEqual([['a2', true], ['a3', false]]);
  });

  it('xoá địa chỉ không mặc định → mặc định giữ nguyên', async () => {
    const { prisma, book } = prismaWithBook([
      { id: 'a1', userId: 'u1', isDefault: true },
      { id: 'a2', userId: 'u1', isDefault: false },
    ]);
    await new UsersService(prisma).deleteAddress('u1', 'a2');
    expect(book).toEqual([{ id: 'a1', userId: 'u1', isDefault: true }]);
  });

  it('xoá địa chỉ cuối cùng → không lỗi, sổ trống', async () => {
    const { prisma, book } = prismaWithBook([{ id: 'a1', userId: 'u1', isDefault: true }]);
    await expect(new UsersService(prisma).deleteAddress('u1', 'a1')).resolves.toEqual({ ok: true });
    expect(book).toEqual([]);
  });
});

describe('Sổ địa chỉ chỉ nhận địa chỉ gửi được sang Pancake (PANCAKE-16, MONEY-12)', () => {
  const geoReturning = (r: 'ok' | 'invalid' | 'unknown') => ({ checkWard: jest.fn().mockResolvedValue(r) }) as never;

  it('mã cũ ("00", tỉnh hệ 3 cấp) → 400 ADDRESS_OUTDATED, không ghi DB', async () => {
    const { prisma, create } = prismaForAddress({});
    const svc = new UsersService(prisma, undefined, geoReturning('ok'));
    for (const codes of [{ provinceCode: '00', wardCode: '00' }, { provinceCode: '01', wardCode: '00004' }]) {
      const err = await svc.createAddress('u1', { line1: 'A', ...codes } as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'ADDRESS_OUTDATED' });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('phường không thuộc tỉnh (theo danh mục Pancake) → 400; Pancake lỗi (unknown) → vẫn lưu', async () => {
    const bad = prismaForAddress({});
    await expect(new UsersService(bad.prisma, undefined, geoReturning('invalid')).createAddress('u1', GEO as never)).rejects.toThrow(
      'Phường/xã không thuộc tỉnh/thành',
    );
    expect(bad.create).not.toHaveBeenCalled();
    const down = prismaForAddress({});
    await new UsersService(down.prisma, undefined, geoReturning('unknown')).createAddress('u1', GEO as never);
    expect(down.create).toHaveBeenCalled();
  });

  it('sửa địa chỉ: đổi tỉnh mà giữ phường cũ → đối chiếu cặp mới; chỉ đặt mặc định thì không bắt sửa địa giới', async () => {
    const legacy = { id: 'a1', userId: 'u1', provinceCode: '00', wardCode: '00' };
    const geo = { checkWard: jest.fn().mockResolvedValue('invalid') };
    const { prisma, update } = prismaForAddress({ findUnique: { ...legacy, provinceCode: '84_VN01', wardCode: '84_VN01_00004' } });
    await expect(new UsersService(prisma, undefined, geo as never).updateAddress('u1', 'a1', { provinceCode: '84_VN79' } as never)).rejects.toThrow(
      BadRequestException,
    );
    expect(geo.checkWard).toHaveBeenCalledWith('84_VN79', '84_VN01_00004');
    expect(update).not.toHaveBeenCalled();

    const old = prismaForAddress({ findUnique: legacy });
    await new UsersService(old.prisma, undefined, geo as never).updateAddress('u1', 'a1', { isDefault: true } as never);
    expect(old.update).toHaveBeenCalled();
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

// C-040: đặc tả bản chép tay `notifyAdminsOfDeletionRequest` (qua requestAccountDeletion) trước khi
// gom cùng hai bản của dealer về một helper chung.
describe('UsersService.requestAccountDeletion — báo admin (đặc tả notifyAdminsOfDeletionRequest, C-040)', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  function build(opts: {
    admins?: { id: string }[];
    user?: { id: string; fullName: string | null; phone: string | null };
    notify?: jest.Mock;
    wired?: boolean;
  } = {}) {
    const notify = opts.notify ?? jest.fn().mockResolvedValue(undefined);
    const user = {
      findUniqueOrThrow: jest.fn().mockResolvedValue(opts.user ?? { id: 'u1', fullName: 'Nguyễn Văn A', phone: '0900000000' }),
      findMany: jest.fn().mockResolvedValue(opts.admins ?? [{ id: 'admin1' }]),
    };
    const prisma = {
      accountDeletionRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'req1', createdAt: new Date('2026-09-27T00:00:00Z') }),
      },
      user,
    } as unknown as PrismaService;
    const svc = new UsersService(prisma, opts.wired === false ? undefined : ({ notify } as unknown as NotificationsService));
    return { svc, user, notify };
  }

  it('lấy tối đa 20 admin chưa bị khoá', async () => {
    const { svc, user } = build();
    await svc.requestAccountDeletion('u1');
    expect(user.findMany).toHaveBeenCalledWith({ where: { role: 'ADMIN', isBlocked: false }, select: { id: true }, take: 20 });
  });

  it('payload gửi MỌI admin: user, phone', async () => {
    const { svc, notify } = build({ admins: [{ id: 'a1' }, { id: 'a2' }] });
    await svc.requestAccountDeletion('u1');
    expect(notify).toHaveBeenCalledTimes(2);
    for (const id of ['a1', 'a2']) {
      expect(notify).toHaveBeenCalledWith(id, 'ACCOUNT_DELETION_REQUESTED', { user: 'Nguyễn Văn A', phone: '0900000000' });
    }
  });

  it.each([
    ['không tên -> SĐT', { id: 'u1', fullName: null, phone: '0900000000' }, { user: '0900000000', phone: '0900000000' }],
    ['không tên không SĐT -> userId, phone rỗng', { id: 'u1', fullName: null, phone: null }, { user: 'u1', phone: '' }],
  ])('tên hiển thị: %s', async (_label, user, expected) => {
    const { svc, notify } = build({ user });
    await svc.requestAccountDeletion('u1');
    expect(notify).toHaveBeenCalledWith('admin1', 'ACCOUNT_DELETION_REQUESTED', expected);
  });

  it('không có admin -> không notify, cảnh báo, yêu cầu vẫn ghi nhận', async () => {
    const { svc, notify } = build({ admins: [] });
    await expect(svc.requestAccountDeletion('u1')).resolves.toMatchObject({ alreadyRequested: false });
    expect(notify).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Không có tài khoản ADMIN'));
  });

  it('chưa wiring NotificationsService -> không truy vấn admin, cảnh báo kèm mã yêu cầu, vẫn ghi nhận', async () => {
    const { svc, user } = build({ wired: false });
    await expect(svc.requestAccountDeletion('u1')).resolves.toMatchObject({ alreadyRequested: false });
    expect(user.findMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/chưa wiring.*req1/));
  });

  it('một admin lỗi -> admin còn lại vẫn nhận, ghi cảnh báo "lỗi 1/2", không throw', async () => {
    const notify = jest.fn(async (id: string) => {
      if (id === 'a1') throw new Error('zns down');
    });
    const { svc } = build({ admins: [{ id: 'a1' }, { id: 'a2' }], notify });
    await expect(svc.requestAccountDeletion('u1')).resolves.toMatchObject({ alreadyRequested: false });
    expect(notify).toHaveBeenCalledWith('a2', 'ACCOUNT_DELETION_REQUESTED', expect.anything());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lỗi 1/2'));
  });

  it('truy vấn admin lỗi -> vẫn ghi nhận, ghi cảnh báo kèm nội dung lỗi', async () => {
    const { svc, user } = build();
    user.findMany.mockRejectedValue(new Error('db down'));
    await expect(svc.requestAccountDeletion('u1')).resolves.toMatchObject({ alreadyRequested: false });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});

describe('UsersService.getMe: Điểm Xanh hai lô (review C1)', () => {
  // AuthUser và /loyalty/me đã trả cả hai lô; /me chỉ trả lô thường thì client đọc điểm từ đây sẽ thiếu phần
  // điểm quy đổi (tiền trả trước, không hết hạn).
  it('trả pointsBalance, pointsConvertedBalance và pointsTotal = tổng hai lô', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({ ...fakeUser, pointsBalance: 30, pointsConvertedBalance: 124 });
    const svc = new UsersService({ user: { findUniqueOrThrow } } as unknown as PrismaService);
    const me = await svc.getMe('u1');
    expect(me).toMatchObject({ pointsBalance: 30, pointsConvertedBalance: 124, pointsTotal: 154 });
  });

  it('chỉ có điểm quy đổi vẫn có pointsTotal > 0', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({ ...fakeUser, pointsBalance: 0, pointsConvertedBalance: 1250 });
    const svc = new UsersService({ user: { findUniqueOrThrow } } as unknown as PrismaService);
    expect((await svc.getMe('u1')).pointsTotal).toBe(1250);
  });
});
