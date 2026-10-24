import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { parseRemoteTypes, collectBackupSnapshot, collectDbSnapshot, listExpectedMigrations } from './collect';

type Row = Record<string, unknown>;

interface FakeDemo {
  found: number;
  active: number;
  activeVariations: number;
  coupons: Row[];
}

function fakePrisma(opts: { tables: string[]; counts?: Record<string, number>; migrations?: Row[]; demo?: FakeDemo }) {
  const demo = opts.demo ?? { found: 0, active: 0, activeVariations: 0, coupons: [] };
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
    membershipTier: { findMany: jest.fn(async () => [{ pointMultiplier: 1 }, { pointMultiplier: 1.2 }, { pointMultiplier: 1.5 }, { pointMultiplier: 2 }]) },
    notificationTemplate: { findMany: jest.fn(async () => [{ code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: null }]) },
    product: { count: jest.fn(async (a: { where: Row }) => ('isActive' in a.where ? demo.active : demo.found)) },
    variation: { count: jest.fn(async () => demo.activeVariations) },
    coupon: { findMany: jest.fn(async () => demo.coupons) },
  };
  const prisma = { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  return { prisma, tx, sql };
}

const ALL_TABLES = ['_prisma_migrations', 'orders', 'waste_points', 'system_configs', 'users', 'role_grants', 'notification_templates'];

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
    expect(snap.waste.tableExists).toBe(true);
    expect(snap.adminCount).toBe(2);
    expect(snap.pendingAdminGrants).toBe(1);
    expect(snap.configs).toEqual({ 'merchant.commission_pct': 0.15 });
    expect(snap.znsTemplates).toEqual([{ code: 'ORDER_CONFIRMED', channel: 'ZNS', zaloTemplateId: null }]);
    expect(snap.codMaxPerOrder).toBe(5_000_000);
  });

  it('đếm waste_points: tổng và kho WAREHOUSE đang ACTIVE', async () => {
    const { prisma, sql } = fakePrisma({ tables: ALL_TABLES, counts: { waste_points: 2 } });
    const snap = await collectDbSnapshot(prisma, ['m1']);
    expect(snap.waste).toEqual({ tableExists: true, totalPoints: 2, activeWarehouses: 2, activeWarehousesWithPhone: 2 });
    expect(sql.some((q) => q.includes(`FROM "waste_points" WHERE "kind" = 'WAREHOUSE' AND "status" = 'ACTIVE'`))).toBe(true);
    expect(sql.some((q) => q.includes(`"kind" = 'WAREHOUSE' AND "status" = 'ACTIVE' AND trim(coalesce("phone", '')) <> ''`))).toBe(true);
    expect(sql.some((q) => q.includes('refill_pickup_locations'))).toBe(false);
  });

  it('gom hệ số các hạng thành viên và số bậc đại lý', async () => {
    const { prisma } = fakePrisma({ tables: [...ALL_TABLES, 'membership_tiers', 'dealer_tiers'], counts: { dealer_tiers: 4 } });
    const snap = await collectDbSnapshot(prisma, ['m1']);
    expect(snap.membershipTiers).toEqual([1, 1.2, 1.5, 2]);
    expect(snap.dealerTierCount).toBe(4);
  });

  it('chưa có bảng hạng và bậc đại lý: danh sách rỗng, số 0, không truy vấn', async () => {
    const { prisma, tx, sql } = fakePrisma({ tables: ALL_TABLES });
    const snap = await collectDbSnapshot(prisma, ['m1']);
    expect(snap.membershipTiers).toEqual([]);
    expect(snap.dealerTierCount).toBe(0);
    expect(tx.membershipTier.findMany).not.toHaveBeenCalled();
    expect(sql.some((q) => q.includes('FROM "dealer_tiers"'))).toBe(false);
  });

  it('DB trước khi áp migration mới: bảng chưa có thì bỏ qua, không truy vấn', async () => {
    const { prisma, sql, tx } = fakePrisma({ tables: ['_prisma_migrations', 'orders', 'users', 'system_configs'], counts: { orders: 10 } });
    const snap = await collectDbSnapshot(prisma, ['m1']);
    expect(snap.waste).toEqual({ tableExists: false, totalPoints: 0, activeWarehouses: 0, activeWarehousesWithPhone: 0 });
    expect(snap.pendingAdminGrants).toBe(0);
    expect(snap.znsTemplates).toEqual([]);
    expect(sql.some((q) => q.includes('FROM "waste_points"'))).toBe(false);
    expect(tx.notificationTemplate.findMany).not.toHaveBeenCalled();
  });

  it('DB trống hẳn: mọi thứ về 0', async () => {
    const { prisma, tx } = fakePrisma({ tables: [] });
    const snap = await collectDbSnapshot(prisma, ['m1']);
    expect(snap).toMatchObject({ appliedMigrations: [], unfinishedMigrations: [], orderCount: 0, adminCount: 0, configs: {}, znsTemplates: [] });
    expect(tx.systemConfig.findMany).not.toHaveBeenCalled();
  });
});

describe('collectDbSnapshot: dữ liệu demo của migration', () => {
  const END = new Date('2026-12-31T17:00:00.000Z');
  const seedTerms = { type: 'AMOUNT', value: 30000, minOrder: 199000, maxDiscount: null, perUserLimit: 1, scope: 'PUBLIC' };

  it('có bảng products và coupons: đếm sản phẩm, biến thể đang bán, phân loại mã còn dùng được', async () => {
    const coupons = [
      { id: 'cmqfv2cpl0029zxplw4kcnaji', code: 'FREESHIP', type: 'FREESHIP', value: 0, minOrder: 99000, maxDiscount: null, perUserLimit: 3, scope: 'PUBLIC', endAt: END },
      { id: 'cuid-tu-seed', code: 'WELCOME30', ...seedTerms, endAt: END },
      { id: 'cuid-ma-that', code: 'XANH10', type: 'PERCENT', value: 15, minOrder: 250000, maxDiscount: 50000, perUserLimit: 2, scope: 'PUBLIC', endAt: END },
    ];
    const { prisma, tx } = fakePrisma({ tables: [...ALL_TABLES, 'products', 'coupons'], demo: { found: 44, active: 3, activeVariations: 5, coupons } });
    const snap = await collectDbSnapshot(prisma, ['m1']);
    expect(snap.demoData).toEqual({
      products: { found: 44, active: 3 },
      activeVariations: 5,
      liveCoupons: [
        { code: 'FREESHIP', endAt: END.toISOString(), kind: 'migration' },
        { code: 'WELCOME30', endAt: END.toISOString(), kind: 'seed' },
        { code: 'XANH10', endAt: END.toISOString(), kind: 'name-only' },
      ],
    });
    const where = (tx.coupon.findMany.mock.calls[0] as unknown as [{ where: Row }])[0].where;
    expect(where).toMatchObject({ code: { in: ['WELCOME30', 'FREESHIP', 'XANH10'] }, isActive: true });
    expect(where.endAt).toHaveProperty('gte');
  });

  it('đúng dòng migration (id khớp) là loại migration dù điều kiện đã bị sửa', async () => {
    const coupons = [{ id: 'cmqfuw9l0000gw1vf8f2wozy0', code: 'WELCOME30', ...seedTerms, value: 99, endAt: END }];
    const { prisma } = fakePrisma({ tables: [...ALL_TABLES, 'products', 'coupons'], demo: { found: 44, active: 44, activeVariations: 48, coupons } });
    expect((await collectDbSnapshot(prisma, ['m1'])).demoData?.liveCoupons).toEqual([{ code: 'WELCOME30', endAt: END.toISOString(), kind: 'migration' }]);
  });

  it('thiếu bảng products hoặc coupons: không có demoData, không truy vấn', async () => {
    for (const extra of [[], ['products'], ['coupons']]) {
      const { prisma, tx } = fakePrisma({ tables: [...ALL_TABLES, ...extra] });
      expect((await collectDbSnapshot(prisma, ['m1'])).demoData).toBeUndefined();
      expect(tx.product.count).not.toHaveBeenCalled();
      expect(tx.coupon.findMany).not.toHaveBeenCalled();
    }
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

describe('parseRemoteTypes', () => {
  it('hai cột và ba cột (có mô tả) đều ra đúng tên và loại', () => {
    expect(parseRemoteTypes('gdrive:  drive\ntubucrypt:  crypt  mã hoá bản backup\n\n')).toEqual({ gdrive: 'drive', tubucrypt: 'crypt' });
  });
});
