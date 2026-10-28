import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { COD_MAX_PER_ORDER } from '../../modules/checkout/checkout-split';
import { parseCronBackup, type BackupSnapshot } from './backup-checks';
import { CONFIG_KEYS_OF_INTEREST, type DbSnapshot } from './db-checks';
import { collectDemoData } from './demo-data-checks';
import { EXPECTED_QUEUES, type QueueSnapshot, type RedisSnapshot } from './redis-checks';
import { describeError } from './secrets';
import type { Env } from './types';

const run = promisify(execFile);

export async function listExpectedMigrations(migrationsDir: string): Promise<string[]> {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Lỗi do schema DB cũ hơn mã: cột/bảng chưa có (P2021, P2022; câu raw báo P2010 kèm mã Postgres 42703/42P01). */
export function isSchemaMismatch(err: unknown): boolean {
  const { code, meta } = (err ?? {}) as { code?: unknown; meta?: { code?: unknown } };
  if (code === 'P2021' || code === 'P2022') return true;
  return code === 'P2010' && (meta?.code === '42703' || meta?.code === '42P01');
}

/**
 * Đọc DB trong MỘT transaction READ ONLY: lệnh ghi nào lọt vào cũng bị Postgres từ chối.
 * Bảng chưa có (DB trước khi áp migration mới) được bỏ qua thay vì làm hỏng cả lượt kiểm; phần nào đụng cột chưa có thì ghi vào
 * `degraded` (kèm mã lỗi) để evaluateDb hạ riêng các dòng của phần đó, còn phần migration và số đơn chỉ dựa vào bảng luôn có.
 */
export async function collectDbSnapshot(prisma: PrismaClient, expectedMigrations: string[]): Promise<DbSnapshot> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');

      const exists = async (table: string): Promise<boolean> => {
        const rows = await tx.$queryRaw<{ ok: string | null }[]>`SELECT to_regclass(${`public.${table}`})::text AS ok`;
        return Boolean(rows[0]?.ok);
      };

      let appliedMigrations: string[] = [];
      let unfinishedMigrations: string[] = [];
      if (await exists('_prisma_migrations')) {
        const rows = await tx.$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
          SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
        appliedMigrations = rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
        unfinishedMigrations = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
      }

      const count = async (table: string, where = 'true'): Promise<number> => {
        if (!(await exists(table))) return 0;
        const rows = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table}" WHERE ${where}`);
        return Number(rows[0]?.n ?? 0);
      };

      // Mỗi phần chạy trong một SAVEPOINT: Postgres huỷ cả transaction sau một câu lệnh lỗi, nên không có savepoint thì một
      // cột chưa có (schema cũ hơn mã) làm các phần sau đều hỏng theo.
      const degraded: DbSnapshot['degraded'] = {};
      const guarded = async <T>(part: keyof NonNullable<DbSnapshot['degraded']>, fallback: T, read: () => Promise<T>): Promise<T> => {
        await tx.$executeRawUnsafe('SAVEPOINT golive_part');
        try {
          const value = await read();
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT golive_part');
          return value;
        } catch (err) {
          if (!isSchemaMismatch(err)) throw err;
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT golive_part');
          degraded[part] = describeError(err);
          return fallback;
        }
      };

      const configs = await guarded<Record<string, unknown>>('configs', {}, async () => {
        const out: Record<string, unknown> = {};
        if (await exists('system_configs')) {
          const rows = await tx.systemConfig.findMany({ where: { key: { in: [...CONFIG_KEYS_OF_INTEREST] } }, select: { key: true, value: true } });
          for (const r of rows) out[r.key] = r.value;
        }
        return out;
      });

      const znsTemplates = await guarded('zns', [], async () =>
        (await exists('notification_templates'))
          ? await tx.notificationTemplate.findMany({ select: { code: true, channel: true, zaloTemplateId: true }, orderBy: { code: 'asc' } })
          : [],
      );

      const membershipTiers = await guarded('membershipTiers', [], async () =>
        (await exists('membership_tiers')) ? (await tx.membershipTier.findMany({ select: { pointMultiplier: true } })).map((t) => Number(t.pointMultiplier)) : [],
      );

      const orderCount = await count('orders');
      const waste = await guarded('waste', { tableExists: false, totalPoints: 0, activeWarehouses: 0, activeWarehousesWithPhone: 0, activePointsWithoutHours: 0 }, async () => ({
        tableExists: await exists('waste_points'),
        totalPoints: await count('waste_points'),
        activeWarehouses: await count('waste_points', `"kind" = 'WAREHOUSE' AND "status" = 'ACTIVE'`),
        activeWarehousesWithPhone: await count('waste_points', `"kind" = 'WAREHOUSE' AND "status" = 'ACTIVE' AND trim(coalesce("phone", '')) <> ''`),
        activePointsWithoutHours: await count('waste_points', `"status" = 'ACTIVE' AND "openingHours"::text !~ '"open"'`),
      }));
      const dealerTierCount = await guarded('dealerTiers', 0, () => count('dealer_tiers'));
      const admin = await guarded('admin', { adminCount: 0, pendingAdminGrants: 0 }, async () => ({
        adminCount: await count('users', `"role" = 'ADMIN'`),
        pendingAdminGrants: await count('role_grants', `"role" = 'ADMIN' AND "revokedAt" IS NULL`),
      }));
      const demoData = await guarded<DbSnapshot['demoData']>('demoData', undefined, async () =>
        (await exists('products')) && (await exists('coupons')) ? await collectDemoData(tx) : undefined,
      );

      return {
        appliedMigrations,
        unfinishedMigrations,
        expectedMigrations,
        orderCount,
        waste,
        configs,
        membershipTiers,
        dealerTierCount,
        adminCount: admin.adminCount,
        pendingAdminGrants: admin.pendingAdminGrants,
        znsTemplates,
        codMaxPerOrder: COD_MAX_PER_ORDER,
        demoData,
        ...(Object.keys(degraded).length > 0 ? { degraded } : {}),
      } satisfies DbSnapshot;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

function redisDbIndex(redisUrl: string): number {
  try {
    const p = new URL(redisUrl).pathname.replace(/^\//, '');
    return /^\d+$/.test(p) ? Number(p) : 0;
  } catch {
    return 0;
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} quá ${ms}ms`)), ms).unref())]);

type RedisCall = { call(command: string, ...args: string[]): Promise<unknown>; disconnect(): void };

async function configGet(client: RedisCall, name: string): Promise<string | null> {
  try {
    const res = await client.call('CONFIG', 'GET', name);
    return Array.isArray(res) && typeof res[1] === 'string' ? res[1] : null;
  } catch {
    return null;
  }
}

/**
 * Chỉ dùng lệnh đọc (PING, CONFIG GET, đếm job) và lệnh mức kết nối của BullMQ. `skipMetasUpdate` tắt việc Queue tự
 * ghi khoá meta lúc khởi tạo, nên lượt kiểm không để lại dấu nào trong Redis.
 */
export async function collectRedisSnapshot(redisUrl: string): Promise<RedisSnapshot> {
  const base: RedisSnapshot = { reachable: false, dbIndex: redisDbIndex(redisUrl), maxmemoryPolicy: null, maxmemoryBytes: null, appendonly: null, queues: [] };
  const opts = { skipMetasUpdate: true, skipVersionCheck: true } as const;
  const first = new Queue(EXPECTED_QUEUES[0], { ...opts, connection: { url: redisUrl, retryStrategy: () => null, connectTimeout: 5000, enableOfflineQueue: false } });
  first.on('error', () => undefined);
  const queues: Queue[] = [first];
  let client: RedisCall | undefined;
  try {
    const c = await withTimeout(first.client, 8000, 'kết nối Redis');
    client = c as unknown as RedisCall;
    const ping = await withTimeout((c as unknown as { ping(): Promise<string> }).ping(), 5000, 'PING');
    if (ping !== 'PONG') return { ...base, error: `PING trả "${ping}"` };

    const [policy, maxmem, aof] = await Promise.all([configGet(client, 'maxmemory-policy'), configGet(client, 'maxmemory'), configGet(client, 'appendonly')]);
    const snaps: QueueSnapshot[] = [];
    for (const name of EXPECTED_QUEUES) {
      try {
        const q = name === EXPECTED_QUEUES[0] ? first : new Queue(name, { ...opts, connection: c });
        if (q !== first) {
          q.on('error', () => undefined);
          queues.push(q);
        }
        const counts = await withTimeout(q.getJobCounts('waiting', 'active', 'delayed', 'failed'), 5000, `đếm job ${name}`);
        snaps.push({
          name,
          ok: true,
          counts: { waiting: counts.waiting ?? 0, active: counts.active ?? 0, delayed: counts.delayed ?? 0, failed: counts.failed ?? 0 },
        });
      } catch (err) {
        snaps.push({ name, ok: false, error: describeError(err) });
      }
    }
    return {
      ...base,
      reachable: true,
      maxmemoryPolicy: policy,
      maxmemoryBytes: maxmem === null ? null : Number(maxmem),
      appendonly: aof,
      queues: snaps,
    };
  } catch (err) {
    return { ...base, error: describeError(err) };
  } finally {
    await Promise.all(queues.map((q) => q.close().catch(() => undefined)));
    client?.disconnect();
  }
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function readCrontab(): Promise<{ visible: boolean; text: string }> {
  // Trong container, crontab và /etc/cron.d là của container chứ không phải của máy chủ: coi như không thấy.
  if ((await readIfExists('/.dockerenv')) !== null) return { visible: false, text: '' };
  let visible = false;
  let text = '';
  try {
    const { stdout } = await run('crontab', ['-l'], { timeout: 3000 });
    visible = true;
    text += `${stdout}\n`;
  } catch (err) {
    const stderr = (err as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && /no crontab/i.test(stderr)) visible = true;
  }
  const files = ['/etc/crontab'];
  try {
    for (const f of await fs.readdir('/etc/cron.d')) files.push(path.join('/etc/cron.d', f));
  } catch {
    /* không có /etc/cron.d: bình thường trong container */
  }
  for (const f of files) {
    const t = await readIfExists(f);
    if (t !== null) {
      visible = true;
      text += `${t}\n`;
    }
  }
  return { visible, text };
}

async function findRepoRoot(start: string, explicit: string | undefined): Promise<string | null> {
  const candidates = explicit ? [explicit] : [];
  let dir = start;
  for (let i = 0; i < 6; i += 1) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    if ((await readIfExists(path.join(c, 'docker-compose.vietnix.yml'))) !== null) return c;
  }
  return null;
}

/** Dòng `listremotes --long`: "tên:  loại", rclone mới (1.66+) có thể thêm cột mô tả thứ ba nên chỉ lấy hai cột đầu. */
export function parseRemoteTypes(stdout: string): Record<string, string> {
  const types: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const m = /^(\S+?):\s+(\S+)(?:\s.*)?$/.exec(line.trim());
    if (m?.[1] && m[2]) types[m[1]] = m[2];
  }
  return types;
}

/** Chỉ đọc và liệt kê: không chạy backup, không chạm vào file backup, không gọi rclone ngoài `listremotes --long`. */
export async function collectBackupSnapshot(env: Env, now: Date = new Date(), cwd: string = process.cwd()): Promise<BackupSnapshot> {
  const root = await findRepoRoot(cwd, env.GO_LIVE_REPO_ROOT);
  let script: BackupSnapshot['script'] = 'unknown';
  if (root) script = (await readIfExists(path.join(root, 'tools/backup/backup-db.sh'))) !== null ? 'found' : 'missing';

  const cron = await readCrontab();

  let rclone: BackupSnapshot['rclone'] = { available: false, remotes: [] };
  try {
    const { stdout } = await run('rclone', ['listremotes', '--long'], { timeout: 5000 });
    const types = parseRemoteTypes(stdout);
    rclone = { available: true, remotes: Object.keys(types), types };
  } catch {
    /* không có rclone ở nơi chạy: để evaluateBackup báo "không kiểm được" */
  }

  const dirPath = env.BACKUP_DIR?.trim() || '/var/backups/tubutree';
  const dir: BackupSnapshot['dir'] = { path: dirPath, visible: false, fileCount: 0, newest: null };
  try {
    const names = (await fs.readdir(dirPath)).filter((n) => /^tubutree_.*\.sql\.gz$/.test(n));
    dir.visible = true;
    dir.fileCount = names.length;
    let newest: { mtimeMs: number; size: number } | null = null;
    for (const n of names) {
      const st = await fs.stat(path.join(dirPath, n));
      if (!newest || st.mtimeMs > newest.mtimeMs) newest = { mtimeMs: st.mtimeMs, size: st.size };
    }
    if (newest) dir.newest = { ageHours: Math.max(0, (now.getTime() - newest.mtimeMs) / 3_600_000), sizeBytes: newest.size };
  } catch {
    /* thư mục không thấy từ nơi chạy */
  }

  return { script, cron: { visible: cron.visible, ...parseCronBackup(cron.text) }, rclone, dir };
}
