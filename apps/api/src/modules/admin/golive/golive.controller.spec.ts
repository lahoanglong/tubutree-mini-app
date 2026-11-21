import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { existsSync } from 'node:fs';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { STAFF_PERMISSIONS_KEY } from '../../../common/staff-permissions';
import { collectBackupSnapshot, collectDbSnapshot, collectRedisSnapshot, listExpectedMigrations } from '../../../config/go-live/collect';
import { GOOD_BACKUP, GOOD_DB, GOOD_ENV, GOOD_REDIS, SECRET_ENV_KEYS } from '../../../config/go-live/go-live.fixtures';
import { GoLiveCockpitService, MIGRATIONS_DIR } from './golive-cockpit.service';
import { GoLiveController, PilotCleanupDto } from './golive.controller';

jest.mock('../../../config/go-live/collect', () => ({
  ...jest.requireActual('../../../config/go-live/collect'),
  collectDbSnapshot: jest.fn(),
  collectRedisSnapshot: jest.fn(),
  collectBackupSnapshot: jest.fn(),
  listExpectedMigrations: jest.fn(),
}));

const METHODS = ['cockpit', 'pilotOrders', 'cleanup'] as const;

describe('GoLiveController: chỉ ADMIN', () => {
  it('@Roles ADMIN ở lớp, không route nào mở cho nhóm việc nhân viên hay @Public', () => {
    expect(Reflect.getMetadata(ROLES_KEY, GoLiveController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, GoLiveController)).toBeUndefined();
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GoLiveController)).toBeUndefined();
    const methods = Object.getOwnPropertyNames(GoLiveController.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual([...METHODS].sort());
    for (const m of METHODS) {
      const handler = GoLiveController.prototype[m];
      expect(Reflect.getMetadata(STAFF_PERMISSIONS_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    }
  });

  const ctx = (m: (typeof METHODS)[number], user: object | undefined) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => GoLiveController.prototype[m],
      getClass: () => GoLiveController,
    }) as unknown as ExecutionContext;

  it('chưa đăng nhập: JwtAuthGuard toàn app không bỏ qua route nào và trả 401', () => {
    const reflector = new Reflector();
    for (const m of METHODS) {
      expect(reflector.getAllAndOverride(IS_PUBLIC_KEY, [GoLiveController.prototype[m], GoLiveController])).toBeUndefined();
    }
    let err: unknown;
    try {
      new JwtAuthGuard(reflector).handleRequest(null, false);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getStatus()).toBe(401);
  });

  it('RolesGuard thật: ADMIN qua; nhân viên đủ mọi nhóm việc, khách, CTV, đại lý nhận 403', () => {
    const guard = new RolesGuard(new Reflector());
    for (const m of METHODS) {
      expect(guard.canActivate(ctx(m, { role: 'ADMIN' }))).toBe(true);
      for (const user of [
        { role: 'STAFF', staffPermissions: ['CSKH', 'KHO', 'MARKETING', 'KE_TOAN'] },
        { role: 'STAFF', staffPermissions: [] },
        { role: 'CUSTOMER' },
        { role: 'AFFILIATE' },
        { role: 'DEALER' },
      ]) {
        let err: unknown;
        try {
          guard.canActivate(ctx(m, user));
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).getStatus()).toBe(403);
      }
    }
  });
});

describe('PilotCleanupDto', () => {
  const errors = (body: object) => validateSync(plainToInstance(PilotCleanupDto, body)).map((e) => e.property);

  it('nhận body xem trước rỗng và body dọn thật đủ trường', () => {
    expect(errors({})).toEqual([]);
    expect(errors({ dryRun: false, confirmText: 'XOA DON THU', codes: ['TB1'], phones: ['0901234567'] })).toEqual([]);
  });

  it('dryRun phải là boolean thật (chuỗi "false" không được coi là dọn thật), tối đa 50 mã, tối đa 5 SĐT', () => {
    expect(errors({ dryRun: 'false' })).toEqual(['dryRun']);
    expect(errors({ codes: Array.from({ length: 51 }, (_, i) => `TB${i}`) })).toEqual(['codes']);
    expect(errors({ phones: '0901,0902,0903,0904,0905,0906' })).toEqual(['phones']);
  });
});

describe('GET /admin/golive/cockpit không lộ bí mật', () => {
  const prisma = {
    product: { findMany: jest.fn().mockResolvedValue([{ ingredients: ['Aqua'] }, { ingredients: null }]), count: jest.fn().mockResolvedValue(1) },
    variation: { count: jest.fn().mockResolvedValue(0) },
    opsHealthState: { findUnique: jest.fn().mockResolvedValue({ lastOkAt: new Date('2026-11-21T01:00:00Z'), lastErrorAt: null }) },
    pancakeWebhookEvent: { findFirst: jest.fn().mockResolvedValue(null) },
    order: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const config = { get: jest.fn().mockResolvedValue('') };
  const refill = { adminOverview: jest.fn().mockResolvedValue({ enabled: true, rows: [{ status: 'auto' }, { status: 'near' }] }) };
  const env: Record<string, string | undefined> = {
    ...GOOD_ENV,
    SMTP_PASS: 'smtp-pass-Hy7Uj4Ik1Ol8',
    OPS_ALERT_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/slackTokenZZ9988',
    ANTIGRAVITY_GATEWAY_KEY: 'gw-key-Qw3Er6Ty9Ui2',
  };
  const realEnv = process.env;

  beforeEach(() => {
    jest.mocked(listExpectedMigrations).mockResolvedValue(GOOD_DB.expectedMigrations);
    jest.mocked(collectDbSnapshot).mockResolvedValue(GOOD_DB);
    jest.mocked(collectRedisSnapshot).mockResolvedValue(GOOD_REDIS);
    jest.mocked(collectBackupSnapshot).mockResolvedValue(GOOD_BACKUP);
  });
  afterEach(() => {
    process.env = realEnv;
  });

  it('JSON trả về không chứa giá trị nào của biến env bí mật (kể cả mật khẩu trong DATABASE_URL), mà vẫn có đủ 6 thẻ', async () => {
    process.env = { ...env };
    const svc = new GoLiveCockpitService(prisma as never, config as never, refill as never);
    const out = await new GoLiveController(svc, {} as never).cockpit('1');
    const json = JSON.stringify(out);
    expect(out.cards.map((c) => c.key)).toEqual(['infra', 'zalo', 'pancake', 'waste', 'catalog', 'legal']);
    const fromKeys = SECRET_ENV_KEYS.map((k) => env[k]).filter((v): v is string => typeof v === 'string');
    expect(fromKeys.length).toBeGreaterThanOrEqual(15);
    const secrets = [...fromKeys, env.DATABASE_URL, 'db-pass-zz91', 'slackTokenZZ9988', env.GOMDON_PHONE, env.THROTTLE_BYPASS_TOKEN];
    for (const s of secrets) {
      expect(typeof s).toBe('string');
      expect([s, json.includes(s as string)]).toEqual([s, false]);
    }
  });

  it('dòng nào sơ ý in nguyên khoá cũng bị thay bằng *** trước khi trả', async () => {
    jest.mocked(collectDbSnapshot).mockResolvedValue({ ...GOOD_DB, unfinishedMigrations: [`m_${GOOD_ENV.PANCAKE_API_KEY}`] });
    const svc = new GoLiveCockpitService(prisma as never, config as never, refill as never);
    const json = JSON.stringify(await svc.cockpit({ fresh: true }, env));
    expect(json.includes(GOOD_ENV.PANCAKE_API_KEY as string)).toBe(false);
    expect(json).toContain('m_***');
  });

  it('bộ đệm 15 giây: lần gọi thứ hai không chạy lại bộ kiểm; fresh chạy lại', async () => {
    const svc = new GoLiveCockpitService(prisma as never, config as never, refill as never);
    let t = Date.parse('2026-11-21T05:00:00Z');
    const now = () => new Date(t);
    await svc.cockpit({}, env, now);
    const calls = jest.mocked(collectDbSnapshot).mock.calls.length;
    t += 5_000;
    await svc.cockpit({}, env, now);
    expect(jest.mocked(collectDbSnapshot).mock.calls.length).toBe(calls);
    await svc.cockpit({ fresh: true }, env, now);
    expect(jest.mocked(collectDbSnapshot).mock.calls.length).toBe(calls + 1);
  });

  it('đường tới thư mục migration đúng ở mã nguồn (bản build cùng độ sâu)', () => {
    expect(existsSync(MIGRATIONS_DIR)).toBe(true);
    expect(MIGRATIONS_DIR.endsWith('apps/api/prisma/migrations')).toBe(true);
  });
});
