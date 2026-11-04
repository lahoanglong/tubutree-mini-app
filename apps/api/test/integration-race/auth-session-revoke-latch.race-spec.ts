import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { SessionStateService } from '../../src/modules/auth/session-state.service';
import { UserBlockService } from '../../src/modules/admin/user-block.service';
import type { ZaloService } from '../../src/modules/auth/zalo.service';
import type { RbacService } from '../../src/modules/staff/rbac/rbac.service';
import type { Env } from '../../src/config/env.validation';
import { createUser, randCode, warmPool } from './helpers';

/**
 * Chốt thứ tự bằng chốt chặn thay vì dựa vào may rủi: INSERT token con của lượt refresh đang chạy dở được giữ lại cho tới SAU
 * khi lệnh thu hồi token của logout-all / Cắt phiên / logout theo họ đã chạy. Mã không có kiểm sau sẽ để con sống.
 */
describe('Refresh đang chạy dở × thu hồi phiên: INSERT con xảy ra sau thu hồi (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let auth: AuthService;
  let blocks: UserBlockService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    const cfg: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'it-secret-latch',
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL_DAYS: 30,
      JWT_REFRESH_REUSE_GRACE_SECONDS: 30,
    };
    const config = { get: (k: string) => cfg[k] } as unknown as ConfigService<Env, true>;
    const rbac = { applyGrants: async <T>(u: T) => u } as unknown as RbacService;
    const sessions = new SessionStateService(prisma);
    auth = new AuthService(prisma, new JwtService(), config, {} as ZaloService, rbac, undefined, undefined, undefined, sessions);
    blocks = new UserBlockService(prisma, sessions);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** Lần INSERT refresh token đầu tiên chờ tới khi test gọi release(); mọi lần sau đi thẳng. */
  function holdFirstInsert() {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const insertReached = new Promise<void>((r) => (reached = r));
    const original = prisma.refreshToken.create.bind(prisma.refreshToken);
    let first = true;
    let insertDone = false;
    jest.spyOn(prisma.refreshToken, 'create').mockImplementation(((args: Parameters<typeof original>[0]) => {
      if (!first) return original(args);
      first = false;
      reached();
      return gate.then(() => original(args)).then((row) => {
        insertDone = true;
        return row;
      });
    }) as never);
    return { release, insertReached, isInsertDone: () => insertDone };
  }

  async function guest() {
    const login = await auth.loginAsGuest(`dev_${randCode(10)}`);
    return { login, userId: login.user.id };
  }

  it('logout-all hoàn tất khi refresh đã xoay xong nhưng chưa INSERT con → con không sống', async () => {
    const { login, userId } = await guest();
    const { release, insertReached } = holdFirstInsert();
    const refreshing = auth.refresh(login.refreshToken);
    const settled = refreshing.then(() => 'ok', () => 'rejected');
    await insertReached;
    await auth.logoutAll(userId);
    release();
    expect(await settled).toBe('rejected');
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it('logout-all: INSERT con chen vào đúng lúc tx thu hồi đã chạy lệnh thu hồi nhưng chưa commit → vẫn không sống', async () => {
    const { login, userId } = await guest();
    const { release, insertReached, isInsertDone } = holdFirstInsert();
    const settled = auth.refresh(login.refreshToken).then(() => 'ok', () => 'rejected');
    await insertReached;
    const realTx = prisma.$transaction.bind(prisma);
    jest.spyOn(prisma, '$transaction').mockImplementation(((cb: (tx: Prisma.TransactionClient) => Promise<unknown>, opts?: unknown) =>
      realTx(async (tx) => {
        const wrapped = new Proxy(tx, {
          get(t, k: keyof Prisma.TransactionClient) {
            if (k !== 'refreshToken') return t[k];
            return new Proxy(t.refreshToken, {
              get(rt, m: keyof typeof t.refreshToken) {
                if (m !== 'updateMany') return rt[m];
                return async (...a: unknown[]) => {
                  const r = await (rt.updateMany as (...x: unknown[]) => Promise<unknown>)(...a);
                  release();
                  await sleep(400);
                  // Khe phải dựng được thật: INSERT con đã xong khi tx thu hồi còn chưa commit. Nếu sau này INSERT bị chặn tới commit
                  // thì ca này thành ca logout-all xong trước INSERT và không còn thử đúng khe.
                  expect(isInsertDone()).toBe(true);
                  return r;
                };
              },
            });
          },
        });
        return cb(wrapped);
      }, opts as never)) as never);
    await auth.logoutAll(userId);
    expect(await settled).toBe('rejected');
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it('Cắt phiên của admin hoàn tất khi refresh chưa INSERT con → con không sống', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN', phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` });
    const { login, userId } = await guest();
    const { release, insertReached } = holdFirstInsert();
    const settled = auth.refresh(login.refreshToken).then(() => 'ok', () => 'rejected');
    await insertReached;
    await blocks.revokeSessions(admin.id, userId, 'Nghi lộ phiên');
    release();
    expect(await settled).toBe('rejected');
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });

  it('logout theo họ hoàn tất khi refresh (đổi từ cha trong ân hạn) chưa INSERT con → con không sống', async () => {
    const { login, userId } = await guest();
    const c = await auth.refresh(login.refreshToken);
    const { release, insertReached } = holdFirstInsert();
    const settled = auth.refresh(login.refreshToken).then(() => 'ok', () => 'rejected');
    await insertReached;
    await auth.logout(c.refreshToken);
    release();
    expect(await settled).toBe('rejected');
    expect(await prisma.refreshToken.count({ where: { userId, revokedAt: null } })).toBe(0);
  });
});
