import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { VouchersService } from '../../src/modules/vouchers/vouchers.service';
import { createOrder, createUser, randCode, sleep, warmPool } from './helpers';

/**
 * D2-07a: voucher chào mừng cấp ngay khi tài khoản thật được tạo (AuthService → grantWelcomeNow), cron mỗi giờ
 * (welcomeVouchers) vẫn là lưới. Hai đường dùng chung grant() với code tất định WELCOME-<userId>, nên chạy song song
 * thật trên Postgres vẫn chỉ ra đúng một mã và một thông báo.
 */
describe('Voucher chào mừng lúc đăng ký song song với cron (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let vouchers: VouchersService;
  let auth: AuthService;
  const notify = jest.fn().mockResolvedValue(undefined);

  const welcomeOf = (userId: string) =>
    prisma.coupon.findMany({ where: { code: `WELCOME-${userId}`.toUpperCase() } });
  const notifiedFor = (userId: string) => notify.mock.calls.filter((c) => c[0] === userId && c[1] === 'WELCOME_VOUCHER').length;
  const userByZalo = (zaloId: string) => prisma.user.findUniqueOrThrow({ where: { zaloId } });
  const newZaloId = () => `${Date.now()}${randCode(8)}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, VouchersService, { provide: NotificationsService, useValue: { notify } }],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    vouchers = moduleRef.get(VouchersService);

    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-welcome', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    // accessToken đóng vai zaloId để mỗi lần gọi song song là một tài khoản Zalo khác nhau.
    const zalo = {
      getUserInfo: async (accessToken: string) => ({ zaloId: accessToken, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac, undefined, vouchers);
  });

  beforeEach(() => notify.mockClear());
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Giữ hai lần findUnique của đúng mã này lại đến khi cả hai đã đọc "chưa có", ép hai đường cùng đi qua cửa kiểm trùng. */
  function holdBothAtCodeCheck(code: string) {
    const original = prisma.coupon.findUnique.bind(prisma.coupon) as (a: { where: { code?: string } }) => Promise<unknown>;
    let seen = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    jest.spyOn(prisma.coupon, 'findUnique').mockImplementation((async (args: { where: { code?: string } }) => {
      const result = await original(args);
      if (args.where.code !== code) return result;
      if (++seen === 2) release();
      await Promise.race([gate, sleep(5000)]);
      return result;
    }) as never);
    return () => seen;
  }

  it('8 tài khoản Zalo đăng nhập lần đầu cùng lúc với 2 lượt cron: mỗi tài khoản đúng 1 voucher và 1 thông báo', async () => {
    const zaloIds = Array.from({ length: 8 }, newZaloId);

    await Promise.all([
      ...zaloIds.map((z) => auth.loginWithZaloMiniApp('code', z)),
      vouchers.welcomeVouchers(),
      vouchers.welcomeVouchers(),
    ]);
    await vouchers.welcomeVouchers();

    const users = await Promise.all(zaloIds.map(userByZalo));
    const coupons = await Promise.all(users.map((u) => welcomeOf(u.id)));
    console.log('[welcome-signup] coupons per user=%j notified=%j', coupons.map((c) => c.length), users.map((u) => notifiedFor(u.id)));
    expect(coupons.map((c) => c.length)).toEqual(zaloIds.map(() => 1));
    expect(users.map((u) => notifiedFor(u.id))).toEqual(zaloIds.map(() => 1));
    expect(coupons[0]![0]).toMatchObject({ type: 'AMOUNT', value: 30000, minOrder: 199000, usageLimit: 1, perUserLimit: 1, scope: 'USER_GROUP' });
  });

  it('ép hai lần cấp ngay cùng qua cửa kiểm trùng: một bên thua P2002 nhưng trả false, không ném lỗi; 1 mã, 1 thông báo', async () => {
    const user = await createUser(prisma, { zaloId: newZaloId() });
    const seen = holdBothAtCodeCheck(`WELCOME-${user.id}`.toUpperCase());

    const results = await Promise.allSettled([vouchers.grantWelcomeNow(user.id), vouchers.grantWelcomeNow(user.id)]);

    expect(seen()).toBe(2);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(results.map((r) => (r as PromiseFulfilledResult<boolean>).value).sort()).toEqual([false, true]);
    expect(await welcomeOf(user.id)).toHaveLength(1);
    expect(notifiedFor(user.id)).toBe(1);
  });

  it('ép đường cấp ngay và cron cùng qua cửa kiểm trùng của một tài khoản: vẫn 1 mã, 1 thông báo', async () => {
    await vouchers.welcomeVouchers(); // dọn mọi tài khoản còn nợ voucher để cron chỉ còn việc với tài khoản này
    const user = await createUser(prisma, { zaloId: newZaloId() });
    const seen = holdBothAtCodeCheck(`WELCOME-${user.id}`.toUpperCase());

    const results = await Promise.allSettled([vouchers.grantWelcomeNow(user.id), vouchers.welcomeVouchers()]);

    expect(seen()).toBe(2);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await welcomeOf(user.id)).toHaveLength(1);
    expect(notifiedFor(user.id)).toBe(1);
  });

  it('5 lần cấp ngay cho cùng một tài khoản (đăng nhập lại song song) chỉ ra 1 mã', async () => {
    const user = await createUser(prisma, { zaloId: newZaloId() });

    const granted = await Promise.all(Array.from({ length: 5 }, () => vouchers.grantWelcomeNow(user.id)));

    expect(granted.filter(Boolean)).toHaveLength(1);
    expect(await welcomeOf(user.id)).toHaveLength(1);
    expect(notifiedFor(user.id)).toBe(1);
  });

  it('không đổi điều kiện: khách vãng lai, tài khoản đã có đơn, tài khoản quá 24h đều không được cấp (cả đường ngay lẫn cron)', async () => {
    const guest = await createUser(prisma, { zaloId: `guest_d_${randCode(20)}` });
    const ordered = await createUser(prisma, { zaloId: newZaloId() });
    await createOrder(prisma, { userId: ordered.id });
    const old = await createUser(prisma, { zaloId: newZaloId(), createdAt: new Date(Date.now() - 25 * 3600 * 1000) });

    const direct = await Promise.all([guest, ordered, old].map((u) => vouchers.grantWelcomeNow(u.id)));
    await vouchers.welcomeVouchers();

    expect(direct).toEqual([false, false, false]);
    const counts = await Promise.all([guest, ordered, old].map((u) => welcomeOf(u.id).then((c) => c.length)));
    expect(counts).toEqual([0, 0, 0]);
  });

  it('khách chỉ có một đơn đã huỷ vẫn nhận voucher (đường ngay và cron); đơn chờ thanh toán hay đã giao thì không', async () => {
    const cancelled = await createUser(prisma, { zaloId: newZaloId() });
    await createOrder(prisma, { userId: cancelled.id, status: 'CANCELLED' });
    const cancelledCron = await createUser(prisma, { zaloId: newZaloId() });
    await createOrder(prisma, { userId: cancelledCron.id, status: 'CANCELLED' });
    const pending = await createUser(prisma, { zaloId: newZaloId() });
    await createOrder(prisma, { userId: pending.id, status: 'PENDING_PAYMENT' });
    const delivered = await createUser(prisma, { zaloId: newZaloId() });
    await createOrder(prisma, { userId: delivered.id, status: 'DELIVERED' });

    expect(await vouchers.grantWelcomeNow(cancelled.id)).toBe(true);
    await vouchers.welcomeVouchers();

    expect(await welcomeOf(cancelled.id)).toHaveLength(1);
    expect(await welcomeOf(cancelledCron.id)).toHaveLength(1);
    expect(await welcomeOf(pending.id)).toHaveLength(0);
    expect(await welcomeOf(delivered.id)).toHaveLength(0);
  });

  it('dòng đã gộp vào tài khoản khác không được cấp (đường ngay, becameRealNow và cron), tài khoản đích vẫn được', async () => {
    const target = await createUser(prisma, { zaloId: newZaloId() });
    const merged = await createUser(prisma, { zaloId: newZaloId(), mergedIntoId: target.id });

    expect(await vouchers.grantWelcomeNow(merged.id)).toBe(false);
    expect(await vouchers.grantWelcomeNow(merged.id, { becameRealNow: true })).toBe(false);
    expect(await vouchers.grantWelcomeNow(target.id)).toBe(true);
    await vouchers.welcomeVouchers();

    expect(await welcomeOf(merged.id)).toHaveLength(0);
    expect(await welcomeOf(target.id)).toHaveLength(1);
  });

  it('đăng nhập khách vãng lai không cấp; nâng cấp tại chỗ lên tài khoản Zalo thật thì cấp đúng 1 lần, kể cả khi cron chạy cùng lúc', async () => {
    const deviceId = randCode(12);
    const session = await auth.loginAsGuest(deviceId);
    const guestId = session.user.id;
    expect(await welcomeOf(guestId)).toHaveLength(0);

    const zaloId = newZaloId();
    await Promise.all([auth.ensurePhoneForCurrentUser(guestId, 'code', zaloId), vouchers.welcomeVouchers()]);
    await vouchers.welcomeVouchers();

    expect((await userByZalo(zaloId)).id).toBe(guestId);
    expect(await welcomeOf(guestId)).toHaveLength(1);
    expect(notifiedFor(guestId)).toBe(1);
  });

  it('khách vãng lai tạo từ 2 ngày trước mới nâng cấp lên Zalo thật: nhận đúng 1 mã; gọi cấp ngay thêm hai lần song song vẫn 1 mã', async () => {
    const guest = await createUser(prisma, { zaloId: `guest_d_${randCode(20)}`, createdAt: new Date(Date.now() - 48 * 3600 * 1000) });

    await auth.ensurePhoneForCurrentUser(guest.id, 'code', newZaloId());
    expect(await welcomeOf(guest.id)).toHaveLength(1);
    expect(notifiedFor(guest.id)).toBe(1);

    const again = await Promise.all([
      vouchers.grantWelcomeNow(guest.id, { becameRealNow: true }),
      vouchers.grantWelcomeNow(guest.id, { becameRealNow: true }),
    ]);
    expect(again).toEqual([false, false]);
    expect(await welcomeOf(guest.id)).toHaveLength(1);
    expect(notifiedFor(guest.id)).toBe(1);
  });

  it('becameRealNow chỉ bỏ cửa sổ 24h: tài khoản cũ đã có đơn vẫn không được cấp, và cron không đổi cửa sổ', async () => {
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    const ordered = await createUser(prisma, { zaloId: newZaloId(), createdAt: old });
    await createOrder(prisma, { userId: ordered.id });
    const plain = await createUser(prisma, { zaloId: newZaloId(), createdAt: old });

    expect(await vouchers.grantWelcomeNow(ordered.id, { becameRealNow: true })).toBe(false);
    await vouchers.welcomeVouchers();

    expect(await welcomeOf(ordered.id)).toHaveLength(0);
    expect(await welcomeOf(plain.id)).toHaveLength(0);
  });

  it('cấp lỗi ở đường đăng ký không làm rớt đăng nhập, rồi cron cấp bù đúng 1 mã', async () => {
    const zaloId = newZaloId();
    jest.spyOn(vouchers, 'grantWelcomeNow').mockRejectedValueOnce(new Error('db down'));

    const res = await auth.loginWithZaloMiniApp('code', zaloId);
    const user = await userByZalo(zaloId);
    expect(res.accessToken).toBeTruthy();
    expect(await welcomeOf(user.id)).toHaveLength(0);

    await vouchers.welcomeVouchers();
    await vouchers.welcomeVouchers();
    expect(await welcomeOf(user.id)).toHaveLength(1);
  });
});
