import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { collectBackupSnapshot, collectDbSnapshot, listExpectedMigrations } from './collect';

type Row = Record<string, unknown>;

function fakePrisma(opts: { tables: string[]; counts?: Record<string, number>; migrations?: Row[] }) {
  const sql: string[] = [];
  const tables = new Set(opts.tables);
  const tx = {
    $executeRawUnsafe: jest.fn(async (q: string) => {
      sql.push(q);
      return 0;
    }),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = strings.join('?');
      sql.push(q);
      if (q.includes('to_regclass')) return [{ ok: tables.has(String(values[0]).replace('public.', '')) ? values[0] : null }];
      if (q.includes('_prisma_migrations')) return opts.migrations ?? [];
      throw new Error(`câu lệnh không ngờ: ${q}`);
    }),
    $queryRawUnsafe: jest.fn(async (q: string) => {
      sql.push(q);
      const table = /FROM "(\w+)"/.exec(q)?.[1] ?? '';
      return [{ n: BigInt(opts.counts?.[table] ?? 0) }];
    }),
    systemConfig: { findMany: jest.fn(async () => [{ key: 'merchant.commission_pct', value: 0.15 }]) },
    notificationTemplate: { findMany: jest.fn(async () => [{ code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: null }]) },
  };
  const prisma = { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  return { prisma, tx, sql };
}

const ALL_TABLES = ['_prisma_migrations', 'orders', 'refill_pickup_locations', 'system_configs', 'users', 'role_grants', 'notification_templates'];

describe('collectDbSnapshot', () => {
  it('mở transaction READ ONLY trước mọi câu lệnh khác và chỉ chạy SELECT', async () => {
    const { prisma, sql } = fakePrisma({ tables: ALL_TABLES, counts: { orders: 321 } });
    await collectDbSnapshot(prisma, ['m1']);
    expect(sql[0]).toBe('SET TRANSACTION READ ONLY');
    for (const q of sql.slice(1)) expect(q.trim()).toMatch(/^SELECT/i);
  });

  it('gom đúng số liệu từ các bảng', async () => {
    const migrations = [
      { migration_name: 'm1', finished_at: new Date(), rolled_back_at: null },
      { migration_name: 'm2', finished_at: null, rolled_back_at: null },
      { migration_name: 'm3', finished_at: new Date(), rolled_back_at: new Date() },
    ];
    const { prisma } = fakePrisma({ tables: ALL_TABLES, migrations, counts: { orders: 321, users: 2, role_grants: 1 } });
    const snap = await collectDbSnapshot(prisma, ['m1', 'm2']);
    expect(snap.appliedMigrations).toEqual(['m1']);
    expect(snap.unfinishedMigrations).toEqual(['m2']);
    expect(snap.expectedMigrations).toEqual(['m1', 'm2']);
    expect(snap.orderCount).toBe(321);
    expect(snap.refill.tableExists).toBe(true);
    expect(snap.adminCount).toBe(2);
    expect(snap.pendingAdminGrants).toBe(1);
    expect(snap.configs).toEqual({ 'merchant.commission_pct': 0.15 });
    expect(snap.znsTemplates).toEqual([{ code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: null }]);
    expect(snap.codMaxPerOrder).toBe(5_000_000);
  });

  it('DB trước khi áp migration mới: bảng chưa có thì bỏ qua, không truy vấn', async () => {
    const { prisma, sql, tx } = fakePrisma({ tables: ['_prisma_migrations', 'orders', 'users', 'system_configs'], counts: { orders: 10 } });
    const snap = await collectDbSnapshot(prisma, ['m1']);
    expect(snap.refill).toEqual({ totalRows: 0, activeRows: 0, tableExists: false });
    expect(snap.pendingAdminGrants).toBe(0);
    expect(snap.znsTemplates).toEqual([]);
    expect(sql.some((q) => q.includes('FROM "refill_pickup_locations"'))).toBe(false);
    expect(tx.notificationTemplate.findMany).not.toHaveBeenCalled();
  });

  it('DB trống hẳn: mọi thứ về 0', async () => {
    const { prisma, tx } = fakePrisma({ tables: [] });
    const snap = await collectDbSnapshot(prisma, ['m1']);
    expect(snap).toMatchObject({ appliedMigrations: [], unfinishedMigrations: [], orderCount: 0, adminCount: 0, configs: {}, znsTemplates: [] });
    expect(tx.systemConfig.findMany).not.toHaveBeenCalled();
  });
});

describe('listExpectedMigrations', () => {
  it('chỉ lấy thư mục, đã sắp xếp, bỏ migration_lock.toml', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'golive-mig-'));
    try {
      await fs.mkdir(path.join(dir, '20261015070000_b'));
      await fs.mkdir(path.join(dir, '20261014000000_a'));
      await fs.writeFile(path.join(dir, 'migration_lock.toml'), 'provider = "postgresql"');
      expect(await listExpectedMigrations(dir)).toEqual(['20261014000000_a', '20261015070000_b']);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('chạy được trên thư mục migrations thật của repo và có đủ ba migration của đợt', async () => {
    const names = await listExpectedMigrations(path.resolve(__dirname, '../../../prisma/migrations'));
    expect(names).toEqual(expect.arrayContaining(['20261014213300_r6_admin_orders_recipient_search', '20261015070000_r8_refill_locations_table', '20261015150000_r8_multi_reviews_unique_per_order']));
  });
});

describe('collectBackupSnapshot (phần đọc file)', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'golive-bak-'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('tìm bản mới nhất theo mtime và tính tuổi theo giờ, bỏ qua file lạ', async () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const mk = async (name: string, hoursAgo: number, size: number) => {
      const f = path.join(tmp, name);
      await fs.writeFile(f, Buffer.alloc(size));
      const t = new Date(now.getTime() - hoursAgo * 3_600_000);
      await fs.utimes(f, t, t);
    };
    await mk('tubutree_20261013_020000.sql.gz', 58, 100);
    await mk('tubutree_20261015_020000.sql.gz', 10, 2048);
    await mk('khong-lien-quan.txt', 1, 5);
    const snap = await collectBackupSnapshot({ BACKUP_DIR: tmp }, now, tmp);
    expect(snap.dir.visible).toBe(true);
    expect(snap.dir.fileCount).toBe(2);
    expect(snap.dir.newest?.ageHours).toBeCloseTo(10, 1);
    expect(snap.dir.newest?.sizeBytes).toBe(2048);
  });

  it('thư mục không tồn tại thì không thấy, không ném lỗi', async () => {
    const snap = await collectBackupSnapshot({ BACKUP_DIR: path.join(tmp, 'khong-co') }, new Date(), tmp);
    expect(snap.dir).toMatchObject({ visible: false, fileCount: 0, newest: null });
  });

  it('thư mục rỗng thì thấy nhưng không có bản nào', async () => {
    const snap = await collectBackupSnapshot({ BACKUP_DIR: tmp }, new Date(), tmp);
    expect(snap.dir).toMatchObject({ visible: true, fileCount: 0, newest: null });
  });

  it('script: found khi có repo và file, missing khi có repo mà thiếu file, unknown khi không thấy repo', async () => {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(path.join(repo, 'tools/backup'), { recursive: true });
    await fs.writeFile(path.join(repo, 'docker-compose.vietnix.yml'), 'services: {}');
    expect((await collectBackupSnapshot({ GO_LIVE_REPO_ROOT: repo, BACKUP_DIR: tmp }, new Date(), tmp)).script).toBe('missing');
    await fs.writeFile(path.join(repo, 'tools/backup/backup-db.sh'), '#!/usr/bin/env bash');
    expect((await collectBackupSnapshot({ GO_LIVE_REPO_ROOT: repo, BACKUP_DIR: tmp }, new Date(), tmp)).script).toBe('found');
    expect((await collectBackupSnapshot({ BACKUP_DIR: tmp }, new Date(), tmp)).script).toBe('unknown');
  });

  it('cron và rclone luôn trả đúng hình dạng dù máy có hay không', async () => {
    const snap = await collectBackupSnapshot({ BACKUP_DIR: tmp }, new Date(), tmp);
    expect(typeof snap.cron.visible).toBe('boolean');
    expect(typeof snap.cron.hasBackupLine).toBe('boolean');
    expect(typeof snap.rclone.available).toBe('boolean');
    expect(Array.isArray(snap.rclone.remotes)).toBe(true);
  });
});
