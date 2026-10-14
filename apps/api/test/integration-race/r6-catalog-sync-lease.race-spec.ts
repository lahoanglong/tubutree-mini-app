import { PrismaService } from '../../src/prisma/prisma.service';
import {
  CATALOG_SYNC_LEASE,
  CATALOG_SYNC_RUNNING,
  CatalogSyncBusyError,
  PancakeSyncService,
} from '../../src/modules/integrations/pancake/pancake-sync.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { LifecycleService } from '../../src/modules/lifecycle/lifecycle.service';
import { CATALOG_STATE_KEY } from '../../src/modules/ops/ops-state';
import { warmPool } from './helpers';

/**
 * R4-SYNC-6 trên Postgres THẬT: nhiều replica (mỗi replica một PancakeSyncService, chung DB) cùng bấm/cùng tới mốc đồng bộ danh
 * mục → đúng một lượt chạy, các lượt kia nhận 409 CATALOG_SYNC_RUNNING (không còn 201 {synced:0}); xong lượt thì khoá được nhả;
 * replica chết giữa lượt thì khoá chỉ chặn tới khi hết hạn. Pancake là stub (không gọi API thật), danh mục rỗng để không đụng
 * sản phẩm trong DB.
 */
describe('Đồng bộ danh mục Pancake: một lượt một lúc trên cả cụm (real Postgres)', () => {
  let prisma: PrismaService;
  let savedCatalogState: Awaited<ReturnType<PrismaService['opsHealthState']['findUnique']>>;
  const since = '2026-10-14T00:00:00.000Z';
  const lifecycle = { notifyWishlistPriceDrop: jest.fn() } as unknown as LifecycleService;

  /** Replica có Pancake chậm: lấy trang thì chờ cổng mở, rồi trả danh mục rỗng. */
  function replica(opts: { gate?: Promise<void> } = {}) {
    const fetchProducts = jest.fn(async () => {
      await opts.gate;
      return { success: true, data: [], total_pages: 0, total_entries: 0 };
    });
    const client = { isConfigured: () => true, fetchProducts } as unknown as PancakeClient;
    return { svc: new PancakeSyncService(prisma, client, lifecycle), fetchProducts };
  }

  const gate = () => {
    let open!: () => void;
    const p = new Promise<void>((r) => (open = r));
    return { p, open };
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    savedCatalogState = await prisma.opsHealthState.findUnique({ where: { key: CATALOG_STATE_KEY } });
  });

  afterAll(async () => {
    await prisma.cronLease.deleteMany({ where: { name: CATALOG_SYNC_LEASE } });
    await prisma.opsHealthState.deleteMany({ where: { key: CATALOG_STATE_KEY } });
    if (savedCatalogState) {
      const { key, detail, ...rest } = savedCatalogState;
      await prisma.opsHealthState.create({ data: { key, ...rest, detail: detail ?? undefined } });
    }
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma.cronLease.deleteMany({ where: { name: CATALOG_SYNC_LEASE } });
  });

  it('5 replica bấm cùng lúc → đúng 1 lượt chạy, 4 lượt 409 CATALOG_SYNC_RUNNING; xong lượt thì replica khác chạy được ngay', async () => {
    const g = gate();
    const all = Array.from({ length: 5 }, () => replica({ gate: g.p }));
    const runs = Promise.allSettled(all.map((r) => r.svc.syncProducts(since)));
    await new Promise((r) => setTimeout(r, 300));
    expect(all.filter((r) => r.fetchProducts.mock.calls.length > 0)).toHaveLength(1);

    g.open();
    const results = await runs;
    const ok = results.filter((r) => r.status === 'fulfilled');
    const busy = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(busy).toHaveLength(4);
    for (const b of busy) {
      expect(b.reason).toBeInstanceOf(CatalogSyncBusyError);
      expect(b.reason.getStatus()).toBe(409);
      expect(b.reason.getResponse()).toMatchObject({ code: CATALOG_SYNC_RUNNING });
    }
    expect(all.filter((r) => r.fetchProducts.mock.calls.length > 0)).toHaveLength(1);

    const row = await prisma.cronLease.findUniqueOrThrow({ where: { name: CATALOG_SYNC_LEASE } });
    const [{ now }] = await prisma.$queryRaw<{ now: Date }[]>`SELECT (now() AT TIME ZONE 'UTC') AS now`;
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(now.getTime());

    const loser = all.find((r) => r.fetchProducts.mock.calls.length === 0)!;
    await expect(loser.svc.syncProducts(since)).resolves.toBe(0);
  });

  it('replica đang chạy thì bấm ở replica khác giữa lượt → 409 ngay, lượt đang chạy không bị ảnh hưởng', async () => {
    const g = gate();
    const a = replica({ gate: g.p });
    const b = replica();
    const running = a.svc.syncProducts(since);
    await new Promise((r) => setTimeout(r, 200));
    await expect(b.svc.syncProducts(since)).rejects.toBeInstanceOf(CatalogSyncBusyError);
    expect(b.fetchProducts).not.toHaveBeenCalled();
    g.open();
    await expect(running).resolves.toBe(0);
  });

  it('replica chết giữa lượt (không nhả khoá) → chặn tới khi khoá hết hạn, hết hạn thì replica khác nhận', async () => {
    await prisma.$executeRaw`
      INSERT INTO cron_leases (name, holder, "expiresAt", "updatedAt")
      VALUES (${CATALOG_SYNC_LEASE}, 'dead-replica', (now() AT TIME ZONE 'UTC') + interval '5 minutes', (now() AT TIME ZONE 'UTC'))`;
    const b = replica();
    await expect(b.svc.syncProducts(since)).rejects.toBeInstanceOf(CatalogSyncBusyError);

    await prisma.cronLease.update({ where: { name: CATALOG_SYNC_LEASE }, data: { expiresAt: new Date(Date.now() - 60 * 60_000) } });
    await expect(b.svc.syncProducts(since)).resolves.toBe(0);
    expect(b.fetchProducts).toHaveBeenCalled();
  });

  it('khoá bị lượt khác nhận giữa chừng (lượt này chạy quá hạn) → dừng trước trang kế, không quét tiếp', async () => {
    let served = 0;
    const fetchProducts = jest.fn(async (page: number) => {
      served++;
      if (page === 1) {
        await prisma.cronLease.update({
          where: { name: CATALOG_SYNC_LEASE },
          data: { holder: 'other-replica', expiresAt: new Date(Date.now() + 10 * 60_000) },
        });
      }
      return { success: true, data: [{ id: `it-r6-${page}`, name: 'x', variations: [] }], total_pages: 3, total_entries: 3 };
    });
    const svc = new PancakeSyncService(prisma, { isConfigured: () => true, fetchProducts } as unknown as PancakeClient, lifecycle);
    const upsertProduct = jest.spyOn(svc as unknown as { upsertProduct: () => Promise<void> }, 'upsertProduct').mockResolvedValue();
    await expect(svc.syncProducts(since)).rejects.toThrow(/khoá đồng bộ đã sang một lượt khác/);
    expect(served).toBe(1);
    expect(upsertProduct).toHaveBeenCalledTimes(1);
    const row = await prisma.cronLease.findUniqueOrThrow({ where: { name: CATALOG_SYNC_LEASE } });
    expect(row.holder).toBe('other-replica');
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
