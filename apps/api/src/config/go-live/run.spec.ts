import { GOOD_BACKUP, GOOD_DB, GOOD_ENV, GOOD_REDIS, REQUIRED, byId } from './go-live.fixtures';
import { exitCodeFor } from './report';
import { parseEnvFile, parsePhase, runGoLiveCheck } from './run';
import type { Collectors } from './run';

const good: Collectors = {
  db: async () => GOOD_DB,
  redis: async () => GOOD_REDIS,
  backup: async () => GOOD_BACKUP,
};

describe('parsePhase', () => {
  it('mặc định là post-deploy', () => expect(parsePhase([])).toBe('post-deploy'));
  it('nhận --phase=pre-deploy', () => expect(parsePhase(['--phase=pre-deploy'])).toBe('pre-deploy'));
  it('nhận --phase post-deploy (tách rời)', () => expect(parsePhase(['--phase', 'post-deploy'])).toBe('post-deploy'));
  it('bỏ qua tham số lạ và dấu --', () => expect(parsePhase(['--', '--phase=pre-deploy', '--khac'])).toBe('pre-deploy'));
  it('giá trị sai thì ném lỗi', () => {
    expect(() => parsePhase(['--phase=ngay-mai'])).toThrow(/pre-deploy hoặc post-deploy/);
    expect(() => parsePhase(['--phase'])).toThrow(/nhận được ""/);
  });
});

describe('parseEnvFile', () => {
  it('không có thì null', () => expect(parseEnvFile(['--phase=pre-deploy'])).toBeNull());
  it('nhận --env-file=đường-dẫn', () => expect(parseEnvFile(['--env-file=./.env'])).toBe('./.env'));
  it('nhận --env-file đường-dẫn (tách rời)', () => expect(parseEnvFile(['--env-file', '/tmp/x.env'])).toBe('/tmp/x.env'));
  it('thiếu giá trị thì null', () => {
    expect(parseEnvFile(['--env-file'])).toBeNull();
    expect(parseEnvFile(['--env-file='])).toBeNull();
  });
});

describe('runGoLiveCheck', () => {
  it('mọi nhóm tốt: không FAIL, thoát 0', async () => {
    const results = await runGoLiveCheck({ env: GOOD_ENV, phase: 'post-deploy' }, good);
    expect(results.filter((r) => r.status === 'FAIL')).toEqual([]);
    expect(exitCodeFor(results)).toBe(0);
    const groups = new Set(results.map((r) => r.group));
    expect(groups).toEqual(new Set(['Cấu hình lõi', 'Zalo', 'Pancake', 'Gomdon', 'ZaloPay', 'Accesstrade', 'Ảnh (Cloudinary)', 'AI tư vấn', 'Báo động vận hành', 'Cơ sở dữ liệu', 'Redis', 'Hàng đợi BullMQ', 'Backup']));
  });

  it('mỗi nhóm nằm liền một khối để bảng không lặp tiêu đề', async () => {
    const results = await runGoLiveCheck({ env: GOOD_ENV, phase: 'post-deploy' }, good);
    const seen: string[] = [];
    for (const r of results) if (seen[seen.length - 1] !== r.group) seen.push(r.group);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('truyền giai đoạn xuống phần DB', async () => {
    const pending = { ...GOOD_DB, appliedMigrations: GOOD_DB.appliedMigrations.slice(0, 1) };
    const c = { ...good, db: async () => pending };
    expect(byId(await runGoLiveCheck({ env: GOOD_ENV, phase: 'post-deploy' }, c), 'db.migrations_pending').status).toBe('FAIL');
    expect(byId(await runGoLiveCheck({ env: GOOD_ENV, phase: 'pre-deploy' }, c), 'db.migrations_pending').status).toBe('WARN');
  });

  it('trạng thái đã ghi trong runbook (PROD cũ, bản mới chưa áp): bước 4 pre-deploy thoát 0, chỉ WARN', async () => {
    const required: readonly string[] = REQUIRED;
    const oldProd = {
      ...GOOD_DB,
      appliedMigrations: GOOD_DB.appliedMigrations.filter((m) => !required.includes(m)),
      orderCount: 300_000,
      refill: { totalRows: 0, activeRows: 0, tableExists: false },
      configs: Object.fromEntries(Object.entries(GOOD_DB.configs).filter(([k]) => k !== 'refill.pickup_address')),
    };
    const c = { ...good, db: async () => oldProd, redis: async () => ({ ...GOOD_REDIS, maxmemoryPolicy: 'allkeys-lru' }) };
    const pre = await runGoLiveCheck({ env: GOOD_ENV, phase: 'pre-deploy' }, c);
    expect(pre.filter((x) => x.status === 'FAIL')).toEqual([]);
    expect(exitCodeFor(pre)).toBe(0);
    expect(byId(pre, 'db.refill_location').status).toBe('WARN');
    expect(byId(pre, 'redis.policy').status).toBe('WARN');
    const post = await runGoLiveCheck({ env: GOOD_ENV, phase: 'post-deploy' }, c);
    expect(post.filter((x) => x.status === 'FAIL').map((x) => x.id).sort()).toEqual(['db.migrations_pending', 'db.refill_location', 'db.required_migrations', 'redis.policy']);
  });

  it('DB không kết nối được: một dòng FAIL, các nhóm khác vẫn chạy, không lộ thông điệp lỗi', async () => {
    const c = { ...good, db: async () => Promise.reject(Object.assign(new Error('Authentication failed for user tubu at postgres'), { code: 'P1000' })) };
    const results = await runGoLiveCheck({ env: GOOD_ENV, phase: 'post-deploy' }, c);
    const r = byId(results, 'db.connect');
    expect(r.status).toBe('FAIL');
    expect(r.detail).toContain('P1000');
    expect(JSON.stringify(r)).not.toContain('tubu at postgres');
    expect(results.some((x) => x.id === 'redis.reachable')).toBe(true);
    expect(results.some((x) => x.id === 'backup.script')).toBe(true);
    expect(exitCodeFor(results)).toBe(1);
  });

  it('Redis ném lỗi: một dòng FAIL', async () => {
    const c = { ...good, redis: async () => Promise.reject(new Error('boom')) };
    const results = await runGoLiveCheck({ env: GOOD_ENV, phase: 'post-deploy' }, c);
    expect(byId(results, 'redis.connect').status).toBe('FAIL');
    expect(byId(results, 'redis.connect').detail).toContain('Error');
    expect(results.some((x) => x.id === 'db.admin_user')).toBe(true);
  });

  it('thu thập backup lỗi: chỉ WARN, không chặn', async () => {
    const c = { ...good, backup: async () => Promise.reject(new Error('EACCES')) };
    const results = await runGoLiveCheck({ env: GOOD_ENV, phase: 'post-deploy' }, c);
    expect(byId(results, 'backup.collect').status).toBe('WARN');
    expect(exitCodeFor(results)).toBe(0);
  });

  it('chạy cả ba kịch bản hỏng cùng lúc vẫn ra báo cáo đầy đủ', async () => {
    const c: Collectors = { db: () => Promise.reject(new Error('x')), redis: () => Promise.reject(new Error('y')), backup: () => Promise.reject(new Error('z')) };
    const results = await runGoLiveCheck({ env: {}, phase: 'post-deploy' }, c);
    expect(results.filter((r) => r.status === 'FAIL').length).toBeGreaterThan(5);
    expect(exitCodeFor(results)).toBe(1);
  });
});
