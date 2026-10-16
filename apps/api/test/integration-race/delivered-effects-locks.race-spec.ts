import { randomInt } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AccountDeletionService } from '../../src/modules/users/account-deletion.service';
import { createOrder, createUser, randCode, sleep, summarize, warmPool } from './helpers';

const EARNED = 30;

/**
 * Cộng Điểm Xanh lúc giao (kể cả lần cộng muộn của cron chạy lại việc sau giao) khoá dòng đơn rồi mới tới dòng users. Mọi tx
 * khác vừa đụng đơn vừa đụng users của cùng khách phải đi cùng chiều (đơn → users), nếu không hai bên chờ nhau (40P01):
 * xoá tài khoản (ẩn danh địa chỉ trên đơn) và gộp phiên khách (chuyển đơn sang tài khoản thật). Mỗi ca ép đúng thứ tự xen kẽ
 * bằng một tx thứ ba giữ khoá rồi thả, chạy cả hai chiều "ai khoá trước".
 */
describe('Cộng điểm giao hàng ‖ xoá tài khoản / gộp khách: cùng thứ tự khoá (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let loyalty: LoyaltyService;
  let deletion: AccountDeletionService;
  let auth: AuthService;
  let admin: { id: string };
  let zaloIdForNextCall = '';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, LoyaltyService, AccountDeletionService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    loyalty = moduleRef.get(LoyaltyService);
    deletion = moduleRef.get(AccountDeletionService);
    admin = await createUser(prisma, { role: 'ADMIN' });
    const cfg: Record<string, unknown> = { JWT_ACCESS_SECRET: 'it-secret-delivered-locks', JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL_DAYS: 30 };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const zalo = {
      getUserInfo: async () => ({ zaloId: zaloIdForNextCall, name: 'Zalo IT' }),
      resolvePhoneNumber: async () => null,
    } as unknown as ZaloService;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    auth = new AuthService(prisma, new JwtService(), config, zalo, rbac);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function addressOf(userId: string) {
    return prisma.address.create({
      data: {
        userId,
        recipient: 'Khach IT',
        phone: randomPhone(),
        province: 'Hà Nội',
        district: '',
        ward: 'Phuong IT',
        street: '1 Duong IT',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
        isDefault: true,
      },
    });
  }

  const deliveredOrder = (userId: string) =>
    createOrder(prisma, { userId, status: 'DELIVERED', pointsEarned: EARNED, deliveredAt: new Date(), deliveredEffectsAt: null });

  async function balanceOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot: 'STANDARD' }, _sum: { delta: true } });
    expect(u.pointsBalance).toBe(sum._sum.delta ?? 0);
    return u.pointsBalance;
  }

  const credits = (orderCode: string) => prisma.pointsTransaction.findMany({ where: { reason: `ORDER_DELIVERED:${orderCode}` }, select: { userId: true, delta: true } });

  /** Tx thứ ba giữ khoá cho tới khi release(). */
  async function hold(lock: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<unknown>) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await lock(tx);
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return { release, done, pid };
  }

  async function lockWaiters(holderPid: number) {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      WITH RECURSIVE "w" AS (
        SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
        UNION
        SELECT a."pid" FROM pg_stat_activity a JOIN "w" ON "w"."pid" = ANY(pg_blocking_pids(a."pid"))
      )
      SELECT count(*)::int AS "n" FROM "w"`;
    return row?.n ?? 0;
  }

  async function waitForWaiters(holderPid: number, n: number) {
    for (let i = 0; (await lockWaiters(holderPid)) < n; i++) {
      if (i > 200) throw new Error(`không đủ ${n} phiên chờ khoá`);
      await sleep(25);
    }
  }

  /** `first` tới chỗ chờ khoá giữ, rồi `second` cũng chờ (trực tiếp hoặc sau `first`); thả khoá, cả hai phải xong không lỗi. */
  async function race(holder: Awaited<ReturnType<typeof hold>>, first: () => Promise<unknown>, second: () => Promise<unknown>) {
    const pA = first();
    await waitForWaiters(holder.pid, 1);
    const pB = second();
    await waitForWaiters(holder.pid, 2);
    holder.release();
    await holder.done;
    return summarize(await Promise.allSettled([pA, pB]));
  }

  async function customerWithDeletionRequest() {
    const user = await createUser(prisma, { phone: randomPhone(), fullName: 'Nguyễn Văn Thật' });
    const address = await addressOf(user.id);
    const order = await deliveredOrder(user.id);
    const request = await prisma.accountDeletionRequest.create({ data: { userId: user.id, reason: 'không dùng nữa' } });
    return { user, address, order, request };
  }

  async function expectDeletedAndCreditedOnce(c: Awaited<ReturnType<typeof customerWithDeletionRequest>>) {
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: c.request.id } })).status).toBe('RESOLVED');
    expect(await credits(c.order.code)).toEqual([{ userId: c.user.id, delta: EARNED }]);
    expect(await balanceOf(c.user.id)).toBe(EARNED);
  }

  it('xoá tài khoản khoá users trước (đang ẩn danh địa chỉ) ‖ cộng điểm đơn của khách → không 40P01 (10 vòng)', async () => {
    for (let round = 0; round < 10; round++) {
      const c = await customerWithDeletionRequest();
      // Xoá đã khoá users rồi kẹt ở bước ẩn danh địa chỉ; cộng điểm vào sau, rồi thả: trước đây xoá đi tiếp tới UPDATE orders
      // (chờ khoá đơn của lần cộng) trong khi lần cộng chờ dòng users (chờ xoá) ⇒ deadlock.
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "addresses" WHERE "id" = ${c.address.id} FOR UPDATE`);
      const s = await race(holder, () => deletion.process(c.request.id, admin.id), () => loyalty.creditOrderPoints(c.order.id));
      expect(s.errors).toEqual([]);
      await expectDeletedAndCreditedOnce(c);
    }
  });

  it('cộng điểm khoá đơn trước (đang chờ ghi số dư) ‖ xoá tài khoản → không 40P01 (10 vòng)', async () => {
    for (let round = 0; round < 10; round++) {
      const c = await customerWithDeletionRequest();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${c.user.id} FOR NO KEY UPDATE`);
      const s = await race(holder, () => loyalty.creditOrderPoints(c.order.id), () => deletion.process(c.request.id, admin.id));
      expect(s.errors).toEqual([]);
      await expectDeletedAndCreditedOnce(c);
    }
  });

  async function guestAndTarget() {
    const guest = await createUser(prisma, { zaloId: `guest_dev_${randCode(8)}` });
    const target = await createUser(prisma, { role: 'CUSTOMER', zaloId: `zalo_${randCode(10)}` });
    const address = await addressOf(guest.id);
    const order = await deliveredOrder(guest.id);
    return { guest, target, address, order };
  }

  async function merge(guestId: string, target: { zaloId: string | null }) {
    zaloIdForNextCall = target.zaloId!;
    await auth.ensurePhoneForCurrentUser(guestId, 'code', 'access');
  }

  async function expectMergedAndCreditedOnTarget(c: Awaited<ReturnType<typeof guestAndTarget>>) {
    expect((await prisma.order.findUniqueOrThrow({ where: { id: c.order.id } })).userId).toBe(c.target.id);
    expect(await credits(c.order.code)).toEqual([{ userId: c.target.id, delta: EARNED }]);
    expect(await balanceOf(c.target.id)).toBe(EARNED);
    expect(await balanceOf(c.guest.id)).toBe(0);
  }

  it('gộp khách khoá đơn + users trước (đang chuyển địa chỉ) ‖ cộng điểm đơn của khách → không 40P01, điểm về tài khoản thật (10 vòng)', async () => {
    for (let round = 0; round < 10; round++) {
      const c = await guestAndTarget();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "addresses" WHERE "id" = ${c.address.id} FOR UPDATE`);
      const s = await race(holder, () => merge(c.guest.id, c.target), () => loyalty.creditOrderPoints(c.order.id));
      expect(s.errors).toEqual([]);
      await expectMergedAndCreditedOnTarget(c);
    }
  });

  it('cộng điểm khoá đơn trước (đang chờ ghi số dư) ‖ gộp khách → không 40P01, điểm theo đơn sang tài khoản thật (10 vòng)', async () => {
    for (let round = 0; round < 10; round++) {
      const c = await guestAndTarget();
      const holder = await hold((tx) => tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${c.guest.id} FOR NO KEY UPDATE`);
      const s = await race(holder, () => loyalty.creditOrderPoints(c.order.id), () => merge(c.guest.id, c.target));
      expect(s.errors).toEqual([]);
      await expectMergedAndCreditedOnTarget(c);
    }
  });

  it('gộp khách commit giữa lúc cộng điểm đọc đơn (ngoài tx) và lúc khoá → điểm về chủ đơn hiện tại, không về dòng khách đã gộp', async () => {
    const c = await guestAndTarget();
    const original = loyalty.pointsExpiresAt.bind(loyalty);
    jest.spyOn(loyalty, 'pointsExpiresAt').mockImplementationOnce(async (from: Date) => {
      await merge(c.guest.id, c.target);
      return original(from);
    });
    await expect(loyalty.creditOrderPoints(c.order.id)).resolves.toBe(true);
    await expectMergedAndCreditedOnTarget(c);
    // Gọi lại (cron): không cộng lần hai.
    await expect(loyalty.creditOrderPoints(c.order.id)).resolves.toBe(false);
    await expectMergedAndCreditedOnTarget(c);
  });
});
