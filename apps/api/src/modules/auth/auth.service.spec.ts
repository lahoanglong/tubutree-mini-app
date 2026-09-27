import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { ZaloService } from './zalo.service';
import type { RbacService } from '../staff/rbac/rbac.service';

// applyGrants no-op (identity) cho unit test auth — không đụng DB.
const mkRbac = () =>
  ({ applyGrants: jest.fn(async (u: unknown) => u) } as unknown as RbacService);

const configValues: Record<string, unknown> = {
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL_DAYS: 30,
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

  it('reuse/double-submit: revoke-gate count=0 → Unauthorized "đã được sử dụng", không cấp token', async () => {
    const { svc, prisma, create, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    (updateMany as jest.Mock).mockResolvedValue({ count: 0 }); // request khác đã revoke trước
    await expect(svc.refresh('tok')).rejects.toThrow('đã được sử dụng');
    expect(create).not.toHaveBeenCalled();
  });

  // P1-2 (docs/2026-09-08-review-progress.md): trước đây reuse chỉ chặn ĐÚNG token bị replay —
  // nếu kẻ trộm đã rotate 1 lần trước khi nạn nhân refresh lại, chuỗi refresh token của kẻ
  // trộm (đã cấp mới, chưa revoke) vẫn sống nguyên 30 ngày. Phát hiện reuse phải thu hồi CẢ
  // CHUỖI (mọi refresh token còn active của user đó), không chỉ token vừa bị replay.
  it('reuse phát hiện → thu hồi TOÀN BỘ refresh token còn active của user (không chỉ token bị replay)', async () => {
    const { svc, prisma, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    (updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(svc.refresh('tok')).rejects.toThrow('đã được sử dụng');
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rotation thành công bình thường (không reuse) → KHÔNG thu hồi cả chuỗi, chỉ token cũ', async () => {
    const { svc, prisma, updateMany } = makeService();
    (prisma.refreshToken.findUnique as jest.Mock).mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6), user: USER,
    });
    await svc.refresh('tok');
    // Chỉ 1 lệnh updateMany (revoke-gate theo id) — KHÔNG có lệnh revoke-cả-chuỗi theo userId.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 't1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
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
  pointsTxnConflict?: boolean; // simulate P2002 khi reassign pointsTransaction
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
  const ledgerTables = ['pointsTransaction', 'coinTransaction', 'cashbackClick', 'cashbackTransaction'] as const;
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
    cartItem: {
      findUnique: jest.fn(
        async ({ where }: { where: { cartId_variationId: { cartId: string; variationId: string } } }) => {
          for (const c of carts.values()) {
            if (c.id !== where.cartId_variationId.cartId) continue;
            const item = c.items.find((i) => i.variationId === where.cartId_variationId.variationId);
            if (item) return { ...item };
          }
          return null;
        },
      ),
      // update() mô phỏng CẢ 2 việc mergeGuestInto() dùng: đổi quantity (dòng trùng biến thể ở
      // target) VÀ reparent cartId (dòng không trùng, chuyển thẳng — phải GIỮ NGUYÊN id, xem
      // comment ở auth.service.ts). Reparent nghĩa là item phải chuyển từ mảng items của cart
      // cũ sang mảng items của cart mới trong fixture, để lần tra cứu sau (nếu có) thấy đúng.
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: { quantity?: number; cartId?: string } }) => {
          for (const c of carts.values()) {
            const idx = c.items.findIndex((i) => i.id === where.id);
            if (idx === -1) continue;
            const item = c.items[idx]!;
            if (data.quantity !== undefined) item.quantity = data.quantity;
            if (data.cartId !== undefined && data.cartId !== c.id) {
              c.items.splice(idx, 1);
              const dest = [...carts.values()].find((tc) => tc.id === data.cartId);
              if (!dest) throw new Error('target cart not found');
              dest.items.push(item);
            }
            return { ...item };
          }
          throw new Error('cart item not found');
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        for (const c of carts.values()) {
          const idx = c.items.findIndex((i) => i.id === where.id);
          if (idx !== -1) {
            c.items.splice(idx, 1);
            return {};
          }
        }
        return {};
      }),
      create: jest.fn(
        async ({ data }: { data: { cartId: string; variationId: string; quantity: number } }) => {
          for (const c of carts.values()) {
            if (c.id === data.cartId) {
              const item = { id: `ci_${++itemSeq}`, variationId: data.variationId, quantity: data.quantity };
              c.items.push(item);
              return { ...item };
            }
          }
          throw new Error('cart not found');
        },
      ),
    },
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
  for (const table of ledgerTables) {
    base[table] = {
      updateMany: jest.fn(async () => {
        if (opts.pointsTxnConflict && table === 'pointsTransaction') {
          const err = new Error('unique violation') as Error & { code?: string };
          err.code = 'P2002';
          throw err;
        }
        return { count: 1 };
      }),
    };
  }
  base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));

  return {
    prisma: base as unknown as PrismaService,
    state: { users, carts, addresses, orders, refreshTokens, createdRefreshTokens },
  };
}

function makeEnsurePhoneSvc(fixture: { prisma: PrismaService }, zaloMocks: Record<string, jest.Mock>) {
  const jwt = { signAsync: jest.fn().mockResolvedValue('access-jwt') } as unknown as JwtService;
  const config = { get: (k: string) => configValues[k] } as unknown as ConfigService<never, true>;
  return new AuthService(fixture.prisma, jwt, config, zaloMocks as unknown as ZaloService, mkRbac());
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
      expect(targetRow.coinsBalance).toBe(25); // 5+20
      expect(targetRow.cashbackPending).toBe(200); // 200+0

      // Khách bị khoá lại: zaloId đổi (giải phóng guest_dev1), số dư về 0, refresh token thu hồi.
      const guestRow = fixture.state.users.get('guest1')!;
      expect(guestRow.zaloId).not.toBe('guest_dev1');
      expect(guestRow.zaloId).toContain('guest_dev1_merged_');
      expect(guestRow.pointsBalance).toBe(0);
      expect(guestRow.walletBalance).toBe(0);
      expect(fixture.state.refreshTokens[0]!.revokedAt).toBeInstanceOf(Date);
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

    it('sổ giao dịch điểm đụng ràng buộc unique riêng (vd điểm danh trùng ngày) → bỏ qua BẢNG đó, KHÔNG chặn phần còn lại của merge (số dư vẫn cộng đúng)', async () => {
      const fixture = makeGuestMergeFixture({
        guest: GUEST,
        target: TARGET,
        guestOrders: ['order_g1'],
        pointsTxnConflict: true,
      });
      const zalo = {
        getUserInfo: jest.fn().mockResolvedValue({ zaloId: 'z-real-existing', name: 'Người Thật' }),
        resolvePhoneNumber: jest.fn().mockResolvedValue(null),
      };
      const svc = makeEnsurePhoneSvc(fixture, zalo);

      const res = await svc.ensurePhoneForCurrentUser('guest1', 'code', 'at');

      expect(res.user.id).toBe('target1');
      expect(fixture.state.users.get('target1')!.pointsBalance).toBe(150); // vẫn cộng đúng
      expect(fixture.state.orders.every((o) => o.userId === 'target1')).toBe(true); // phần còn lại vẫn chạy
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
