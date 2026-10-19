import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService, isMergeBusy } from './auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { ZaloService } from './zalo.service';
import type { RbacService } from '../staff/rbac/rbac.service';
import type { VouchersService } from '../vouchers/vouchers.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';

// Sổ cái thật (khoá dòng + wallet_transactions) chạy trên Postgres ở
// test/integration-race/wallet-ledger*.race-spec.ts. Ở đây thay bằng đúng tác động số dư của nó
// (increment walletBalance trên tx) để fake Prisma vẫn đo được tiền chuyển giữa hai dòng.
jest.mock('../wallet/wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn(
    async (tx: { user: { update: (a: unknown) => Promise<unknown> } }, input: { userId: string; delta: number }) => {
      await tx.user.update({ where: { id: input.userId }, data: { walletBalance: { increment: input.delta } } });
      return { applied: true, balanceAfter: 0, entryId: 'wtx' };
    },
  ),
}));

// applyGrants no-op (identity) cho unit test auth — không đụng DB.
const mkRbac = () =>
  ({ applyGrants: jest.fn(async (u: unknown) => u) } as unknown as RbacService);

const configValues: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL_DAYS: 30,
  JWT_REFRESH_REUSE_GRACE_SECONDS: 30,
};

function makeService(over: Record<string, unknown> = {}) {
  const create = jest.fn().mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const base = {
    refreshToken: {
      findUnique: jest.fn(),
      updateMany,
      create,
    },
  };
  const prisma = { ...base, ...over } as unknown as PrismaService;
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
  const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
  const zalo = {} as unknown as ZaloService;
  return { svc: new AuthService(prisma, jwt, config, zalo, mkRbac()), prisma, create, updateMany };
}

const USER = { id: 'u1', role: 'CUSTOMER', zaloId: 'z1', referralCode: 'R1' };

describe('AuthService.refresh (rotation atomic)', () => {
  it('token không tồn tại → Unauthorized', async () => {
    const { svc, prisma } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(svc.refresh('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token đã revoke → Unauthorized', async () => {
    const { svc, prisma } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    await expect(svc.refresh('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token hết hạn → Unauthorized', async () => {
    const { svc, prisma } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', revokedAt: null, expiresAt: new Date(Date.now() - 1000), user: USER,
    });
    await expect(svc.refresh('tok')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('hợp lệ → revoke-gate count=1 → cấp cặp token mới (JWT + refresh mới)', async () => {
    const { svc, prisma, create } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    const r = await svc.refresh('tok');
    expect(r.accessToken).toBe('access-jwt');
    expect(r.refreshToken).toBeTruthy();
    expect(r.refreshToken).not.toBe('tok'); // token mới khác token cũ
    expect(create).toHaveBeenCalledTimes(1); // lưu refresh mới (đã hash)
  });

  // MONEY-8 / BUYERWEB-3: nhiều tab cùng refresh một cookie, hoặc Mini App gửi lại sau khi mất phản hồi.
  // Request thua (count=0) đọc lại dòng token: vừa bị XOAY trong khoảng ân hạn ⇒ cấp cặp token mới thay
  // vì coi là đánh cắp. Trước đây nhánh này thu hồi toàn bộ phiên, kể cả token vừa cấp cho request thắng.
  it('refresh đồng thời: revoke-gate count=0 nhưng token vừa xoay trong ân hạn → vẫn cấp token, KHÔNG thu hồi cả chuỗi', async () => {
    const { svc, prisma, create, updateMany } = makeService();
    const live = { id: 't1', userId: 'u1', revokedAt: null, rotatedAt: null, expiresAt: new Date(Date.now() + 1e6), user: USER };
    const justRotated = { ...live, revokedAt: new Date(Date.now() - 200), rotatedAt: new Date(Date.now() - 200) };
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValueOnce(live).mockResolvedValueOnce(justRotated);
    (updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const r = await svc.refresh('tok');
    expect(r.refreshToken).toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }));
  });

  it('token đã xoay vài giây trước (request đến sau khi request kia xong) → vẫn trong ân hạn, cấp token', async () => {
    const { svc, prisma, create, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: new Date(Date.now() - 5_000), rotatedAt: new Date(Date.now() - 5_000),
      expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    await expect(svc.refresh('tok')).resolves.toMatchObject({ accessToken: 'access-jwt' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).not.toHaveBeenCalled();
  });

  // P1-2 (docs/2026-09-08-review-progress.md): token đã xoay bị dùng lại SAU ân hạn là dấu hiệu bị lấy
  // cắp — thu hồi CẢ CHUỖI (mọi refresh token còn active), không chỉ token bị replay.
  it('token đã xoay bị dùng lại sau ân hạn → thu hồi TOÀN BỘ phiên của user, "đã được sử dụng"', async () => {
    const { svc, prisma, create, updateMany } = makeService({
      user: { update: jest.fn().mockResolvedValue({}) },
    });
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: new Date(Date.now() - 120_000), rotatedAt: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    await expect(svc.refresh('tok')).rejects.toThrow('đã được sử dụng');
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect((prisma as unknown as { user: { update: jest.Mock } }).user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { sessionsRevokedAt: expect.any(Date) },
    });
  });

  it('trong ân hạn nhưng toàn bộ phiên đã bị thu hồi SAU lần xoay đó → không cấp lại', async () => {
    const { svc, prisma, create } = makeService({ user: { update: jest.fn().mockResolvedValue({}) } });
    const rotatedAt = new Date(Date.now() - 3_000);
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: rotatedAt, rotatedAt, expiresAt: new Date(Date.now() + 1e6),
      user: { ...USER, sessionsRevokedAt: new Date(Date.now() - 1_000) },
    });
    await expect(svc.refresh('tok')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(create).not.toHaveBeenCalled();
  });

  it('token đã logout (revoke không do xoay) → Unauthorized, không thu hồi cả chuỗi', async () => {
    const { svc, prisma, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: new Date(Date.now() - 1_000), rotatedAt: null,
      expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    await expect(svc.refresh('tok')).rejects.toThrow('không hợp lệ');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rotation thành công bình thường (không reuse) → KHÔNG thu hồi cả chuỗi, chỉ token cũ (đánh dấu rotatedAt)', async () => {
    const { svc, prisma, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    await svc.refresh('tok');
    // Chỉ 1 lệnh updateMany (revoke-gate theo id) — KHÔNG có lệnh revoke-cả-chuỗi theo userId.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 't1', revokedAt: null },
      data: { revokedAt: expect.any(Date), rotatedAt: expect.any(Date) },
    });
  });
});

describe('AuthService.loginWithZaloMiniApp (phone)', () => {
  function makeLoginSvc(userMocks: Record<string, jest.Mock>, zaloMocks: Record<string, jest.Mock>) {
    const prisma = {
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      user: userMocks,
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    const zalo = zaloMocks as unknown as ZaloService;
    return new AuthService(prisma, jwt, config, zalo, mkRbac());
  }

  it('user mới + có phoneToken → tạo user kèm SĐT đã chuẩn hoá', async () => {
    const create = jest.fn().mockResolvedValue({ ...USER, phone: '0901234567' });
    const svc = makeLoginSvc(
      { findUnique: jest.fn().mockResolvedValue(null), create },
      {
        getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'A' }),
        resolvePhoneNumber: jest.fn().mockResolvedValue('0901234567'),
      },
    );
    const r = await svc.loginWithZaloMiniApp('code', 'at', 'ptoken');
    expect(r.accessToken).toBe('access-jwt');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: '0901234567', zaloId: 'z1' }) }),
    );
  });

  it('merge: user web có phone chưa có zaloId → gắn zaloId thay vì tạo mới', async () => {
    const update = jest.fn().mockResolvedValue({ ...USER, phone: '0901234567' });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null) // by zaloId
      .mockResolvedValueOnce({ id: 'web1', phone: '0901234567', zaloId: null, fullName: 'Web' }); // by phone
    const svc = makeLoginSvc(
      { findUnique, update, create: jest.fn() },
      {
        getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'A' }),
        resolvePhoneNumber: jest.fn().mockResolvedValue('0901234567'),
      },
    );
    await svc.loginWithZaloMiniApp('code', 'at', 'ptoken');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'web1' }, data: expect.objectContaining({ zaloId: 'z1' }) }),
    );
  });
});

describe('AuthService.loginWithZaloMiniApp: mốc xác minh SĐT (phoneVerifiedAt) cho điểm đơn chat', () => {
  function mk(existing: Record<string, unknown> | null, owner: Record<string, unknown> | null, zaloPhone: string | null, grant: Record<string, unknown> | null = null) {
    const update = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...USER, ...(existing ?? {}), ...data }));
    // Thứ tự findUnique: theo zaloId (user), rồi phoneIfFree tra chủ của SĐT.
    const findUnique = jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => (where['zaloId'] ? existing : owner));
    const roleGrant = { findFirst: jest.fn().mockResolvedValue(grant) };
    const prisma = { refreshToken: { create: jest.fn().mockResolvedValue({}) }, user: { findUnique, update, create: jest.fn() }, roleGrant } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    const zalo = { getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'A' }), resolvePhoneNumber: jest.fn().mockResolvedValue(zaloPhone) } as unknown as ZaloService;
    return { svc: new AuthService(prisma, jwt, config, zalo, mkRbac()), update, roleGrant };
  }

  it('Zalo trả đúng số đang lưu: chỉ làm mới phoneVerifiedAt', async () => {
    const { svc, update } = mk({ ...USER, fullName: 'A', phone: '0901234567', phoneVerifiedAt: new Date('2025-01-01') }, null, '0901234567');
    await svc.loginWithZaloMiniApp('c', 'at', 'pt');
    const data = update.mock.calls[0][0].data;
    expect(data).toEqual({ phoneVerifiedAt: expect.any(Date) });
    expect(data.phoneVerifiedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('Zalo trả số khác và số mới chưa thuộc ai: đổi sang số mới kèm mốc xác minh (số cũ bị nhà mạng cấp lại)', async () => {
    const { svc, update } = mk({ ...USER, fullName: 'A', phone: '0901234567' }, null, '0987654321');
    await svc.loginWithZaloMiniApp('c', 'at', 'pt');
    expect(update.mock.calls[0][0].data).toEqual({ phone: '0987654321', phoneVerifiedAt: expect.any(Date) });
  });

  it('Zalo trả số đã thuộc tài khoản khác: giữ nguyên số và mốc, không đổi gì', async () => {
    const { svc, update } = mk({ ...USER, fullName: 'A', phone: '0901234567' }, { id: 'other' }, '0987654321');
    await svc.loginWithZaloMiniApp('c', 'at', 'pt');
    expect(update).not.toHaveBeenCalled();
  });

  it('chưa có số, Zalo trả số tự do: lưu số kèm mốc xác minh', async () => {
    const { svc, update } = mk({ ...USER, fullName: 'A', phone: null }, null, '0901234567');
    await svc.loginWithZaloMiniApp('c', 'at', 'pt');
    expect(update.mock.calls[0][0].data).toEqual({ phone: '0901234567', phoneVerifiedAt: expect.any(Date) });
  });

  it('không gửi phoneToken: không đụng SĐT hay mốc xác minh', async () => {
    const { svc, update } = mk({ ...USER, fullName: 'A', phone: '0901234567' }, null, null);
    await svc.loginWithZaloMiniApp('c', 'at');
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['tài khoản STAFF', { role: 'STAFF' }, null],
    ['tài khoản ADMIN', { role: 'ADMIN' }, null],
    ['số cũ hoặc số mới đang có grant quyền', {}, { phone: '0901234567' }],
  ])('đổi số bị chặn: %s chỉ ghi log, không đổi số và không đổi mốc xác minh', async (_name, patch, grant) => {
    const { svc, update } = mk({ ...USER, fullName: 'A', phone: '0901234567', phoneVerifiedAt: new Date('2026-01-01'), ...patch }, null, '0987654321', grant);
    await svc.loginWithZaloMiniApp('c', 'at', 'pt');
    expect(update).not.toHaveBeenCalled();
  });

  it('tài khoản bị khoá: đăng nhập bị từ chối, không đổi số', async () => {
    const { svc, update } = mk({ ...USER, fullName: 'A', phone: '0901234567', isBlocked: true }, null, '0987654321');
    await expect(svc.loginWithZaloMiniApp('c', 'at', 'pt')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
  });

  it('số cũ trùng số Zalo trả (tài khoản STAFF): vẫn làm mới mốc xác minh, không đổi số', async () => {
    const { svc, update } = mk({ ...USER, fullName: 'A', role: 'STAFF', phone: '0901234567' }, null, '0901234567');
    await svc.loginWithZaloMiniApp('c', 'at', 'pt');
    expect(update.mock.calls[0][0].data).toEqual({ phoneVerifiedAt: expect.any(Date) });
  });

  it('tài khoản CUSTOMER không bị chặn: kiểm grant theo cả số cũ lẫn số mới trong một truy vấn', async () => {
    const { svc, roleGrant } = mk({ ...USER, fullName: 'A', phone: '0901234567' }, null, '0987654321');
    await svc.loginWithZaloMiniApp('c', 'at', 'pt');
    expect(roleGrant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: { in: ['0901234567', '0987654321'] }, revokedAt: null } }));
  });

  it('số mới bị người khác lấy giữa lúc kiểm và lúc ghi (P2002): vẫn đăng nhập, giữ số cũ', async () => {
    const { svc, update } = mk({ ...USER, fullName: 'A', phone: '0901234567' }, null, '0987654321');
    update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    const r = await svc.loginWithZaloMiniApp('c', 'at', 'pt');
    expect(r.accessToken).toBe('access-jwt');
  });

  it('user mới có SĐT: tạo kèm phoneVerifiedAt', async () => {
    const create = jest.fn().mockResolvedValue({ ...USER, phone: '0901234567' });
    const prisma = { refreshToken: { create: jest.fn().mockResolvedValue({}) }, user: { findUnique: jest.fn().mockResolvedValue(null), create } } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    const zalo = { getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'A' }), resolvePhoneNumber: jest.fn().mockResolvedValue('0901234567') } as unknown as ZaloService;
    await new AuthService(prisma, jwt, config, zalo, mkRbac()).loginWithZaloMiniApp('c', 'at', 'pt');
    expect(create.mock.calls[0][0].data).toMatchObject({ phone: '0901234567', phoneVerifiedAt: expect.any(Date) });
  });
});

// ── A7-01: ensurePhoneForCurrentUser (không bao giờ âm thầm đổi user) ─────────────────────────
/**
 * Fake Prisma đủ đầy để chạy thật mergeGuestInto() (không chỉ mock trả sẵn kết quả) — mô phỏng
 * bằng Map/mảng trong bộ nhớ, $transaction gọi callback với CHÍNH base (giống prismaForAddress ở
 * users.service.spec.ts). Nhờ vậy test kiểm được cả TRẠNG THÁI CUỐI (giỏ/địa chỉ/đơn/số dư của
 * CẢ HAI user) chứ không chỉ "hàm có được gọi hay không".
 */
function makeGuestMergeFixture(opts: {
  guest: Record<string, unknown>;
  target?: Record<string, unknown>;
  guestCart?: { variationId: string; quantity: number }[];
  targetCart?: { variationId: string; quantity: number }[];
  guestAddresses?: { id: string; isDefault: boolean }[];
  targetHasDefaultAddress?: boolean;
  guestOrders?: string[];
}) {
  const users = new Map<string, Record<string, unknown>>();
  users.set(opts.guest.id as string, { ...opts.guest });
  if (opts.target) users.set(opts.target.id as string, { ...opts.target });

  let cartSeq = 0;
  let itemSeq = 0;
  const carts = new Map<string, { id: string; userId: string; items: { id: string; variationId: string; quantity: number }[] }>();
  if (opts.guestCart) {
    carts.set(opts.guest.id as string, {
      id: `cart_${++cartSeq}`,
      userId: opts.guest.id as string,
      items: opts.guestCart.map((i) => ({ id: `ci_${++itemSeq}`, ...i })),
    });
  }
  if (opts.target && opts.targetCart) {
    carts.set(opts.target.id as string, {
      id: `cart_${++cartSeq}`,
      userId: opts.target.id as string,
      items: opts.targetCart.map((i) => ({ id: `ci_${++itemSeq}`, ...i })),
    });
  }

  const addresses = (opts.guestAddresses ?? []).map((a) => ({ ...a, userId: opts.guest.id as string }));
  if (opts.target && opts.targetHasDefaultAddress) {
    addresses.push({ id: 'addr_target_default', isDefault: true, userId: opts.target!.id as string });
  }

  const orders = (opts.guestOrders ?? []).map((id) => ({ id, userId: opts.guest.id as string }));
  const refreshTokens: { id: string; userId: string; revokedAt: Date | null }[] = [
    { id: 'rt_guest_1', userId: opts.guest.id as string, revokedAt: null },
  ];
  const plainMoveTables = [
    'pointsTransaction',
    'coinTransaction',
    'cashbackClick',
    'cashbackTransaction',
    'returnRequest',
    'couponRedemption',
    'subscription',
    'payout',
    'flashSalePurchase',
    'gameProfile',
    'plantedTree',
    'gameSpin',
  ] as const;
  const createdRefreshTokens: unknown[] = [];

  function applyUserUpdate(id: string, data: Record<string, unknown>) {
    const row = users.get(id);
    if (!row) throw new Error(`user ${id} not found`);
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as Record<string, unknown>)) {
        row[k] = (row[k] as number) + ((v as { increment: number }).increment);
      } else {
        row[k] = v;
      }
    }
    return { ...row };
  }

  const base: Record<string, unknown> = {
    user: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = users.get(where.id);
        if (!row) throw new Error('not found');
        return { ...row };
      }),
      findUnique: jest.fn(async ({ where }: { where: { zaloId?: string; phone?: string } }) => {
        for (const row of users.values()) {
          if (where.zaloId !== undefined && row.zaloId === where.zaloId) return { ...row };
          if (where.phone !== undefined && row.phone === where.phone) return { ...row };
        }
        return null;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        applyUserUpdate(where.id, data),
      ),
      // Nâng cấp tại chỗ có điều kiện (id + zaloId đã đọc + chưa gộp); các updateMany khác (bước 10) không có ai khớp.
      updateMany: jest.fn(async ({ where, data }: { where: { id?: unknown; zaloId?: unknown }; data: Record<string, unknown> }) => {
        const row = typeof where.id === 'string' ? users.get(where.id) : undefined;
        if (!row || row.zaloId !== where.zaloId || (row as { mergedIntoId?: unknown }).mergedIntoId) return { count: 0 };
        await applyUserUpdate(where.id as string, data);
        return { count: 1 };
      }),
    },
    cart: {
      findUnique: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const c = carts.get(where.userId);
        return c ? { ...c, items: [...c.items] } : null;
      }),
      upsert: jest.fn(async ({ where, create }: { where: { userId: string }; create: { userId: string } }) => {
        let c = carts.get(where.userId);
        if (!c) {
          c = { id: `cart_${++cartSeq}`, userId: create.userId, items: [] };
          carts.set(where.userId, c);
        }
        return { id: c.id, userId: c.userId };
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        for (const [uid, c] of carts.entries()) if (c.id === where.id) carts.delete(uid);
        return {};
      }),
    },
    cartItem: {},
    roleGrant: { findFirst: jest.fn(async () => null) },
    address: {
      count: jest.fn(async ({ where }: { where: { userId: string; isDefault: boolean } }) =>
        addresses.filter((a) => a.userId === where.userId && a.isDefault === where.isDefault).length,
      ),
      updateMany: jest.fn(
        async ({ where, data }: { where: { userId: string }; data: Record<string, unknown> }) => {
          let count = 0;
          for (const a of addresses) {
            if (a.userId === where.userId) {
              Object.assign(a, data);
              count++;
            }
          }
          return { count };
        },
      ),
    },
    order: {
      updateMany: jest.fn(async ({ where, data }: { where: { userId: string }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const o of orders) {
          if (o.userId === where.userId) {
            Object.assign(o, data);
            count++;
          }
        }
        return { count };
      }),
    },
    refreshToken: {
      updateMany: jest.fn(
        async ({ where, data }: { where: { userId: string; revokedAt: null }; data: Record<string, unknown> }) => {
          let count = 0;
          for (const t of refreshTokens) {
            if (t.userId === where.userId && t.revokedAt === where.revokedAt) {
              Object.assign(t, data);
              count++;
            }
          }
          return { count };
        },
      ),
      create: jest.fn(async (args: unknown) => {
        createdRefreshTokens.push(args);
        return {};
      }),
    },
  };
  for (const table of plainMoveTables) {
    base[table] = { updateMany: jest.fn(async () => ({ count: 1 })) };
  }
  for (const table of ['pointsTransaction', 'coinTransaction'] as const) {
    (base[table] as Record<string, unknown>).findMany = jest.fn(async () => []);
  }
  (base.gameProfile as Record<string, unknown>).count = jest.fn(async () => 0);
  const findCart = (id: string) => [...carts.values()].find((c) => c.id === id);
  (base.cartItem as Record<string, unknown>).updateMany = jest.fn(
    async ({ where, data }: { where: { cartId: string }; data: { cartId: string } }) => {
      const from = findCart(where.cartId);
      const dest = findCart(data.cartId);
      if (!from || !dest) return { count: 0 };
      const moved = from.items.splice(0);
      dest.items.push(...moved);
      return { count: moved.length };
    },
  );
  // Khoá dòng user (SELECT ... FOR UPDATE) trả số dư hiện tại của dòng đó.
  base.$queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    // Truy vấn "user nào có referredById = khách" (bước 10): mô phỏng không ai được khách giới thiệu.
    if (sql.includes('"referredById" =')) return [];
    // Người mời của target/khách (bước 10): mô phỏng không ai có người mời.
    if (sql.includes('JOIN "users" p')) return [];
    const row = users.get(values[0] as string);
    return row ? [{ ...row }] : [];
  });
  // Chỉ mô phỏng hai câu SQL gộp giỏ (cộng dồn dòng trùng biến thể, xoá dòng trùng của khách);
  // các câu SQL tập hợp còn lại được kiểm trên Postgres thật ở auth-merge-guest.race-spec.ts.
  base.$executeRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('UPDATE "cart_items"')) {
      const [target, guest] = [findCart(values[0] as string), findCart(values[1] as string)];
      for (const t of target?.items ?? []) {
        const g = guest?.items.find((i) => i.variationId === t.variationId);
        if (g) t.quantity += g.quantity;
      }
    } else if (sql.includes('DELETE FROM "cart_items"')) {
      const [guest, target] = [findCart(values[0] as string), findCart(values[1] as string)];
      if (guest && target) {
        guest.items = guest.items.filter((g) => !target.items.some((t) => t.variationId === g.variationId));
      }
    }
    return 0;
  });
  base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));

  return {
    prisma: base as unknown as PrismaService,
    state: { users, carts, addresses, orders, refreshTokens, createdRefreshTokens },
  };
}

function makeEnsurePhoneSvc(fixture: { prisma: PrismaService }, zaloMocks: Record<string, jest.Mock>, vouchers?: VouchersService) {
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
  const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
  return new AuthService(fixture.prisma, jwt, config, zaloMocks as unknown as ZaloService, mkRbac(), undefined, vouchers);
}

describe('AuthService.ensurePhoneForCurrentUser (A7-01: không bao giờ âm thầm đổi user)', () => {
  const GUEST = {
    id: 'guest1',
    zaloId: 'guest_dev1',
    fullName: 'Khách',
    phone: null,
    avatarUrl: null,
    role: 'CUSTOMER',
    pointsBalance: 100,
    walletBalance: 5000,
    coinsBalance: 20,
    cashbackPending: 0,
    referralCode: 'RG1',
  };

  it('trường hợp tầm thường: Zalo xác nhận ĐÚNG danh tính hiện tại (kể cả gọi lại) → cùng user, chỉ gắn thêm SĐT nếu thiếu', async () => {
    const nonGuestSameId = { ...GUEST, id: 'u1', zaloId: 'z-real-1', phone: null };
    const fixture = makeGuestMergeFixture({ guest: nonGuestSameId });
    const zalo = {
      getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-real-1', name: 'A' }),
      resolvePhoneNumber: jest.fn().mockResolvedValue('0911111111'),
    };
    const svc = makeEnsurePhoneSvc(fixture, zalo);

    const res = await svc.ensurePhoneForCurrentUser('u1', 'code', 'at', 'ptoken');

    expect(res.user.id).toBe('u1');
    expect(fixture.state.users.get('u1')!.phone).toBe('0911111111');
    // Không đụng tới cart/order/merge nào — không phải nhánh gộp.
    expect(fixture.state.createdRefreshTokens.length).toBeGreaterThan(0); // issueTokens vẫn chạy bình thường
  });

  it('khách + chưa ai giữ zaloId đó → nâng cấp TẠI CHỖ (giữ nguyên id) — không cần gộp, giỏ/điểm tự động đúng', async () => {
    const fixture = makeGuestMergeFixture({ guest: GUEST, guestCart: [{ variationId: 'v1', quantity: 2 }] });
    const zalo = {
      getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-new-real', name: 'Long' }),
      resolvePhoneNumber: jest.fn().mockResolvedValue('0922222222'),
    };
    const svc = makeEnsurePhoneSvc(fixture, zalo);

    const res = await svc.ensurePhoneForCurrentUser('guest1', 'code', 'at', 'ptoken');

    expect(res.user.id).toBe('guest1'); // CÙNG id — không tạo dòng mới, không "đổi user"
    const row = fixture.state.users.get('guest1')!;
    expect(row.zaloId).toBe('z-new-real');
    expect(row.phone).toBe('0922222222');
    expect(row.fullName).toBe('Long');
    // Giỏ không hề bị đụng tới (vẫn đúng vì cùng userId).
    expect(fixture.state.carts.get('guest1')!.items).toHaveLength(1);
  });

  it('KHÔNG PHẢI khách (đã là Zalo thật) nhưng Zalo trên máy giờ là danh tính KHÁC → từ chối rõ ràng, KHÔNG đổi danh tính', async () => {
    const realUser = { ...GUEST, id: 'real1', zaloId: 'z-real-old' };
    const fixture = makeGuestMergeFixture({ guest: realUser });
    const zalo = {
      getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-real-DIFFERENT', name: 'X' }),
      resolvePhoneNumber: jest.fn(),
    };
    const svc = makeEnsurePhoneSvc(fixture, zalo);

    await expect(svc.ensurePhoneForCurrentUser('real1', 'code', 'at')).rejects.toBeInstanceOf(ConflictException);
    // Không có gộp/đổi nào xảy ra — user vẫn y nguyên.
    expect(fixture.state.users.get('real1')!.zaloId).toBe('z-real-old');
  });

  it('gộp khách vào user thật: số Zalo vừa bị tài khoản khác lấy (P2002) thì bỏ qua phần số, lần gộp vẫn thành công', async () => {
    const TARGET = { id: 'target1', zaloId: 'z-real-existing', fullName: 'Người Thật', phone: '0933333333', avatarUrl: null, role: 'CUSTOMER', isBlocked: false, pointsBalance: 0, walletBalance: 0, coinsBalance: 0, cashbackPending: 0, referralCode: 'RT1' };
    const fixture = makeGuestMergeFixture({ guest: GUEST, target: TARGET });
    const realUpdate = (fixture.prisma as unknown as { user: { update: jest.Mock } }).user.update;
    const impl = realUpdate.getMockImplementation()!;
    realUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      if (args.data['phone'] !== undefined) throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
      return impl(args);
    });
    const zalo = { getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-real-existing', name: 'A' }), resolvePhoneNumber: jest.fn().mockResolvedValue('0944444444') };
    const res = await makeEnsurePhoneSvc(fixture, zalo).ensurePhoneForCurrentUser('guest1', 'code', 'at', 'ptoken');
    expect(res.user.id).toBe('target1');
    expect(fixture.state.users.get('target1')!.phone).toBe('0933333333');
    expect(fixture.state.users.get('guest1')!.mergedIntoId).toBe('target1');
  });

  describe('khách + zaloId/SĐT đã thuộc một user THẬT khác có từ trước → GỘP (không mất giỏ/địa chỉ/điểm/đơn của khách)', () => {
    const TARGET = {
      id: 'target1',
      zaloId: 'z-real-existing',
      fullName: 'Người Thật',
      phone: '0933333333',
      avatarUrl: null,
      role: 'CUSTOMER',
      pointsBalance: 50,
      walletBalance: 1000,
      coinsBalance: 5,
      cashbackPending: 200,
      referralCode: 'RT1',
    };

    it('gộp theo zaloId trùng: giỏ (cộng dồn dòng trùng + giữ dòng riêng), địa chỉ, đơn, số dư — đều chuyển đúng sang target; khách bị khoá lại (zaloId đổi, refresh token thu hồi, số dư về 0)', async () => {
      const fixture = makeGuestMergeFixture({
        guest: GUEST,
        target: TARGET,
        guestCart: [
          { variationId: 'v1', quantity: 2 }, // trùng với target → cộng dồn
          { variationId: 'v2', quantity: 1 }, // riêng của khách → chuyển nguyên dòng
        ],
        targetCart: [{ variationId: 'v1', quantity: 3 }],
        guestAddresses: [{ id: 'addr_guest_1', isDefault: true }],
        targetHasDefaultAddress: true, // target ĐÃ có địa chỉ mặc định → địa chỉ khách chuyển sang phải tắt isDefault
        guestOrders: ['order_g1', 'order_g2'],
      });
      const zalo = {
        getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-real-existing', name: 'Người Thật' }),
        resolvePhoneNumber: jest.fn().mockResolvedValue(null),
      };
      const svc = makeEnsurePhoneSvc(fixture, zalo);

      const res = await svc.ensurePhoneForCurrentUser('guest1', 'code', 'at');

      expect(res.user.id).toBe('target1');

      // Giỏ: v1 cộng dồn 3+2=5, v2 chuyển nguyên với quantity=1 — không dòng nào bị mất.
      const targetCart = fixture.state.carts.get('target1')!;
      const byVariation = Object.fromEntries(targetCart.items.map((i) => [i.variationId, i.quantity]));
      expect(byVariation).toEqual({ v1: 5, v2: 1 });
      // v2 KHÔNG trùng biến thể với target → phải được REPARENT (giữ nguyên id `ci_2`), không
      // tạo dòng mới — màn thanh toán có thể đã chọn sẵn đúng itemId này làm tập con checkout
      // TRƯỚC khi ensurePhone() chạy; đổi id sẽ làm lựa chọn đó mất khớp sau khi gộp.
      expect(targetCart.items.find((i) => i.variationId === 'v2')!.id).toBe('ci_2');
      expect(fixture.state.carts.has('guest1')).toBe(false); // giỏ khách đã xoá sau khi gộp

      // Địa chỉ: chuyển sang target, KHÔNG còn mặc định (target đã có mặc định riêng).
      const movedAddr = fixture.state.addresses.find((a) => a.id === 'addr_guest_1')!;
      expect(movedAddr.userId).toBe('target1');
      expect(movedAddr.isDefault).toBe(false);

      // Đơn hàng: cả 2 đơn cũ của khách chuyển sang target.
      expect(fixture.state.orders.every((o) => o.userId === 'target1')).toBe(true);

      // Số dư: cộng dồn đúng (không đè, không nhân đôi).
      const targetRow = fixture.state.users.get('target1')!;
      expect(targetRow.pointsBalance).toBe(150); // 50+100
      expect(targetRow.walletBalance).toBe(6000); // 1000+5000
      // PD-3 (migration C users_coins_frozen): gộp không ghi cột xu nữa. Số xu trong fixture chỉ để chứng
      // minh code không chuyển/cộng xu; trên DB thật mọi coinsBalance = 0.
      expect(targetRow.coinsBalance).toBe(5);
      expect(targetRow.cashbackPending).toBe(200); // 200+0

      // Khách bị khoá lại: zaloId đổi (giải phóng guest_dev1), số dư về 0, refresh token thu hồi.
      const guestRow = fixture.state.users.get('guest1')!;
      expect(guestRow.zaloId).not.toBe('guest_dev1');
      expect(guestRow.zaloId).toContain('guest_dev1_merged_');
      expect(guestRow.pointsBalance).toBe(0);
      expect(guestRow.walletBalance).toBe(0);
      expect(fixture.state.refreshTokens[0]!.revokedAt).toBeInstanceOf(Date);
      // Ví tiền chuyển qua sổ cái: 1 dòng ra ở khách, 1 dòng vào ở target.
      expect(applyWalletDelta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 'guest1', delta: -5000, type: 'MERGE_OUT', refId: 'target1' }),
      );
      expect(applyWalletDelta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ userId: 'target1', delta: 5000, type: 'MERGE_IN', refId: 'guest1' }),
      );
    });

    it('gộp theo SĐT trùng (target chưa có zaloId — user web cũ) khi chưa ai giữ zaloId đó', async () => {
      const webTarget = { ...TARGET, id: 'web1', zaloId: null, phone: '0944444444' };
      const fixture = makeGuestMergeFixture({ guest: GUEST, target: webTarget });
      const zalo = {
        getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-brand-new', name: 'A' }),
        resolvePhoneNumber: jest.fn().mockResolvedValue('0944444444'),
      };
      const svc = makeEnsurePhoneSvc(fixture, zalo);

      const res = await svc.ensurePhoneForCurrentUser('guest1', 'code', 'at', 'ptoken');

      expect(res.user.id).toBe('web1');
      expect(fixture.state.users.get('web1')!.zaloId).toBe('z-brand-new');
    });
  });
});

describe('AuthService.logout', () => {
  it('revoke refresh token theo hash (chưa revoke)', async () => {
    const { svc, updateMany } = makeService();
    await svc.logout('tok');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ revokedAt: null }) }),
    );
  });
});

describe('AuthService — ghi nhận người giới thiệu lúc đăng ký (referredById)', () => {
  function guestSvc(referrer: { id: string } | null, existingGuest = false) {
    const create = jest
      .fn()
      .mockImplementation(({ data }) => ({ id: 'newuser', role: 'CUSTOMER', ...data }));
    const findUnique = jest.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if (where.zaloId) return existingGuest ? { ...USER, zaloId: where.zaloId } : null;
      if (where.referralCode === 'REF1') return referrer; // resolveReferrerId (đã chuẩn hoá hoa)
      return null; // generateReferralCode: code sinh ra chưa bị chiếm
    });
    const prisma = {
      refreshToken: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique, create },
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    return {
      svc: new AuthService(prisma, jwt, config, {} as unknown as ZaloService, mkRbac()),
      create,
      findUnique,
    };
  }

  it('guest mới + referralCode hợp lệ (chuẩn hoá hoa) → set referredById = người giới thiệu', async () => {
    const { svc, create } = guestSvc({ id: 'referrer1' });
    await svc.loginAsGuest('dev1', 'ref1'); // lowercase → chuẩn hoá REF1
    expect(create.mock.calls[0][0].data.referredById).toBe('referrer1');
  });

  it('guest mới + referralCode không tồn tại → referredById null', async () => {
    const { svc, create } = guestSvc(null);
    await svc.loginAsGuest('dev1', 'REF1');
    expect(create.mock.calls[0][0].data.referredById).toBeNull();
  });

  it('guest mới KHÔNG có referralCode → referredById null', async () => {
    const { svc, create } = guestSvc({ id: 'referrer1' });
    await svc.loginAsGuest('dev1');
    expect(create.mock.calls[0][0].data.referredById).toBeNull();
  });

  it('guest ĐÃ tồn tại + referralCode → KHÔNG tạo lại, KHÔNG ghi đè referredById', async () => {
    const { svc, create } = guestSvc({ id: 'referrer1' }, true);
    await svc.loginAsGuest('dev1', 'REF1');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AuthService — nguồn chạm đầu (firstTouch*) ghi MỘT lần lúc tạo tài khoản', () => {
  const FIRST_TOUCH = { source: 'Shopee', campaign: 'card-2610', at: new Date().toISOString() };

  function svcWith(user: Record<string, jest.Mock>, zalo: Record<string, jest.Mock> = {}) {
    const prisma = { refreshToken: { create: jest.fn().mockResolvedValue({}) }, user } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    return new AuthService(prisma, jwt, config, zalo as unknown as ZaloService, mkRbac());
  }
  const echoCreate = () => jest.fn().mockImplementation(({ data }) => ({ id: 'newuser', role: 'CUSTOMER', ...data }));
  const noUser = () => jest.fn().mockResolvedValue(null);

  describe('khách mới (loginAsGuest)', () => {
    it('nguồn hợp lệ → ghi nguồn (chữ thường), chiến dịch và thời điểm chạm vào dòng tạo', async () => {
      const create = echoCreate();
      const svc = svcWith({ findUnique: noUser(), create });
      await svc.loginAsGuest('dev12345', undefined, FIRST_TOUCH);
      const data = create.mock.calls[0][0].data;
      expect(data.firstTouchSource).toBe('shopee');
      expect(data.firstTouchCampaign).toBe('card-2610');
      expect(data.firstTouchAt).toEqual(new Date(FIRST_TOUCH.at));
    });

    it.each([
      ['nguồn có ký tự lạ', { source: 'x y;drop' }],
      ['nguồn quá dài', { source: 'a'.repeat(41) }],
      ['không phải object', 'shopee'],
      ['mảng', ['shopee']],
      ['null', null],
      ['chạm đầu đã quá 90 ngày (bản lưu cũ trên máy)', { source: 'shopee', at: new Date(Date.now() - 91 * 86_400_000).toISOString() }],
    ])('giá trị bẩn (%s) → bỏ, vẫn đăng nhập được và không ghi cột nguồn nào', async (_label, raw) => {
      const create = echoCreate();
      const svc = svcWith({ findUnique: noUser(), create });
      const res = await svc.loginAsGuest('dev12345', undefined, raw);
      expect(res.accessToken).toBe('jwt');
      const data = create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('firstTouchSource');
      expect(data).not.toHaveProperty('firstTouchCampaign');
      expect(data).not.toHaveProperty('firstTouchAt');
    });

    it('chiến dịch bẩn → chỉ bỏ chiến dịch, nguồn vẫn ghi', async () => {
      const create = echoCreate();
      const svc = svcWith({ findUnique: noUser(), create });
      await svc.loginAsGuest('dev12345', undefined, { source: 'tiktok', campaign: 'a b!' });
      const data = create.mock.calls[0][0].data;
      expect(data.firstTouchSource).toBe('tiktok');
      expect(data.firstTouchCampaign).toBeNull();
    });

    it('khách ĐÃ có: không tạo lại và không ghi đè gì (không update/updateMany nào)', async () => {
      const create = echoCreate();
      const update = jest.fn();
      const updateMany = jest.fn();
      const existing = { ...USER, firstTouchSource: 'oa', firstTouchCampaign: null, firstTouchAt: new Date('2026-10-01') };
      const svc = svcWith({ findUnique: jest.fn().mockResolvedValue(existing), create, update, updateMany });
      await svc.loginAsGuest('dev12345', undefined, FIRST_TOUCH);
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  describe('Mini App Zalo (loginWithZaloMiniApp)', () => {
    const zalo = { getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'A' }), resolvePhoneNumber: jest.fn() };

    it('tài khoản mới → ghi nguồn chạm đầu', async () => {
      const create = echoCreate();
      const svc = svcWith({ findUnique: noUser(), create }, zalo);
      await svc.loginWithZaloMiniApp('c', 'at', undefined, undefined, FIRST_TOUCH);
      expect(create.mock.calls[0][0].data.firstTouchSource).toBe('shopee');
    });

    it('tạo lại không kèm SĐT sau P2002 cũng mang nguồn chạm đầu', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
      const create = jest
        .fn()
        .mockRejectedValueOnce(p2002)
        .mockImplementation(({ data }) => ({ id: 'newuser', role: 'CUSTOMER', ...data }));
      const svc = svcWith(
        { findUnique: noUser(), create },
        { getUserInfo: zalo.getUserInfo, resolvePhoneNumber: jest.fn().mockResolvedValue('0901234567') },
      );
      await svc.loginWithZaloMiniApp('c', 'at', 'ptoken', undefined, FIRST_TOUCH);
      expect(create).toHaveBeenCalledTimes(2);
      expect(create.mock.calls[1][0].data.firstTouchSource).toBe('shopee');
    });

    it('tài khoản ĐÃ có (đã có nguồn) → không ghi đè, update chỉ chứa tên/avatar/SĐT', async () => {
      const update = jest.fn().mockImplementation(({ data }) => ({ ...USER, ...data }));
      const existing = { ...USER, fullName: 'Tên cũ', firstTouchSource: 'oa', firstTouchAt: new Date('2026-10-01') };
      const svc = svcWith({ findUnique: jest.fn().mockResolvedValue(existing), update, create: jest.fn() }, zalo);
      await svc.loginWithZaloMiniApp('c', 'at', undefined, undefined, FIRST_TOUCH);
      for (const call of update.mock.calls) {
        expect(Object.keys(call[0].data).filter((k) => k.startsWith('firstTouch'))).toEqual([]);
      }
    });

    it('tài khoản ĐÃ có nhưng chưa có nguồn (có trước tính năng) → cũng không ghi: chạm này không phải chạm đầu của họ', async () => {
      const update = jest.fn().mockImplementation(({ data }) => ({ ...USER, ...data }));
      const existing = { ...USER, fullName: 'Tên cũ', firstTouchSource: null };
      const svc = svcWith({ findUnique: jest.fn().mockResolvedValue(existing), update, create: jest.fn() }, zalo);
      await svc.loginWithZaloMiniApp('c', 'at', undefined, undefined, FIRST_TOUCH);
      for (const call of update.mock.calls) {
        expect(Object.keys(call[0].data).filter((k) => k.startsWith('firstTouch'))).toEqual([]);
      }
    });
  });

  describe('Web (loginWithZaloOAuth)', () => {
    it('tài khoản mới → ghi nguồn chạm đầu', async () => {
      const create = echoCreate();
      const zalo = {
        exchangeOAuthCode: jest.fn().mockResolvedValue('tok'),
        getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z9', name: 'W' }),
      };
      const svc = svcWith({ findUnique: noUser(), create }, zalo);
      await svc.loginWithZaloOAuth('code', 'verifier', undefined, { source: 'fb', campaign: 'live-1' });
      const data = create.mock.calls[0][0].data;
      expect(data.firstTouchSource).toBe('fb');
      expect(data.firstTouchCampaign).toBe('live-1');
    });
  });

  describe('gộp khách vào tài khoản đã có (ensurePhone)', () => {
    const GUEST = {
      id: 'guest1',
      zaloId: 'guest_dev1',
      fullName: 'Khách',
      phone: null,
      avatarUrl: null,
      role: 'CUSTOMER',
      pointsBalance: 0,
      pointsConvertedBalance: 0,
      walletBalance: 0,
      cashbackPending: 0,
      referralCode: 'RG1',
    };
    const TARGET = { ...GUEST, id: 'target1', zaloId: 'z-real', fullName: 'Thật', referralCode: 'RT1' };
    const touch = (source: string | null) => ({
      firstTouchSource: source,
      firstTouchCampaign: source ? 'c1' : null,
      firstTouchAt: source ? new Date('2026-10-05T00:00:00.000Z') : null,
    });
    const zalo = { getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-real', name: 'Thật' }), resolvePhoneNumber: jest.fn() };

    async function merge(guestSource: string | null, targetSource: string | null) {
      const fixture = makeGuestMergeFixture({ guest: { ...GUEST, ...touch(guestSource) }, target: { ...TARGET, ...touch(targetSource) } });
      const svc = makeEnsurePhoneSvc(fixture, zalo);
      await svc.ensurePhoneForCurrentUser('guest1', 'code', 'at');
      return fixture.state.users;
    }

    it('tài khoản đích còn trống + khách có nguồn → đích nhận nguồn của khách', async () => {
      const users = await merge('shopee', null);
      expect(users.get('target1')).toMatchObject({
        firstTouchSource: 'shopee',
        firstTouchCampaign: 'c1',
        firstTouchAt: new Date('2026-10-05T00:00:00.000Z'),
      });
    });

    it('tài khoản đích ĐÃ có nguồn → giữ nguyên, không bị khách ghi đè', async () => {
      const users = await merge('shopee', 'oa');
      expect(users.get('target1')).toMatchObject({ firstTouchSource: 'oa', firstTouchCampaign: 'c1' });
    });

    it('cả hai đều trống → đích vẫn trống', async () => {
      const users = await merge(null, null);
      expect(users.get('target1')!.firstTouchSource).toBeNull();
    });

    it('dòng khách giữ nguyên nguồn của nó (không bị xoá khi gộp)', async () => {
      const users = await merge('shopee', null);
      expect(users.get('guest1')!.firstTouchSource).toBe('shopee');
    });
  });
});

describe('AuthService — chặn user bị khoá (isBlocked) lấy token', () => {
  it('refresh(): user.isBlocked=true → Unauthorized, KHÔNG cấp refresh token mới (dù token cũ đã bị revoke)', async () => {
    const { svc, prisma, create, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1e6),
      user: { ...USER, isBlocked: true },
    });
    await expect(svc.refresh('tok')).rejects.toThrow('bị khoá');
    expect(updateMany).toHaveBeenCalledTimes(1); // token cũ vẫn bị revoke (đúng ý — không để tái sử dụng)
    expect(create).not.toHaveBeenCalled(); // nhưng KHÔNG cấp refresh token mới
  });

  it('login guest ĐÃ tồn tại + isBlocked=true → Unauthorized, KHÔNG né chặn refresh bằng cách đăng nhập lại', async () => {
    const findUnique = jest.fn().mockResolvedValue({ ...USER, isBlocked: true });
    const create = jest.fn();
    const prisma = {
      refreshToken: { create: jest.fn() },
      user: { findUnique, create },
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    const svc = new AuthService(prisma, jwt, config, {} as unknown as ZaloService, mkRbac());
    await expect(svc.loginAsGuest('dev1')).rejects.toThrow('bị khoá');
    expect(create).not.toHaveBeenCalled();
    expect((prisma.refreshToken.create as jest.Mock)).not.toHaveBeenCalled();
  });

  it('loginWithZaloMiniApp: user Zalo đã tồn tại + isBlocked=true → Unauthorized, không cấp token', async () => {
    // fullName khớp info.name để không rẽ vào nhánh update() đồng bộ tên/avatar — test tập
    // trung vào việc issueTokens() chặn user bị khoá ngay ở luồng login, không phải luồng sync.
    const findUnique = jest.fn().mockResolvedValue({ ...USER, isBlocked: true, fullName: 'Y Nguyên' });
    const update = jest.fn();
    const prisma = {
      refreshToken: { create: jest.fn() },
      user: { findUnique, update },
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    const zalo = {
      getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z1', name: 'Y Nguyên' }),
    } as unknown as ZaloService;
    const svc = new AuthService(prisma, jwt, config, zalo, mkRbac());
    await expect(svc.loginWithZaloMiniApp('code', 'at')).rejects.toThrow('bị khoá');
    expect(update).not.toHaveBeenCalled();
    expect((prisma.refreshToken.create as jest.Mock)).not.toHaveBeenCalled();
  });
});

describe('AuthService.toAuthUser — hồ sơ trả về client sau PD-3', () => {
  it('trả hai lô Điểm Xanh (thường + quy đổi) và không còn trường xu', () => {
    const { svc } = makeService();
    const out = svc.toAuthUser({
      ...USER,
      pointsBalance: 120,
      pointsConvertedBalance: 40,
      walletBalance: 5_000,
      coinsBalance: 0,
    } as never);
    expect(out).toMatchObject({ pointsBalance: 120, pointsConvertedBalance: 40, walletBalance: 5_000 });
    expect(out).not.toHaveProperty('coinsBalance');
  });
});

describe('isMergeBusy — lỗi gộp trả 503 "đang bận" thay vì lộ lỗi thô', () => {
  const known = (code: string, message = code) => new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });

  it('quá hạn chờ khoá/câu lệnh/tx và deadlock (Postgres 40P01, Prisma P2034) là bận, thử lại được', () => {
    expect(isMergeBusy(known('P2028'))).toBe(true);
    expect(isMergeBusy(known('P2034'))).toBe(true);
    expect(isMergeBusy(new Error('Raw query failed. Code: `55P03`. Message: `canceling statement due to lock timeout`'))).toBe(true);
    expect(isMergeBusy(new Error('Code: `57014`. Message: `canceling statement due to statement timeout`'))).toBe(true);
    expect(isMergeBusy(known('P2010', 'Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected`'))).toBe(true);
    expect(isMergeBusy(new Error('PostgresError { code: "40P01", message: "deadlock detected" }'))).toBe(true);
  });

  it('lỗi khác vẫn ném nguyên', () => {
    expect(isMergeBusy(known('P2002', 'Unique constraint failed'))).toBe(false);
    expect(isMergeBusy(new ConflictException('Tài khoản đã bị khoá'))).toBe(false);
    expect(isMergeBusy('40P01')).toBe(false);
  });
});

// D2-07a: voucher chào mừng cấp ngay khi tài khoản thật được tạo (cron mỗi giờ vẫn là lưới).
describe('AuthService — voucher chào mừng ngay khi tạo tài khoản thật (D2-07a)', () => {
  const noUser = () => jest.fn().mockResolvedValue(null);
  const echoCreate = () => jest.fn().mockImplementation(({ data }) => ({ id: 'newuser', role: 'CUSTOMER', ...data }));

  function svcWith(user: Record<string, jest.Mock>, zalo: Record<string, jest.Mock>, vouchers?: Partial<VouchersService>) {
    const prisma = { refreshToken: { create: jest.fn().mockResolvedValue({}) }, user } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('jwt') } as unknown as JwtService;
    const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
    return new AuthService(prisma, jwt, config, zalo as unknown as ZaloService, mkRbac(), undefined, vouchers as VouchersService);
  }
  const miniZalo = () => ({
    getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-new', name: 'A' }),
    resolvePhoneNumber: jest.fn().mockResolvedValue(null),
  });
  const grantMock = (impl?: () => Promise<boolean>) => ({ grantWelcomeNow: jest.fn(impl ?? (async () => true)) });

  it('Mini App: tài khoản Zalo mới → cấp cho đúng id vừa tạo, trước khi trả token', async () => {
    const vouchers = grantMock();
    const res = await svcWith({ findUnique: noUser(), create: echoCreate() }, miniZalo(), vouchers).loginWithZaloMiniApp('c', 'at');
    expect(res.accessToken).toBe('jwt');
    expect(vouchers.grantWelcomeNow).toHaveBeenCalledTimes(1);
    expect(vouchers.grantWelcomeNow).toHaveBeenCalledWith('newuser', { becameRealNow: true });
  });

  it('Mini App: cấp lỗi (DB, thông báo) không làm rớt đăng nhập; cron giờ sau vẫn cấp', async () => {
    const vouchers = grantMock(async () => {
      throw new Error('db down');
    });
    const res = await svcWith({ findUnique: noUser(), create: echoCreate() }, miniZalo(), vouchers).loginWithZaloMiniApp('c', 'at');
    expect(res.accessToken).toBe('jwt');
    expect(vouchers.grantWelcomeNow).toHaveBeenCalledTimes(1);
  });

  it('Mini App: tài khoản Zalo đã có → không cấp ở đường đăng nhập lại', async () => {
    const vouchers = grantMock();
    const existing = { id: 'u9', role: 'CUSTOMER', zaloId: 'z-new', fullName: 'A', phone: null, avatarUrl: null };
    await svcWith({ findUnique: jest.fn().mockResolvedValue(existing), create: jest.fn() }, miniZalo(), vouchers).loginWithZaloMiniApp('c', 'at');
    expect(vouchers.grantWelcomeNow).not.toHaveBeenCalled();
  });

  it('khách vãng lai (loginAsGuest) không bao giờ được cấp', async () => {
    const vouchers = grantMock();
    await svcWith({ findUnique: noUser(), create: echoCreate() }, {}, vouchers).loginAsGuest('dev12345');
    expect(vouchers.grantWelcomeNow).not.toHaveBeenCalled();
  });

  it('Web OAuth: tài khoản Zalo mới → cấp cho id vừa tạo', async () => {
    const vouchers = grantMock();
    const zalo = { exchangeOAuthCode: jest.fn().mockResolvedValue('tok'), getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z9', name: 'W' }) };
    await svcWith({ findUnique: noUser(), create: echoCreate() }, zalo, vouchers).loginWithZaloOAuth('code', 'verifier');
    expect(vouchers.grantWelcomeNow).toHaveBeenCalledWith('newuser', { becameRealNow: true });
  });

  it('không có VouchersService (test dựng tay) → đăng nhập vẫn chạy', async () => {
    const res = await svcWith({ findUnique: noUser(), create: echoCreate() }, miniZalo()).loginWithZaloMiniApp('c', 'at');
    expect(res.accessToken).toBe('jwt');
  });

  it('khách vãng lai nâng cấp tại chỗ lên tài khoản Zalo thật (ensurePhone) → cấp cho chính dòng đó', async () => {
    const vouchers = grantMock();
    const guest = { id: 'guest1', zaloId: 'guest_dev1', fullName: 'Khách', phone: null, avatarUrl: null, role: 'CUSTOMER', referralCode: 'RG1' };
    const fixture = makeGuestMergeFixture({ guest });
    const zalo = {
      getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-new-real', name: 'Long' }),
      resolvePhoneNumber: jest.fn().mockResolvedValue(null),
    };
    await makeEnsurePhoneSvc(fixture, zalo, vouchers as unknown as VouchersService).ensurePhoneForCurrentUser('guest1', 'code', 'at');
    expect(vouchers.grantWelcomeNow).toHaveBeenCalledWith('guest1', { becameRealNow: true });
  });

  it('gộp khách vào tài khoản có sẵn (ensurePhone) → không cấp thêm (tài khoản đích đã qua đường đăng ký)', async () => {
    const vouchers = grantMock();
    const guest = { id: 'guest1', zaloId: 'guest_dev1', fullName: 'Khách', phone: null, avatarUrl: null, role: 'CUSTOMER', referralCode: 'RG1' };
    const target = { ...guest, id: 'target1', zaloId: 'z-real', referralCode: 'RT1' };
    const fixture = makeGuestMergeFixture({ guest, target });
    const zalo = { getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-real', name: 'Thật' }), resolvePhoneNumber: jest.fn().mockResolvedValue(null) };
    await makeEnsurePhoneSvc(fixture, zalo, vouchers as unknown as VouchersService).ensurePhoneForCurrentUser('guest1', 'code', 'at');
    expect(vouchers.grantWelcomeNow).not.toHaveBeenCalled();
  });
});
