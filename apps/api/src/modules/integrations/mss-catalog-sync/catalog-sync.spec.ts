import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { ModuleRef } from '@nestjs/core';
import type { PrismaService } from '../../../prisma/prisma.service';
import { CatalogService } from '../../catalog/catalog.service';
import { HomeService } from '../../catalog/home.service';
import { RestockAlertsDispatcher } from '../../restock-alerts/restock-alerts.dispatcher';
import type { MssCatalogRunStats, MssCatalogService } from '../mss/catalog/mss-catalog.service';
import type { MssHealthService } from '../mss/mss-health.service';
import { MssInboundGuard } from '../mss/mss-inbound.guard';
import { CATALOG_SYNC_LIMITS, parseCatalogSyncBody, type CatalogSyncEnvelope, type CatalogSyncStockLine } from './catalog-sync-body';
import { applyMssStock, MSS_STOCK_MAX_AGE_MS, MSS_STOCK_MAX_SKEW_MS, type MssStockDb } from './catalog-sync-stock';
import { CatalogSyncController } from './catalog-sync.controller';
import { CatalogSyncService } from './catalog-sync.service';

const NOW = new Date('2026-11-18T09:00:00.000Z');
const at = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();

describe('parseCatalogSyncBody', () => {
  const ok = (body: unknown) => {
    const r = parseCatalogSyncBody(body);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };

  it('đọc vỏ, dòng tồn hợp lệ, đếm dòng hỏng, đếm combo; khoá lạ bỏ qua', () => {
    const v = ok({
      sync_id: 'sync-0001',
      sent_at: '2026-11-18T16:00:00+07:00',
      products: [{ pancake_product_id: 'a1' }],
      stock: [
        { pancake_variation_id: 'v1', stock: 0, as_of: at(1000) },
        { pancake_variation_id: 'v2', stock: -1, as_of: at(1000) },
        { pancake_variation_id: 'v3', stock: 1.5, as_of: at(1000) },
        { pancake_variation_id: 'v 4', stock: 2, as_of: at(1000) },
        { pancake_variation_id: 'v5', stock: 2, as_of: '18/11/2026' },
        { pancake_variation_id: 'v6', stock: CATALOG_SYNC_LIMITS.maxStock + 1, as_of: at(1000) },
        'rác',
      ],
      bundles: [{}, {}],
      something_new: true,
    });
    expect(v.syncId).toBe('sync-0001');
    expect(v.sentAt?.toISOString()).toBe('2026-11-18T09:00:00.000Z');
    expect(v.products).toHaveLength(1);
    expect(v.stock).toEqual([{ pancakeVariationId: 'v1', stock: 0, asOf: new Date(at(1000)) }]);
    expect(v.invalidStock).toBe(6);
    expect(v.bundles).toBe(2);
  });

  it('một biến thể nhiều dòng: giữ dòng đọc muộn nhất', () => {
    const v = ok({
      sync_id: 'sync-0002',
      stock: [
        { pancake_variation_id: 'v1', stock: 5, as_of: at(3000) },
        { pancake_variation_id: 'v1', stock: 0, as_of: at(1000) },
        { pancake_variation_id: 'v1', stock: 9, as_of: at(2000) },
      ],
    });
    expect(v.stock).toEqual([{ pancakeVariationId: 'v1', stock: 0, asOf: new Date(at(1000)) }]);
  });

  it.each([
    ['không phải object', null, 'invalid_body'],
    ['mảng', [], 'invalid_body'],
    ['thiếu sync_id', { stock: [] }, 'invalid_body'],
    ['sync_id sai dạng', { sync_id: 'ngắn', stock: [{}] }, 'invalid_body'],
    ['sent_at sai dạng', { sync_id: 'sync-0003', sent_at: 'hôm qua', stock: [{}] }, 'invalid_body'],
    ['products không phải mảng', { sync_id: 'sync-0003', products: {} }, 'invalid_body'],
    ['không có phần nào', { sync_id: 'sync-0003' }, 'empty'],
    ['mọi phần rỗng', { sync_id: 'sync-0003', products: [], stock: [], bundles: [] }, 'empty'],
    ['quá trần tài liệu', { sync_id: 'sync-0003', products: Array.from({ length: CATALOG_SYNC_LIMITS.products + 1 }, () => ({})) }, 'too_many_products'],
    ['quá trần dòng tồn', { sync_id: 'sync-0003', stock: Array.from({ length: CATALOG_SYNC_LIMITS.stock + 1 }, () => ({})) }, 'too_many_stock'],
  ])('%s → %s', (_label, body, error) => {
    expect(parseCatalogSyncBody(body)).toEqual({ ok: false, error });
  });
});

/** Biến thể giả trong DB: `pancakeStock` null = chưa có mốc (chỉ ghi mốc); `readAt` = mốc đọc đã áp, so như câu UPDATE thật. */
interface FakeVariation {
  id: string;
  pancakeId: string;
  stock: number;
  reserved: number;
  pancakeStock: number | null;
  readAt: Date | null;
  webhookAt: Date | null;
}

function stockDb(rows: FakeVariation[]): MssStockDb & { exec: jest.Mock } {
  const byPancake = (pid: string) => rows.find((r) => r.pancakeId === pid);
  // Thay câu UPDATE của applyPancakeStock kiểu `sync`: số tồn là tham số đầu, mã Pancake là chuỗi đầu, mốc đọc là Date đầu (trong Prisma.Sql lồng).
  const exec = jest.fn(async (_s: TemplateStringsArray, ...vals: unknown[]) => {
    const flat = vals.flatMap((v) => (v && typeof v === 'object' && 'values' in v ? (v as { values: unknown[] }).values : [v]));
    const n = flat[0] as number;
    const readAt = flat.find((v) => v instanceof Date) as Date;
    const pid = flat.find((v) => typeof v === 'string') as string;
    const row = byPancake(pid);
    if (!row) return 0;
    if (row.webhookAt && row.webhookAt > readAt) return 0;
    if (row.readAt && row.readAt > readAt) return 0;
    if (row.pancakeStock !== null) {
      row.reserved = Math.max(0, row.reserved - Math.max(0, row.pancakeStock - n));
      row.stock = Math.max(0, n - row.reserved);
    }
    row.pancakeStock = n;
    row.readAt = readAt;
    return 1;
  });
  const findMany = jest.fn(async ({ where }: { where: { pancakeId?: { in: string[] }; id?: { in: string[] } } }) =>
    rows
      .filter((r) => (where.pancakeId ? where.pancakeId.in.includes(r.pancakeId) : where.id!.in.includes(r.id)))
      .map((r) => ({ id: r.id, pancakeId: r.pancakeId, stock: r.stock })),
  );
  return { $executeRaw: exec, $queryRaw: jest.fn(), variation: { findMany }, exec } as unknown as MssStockDb & { exec: jest.Mock };
}

const row = (over: Partial<FakeVariation> & Pick<FakeVariation, 'id' | 'pancakeId'>): FakeVariation => ({
  stock: 3,
  reserved: 0,
  pancakeStock: 3,
  readAt: null,
  webhookAt: null,
  ...over,
});
const line = (pancakeVariationId: string, stock: number, msAgo = 1000): CatalogSyncStockLine => ({ pancakeVariationId, stock, asOf: new Date(NOW.getTime() - msAgo) });

describe('applyMssStock', () => {
  it('về 0: tồn Tubu về 0 ngay, báo biến thể vừa hết hàng; 0 → có hàng: báo vừa về hàng', async () => {
    const rows = [row({ id: 'tv1', pancakeId: 'v1', stock: 3 }), row({ id: 'tv2', pancakeId: 'v2', stock: 0, pancakeStock: 0 })];
    const res = await applyMssStock(stockDb(rows), [line('v1', 0), line('v2', 7)], NOW);
    expect(res).toEqual({ received: 2, applied: 2, skipped: {}, wentOut: ['tv1'], backIn: ['tv2'] });
    expect(rows.map((r) => r.stock)).toEqual([0, 7]);
  });

  it('giữ chỗ của đơn Tubu chưa phản ánh vẫn được trừ (cùng đường với đồng bộ Pancake)', async () => {
    const rows = [row({ id: 'tv1', pancakeId: 'v1', stock: 3, reserved: 2, pancakeStock: 5 })];
    await applyMssStock(stockDb(rows), [line('v1', 5)], NOW);
    expect(rows[0]).toMatchObject({ stock: 3, reserved: 2 });
  });

  it('gửi lại cùng lô: không đổi tồn, không báo hết/về hàng lần hai', async () => {
    const rows = [row({ id: 'tv1', pancakeId: 'v1', stock: 3 })];
    const db = stockDb(rows);
    const lines = [line('v1', 0)];
    expect((await applyMssStock(db, lines, NOW)).wentOut).toEqual(['tv1']);
    const again = await applyMssStock(db, lines, NOW);
    expect(again).toMatchObject({ applied: 1, wentOut: [], backIn: [] });
    expect(rows[0]!.stock).toBe(0);
  });

  it('số MSS đọc trước lượt đồng bộ/webhook Pancake đã áp: bỏ (stale), tồn không lùi', async () => {
    const rows = [
      row({ id: 'tv1', pancakeId: 'v1', stock: 4, readAt: new Date(NOW.getTime() - 500) }),
      row({ id: 'tv2', pancakeId: 'v2', stock: 4, webhookAt: new Date(NOW.getTime() - 500) }),
    ];
    const res = await applyMssStock(stockDb(rows), [line('v1', 0, 2000), line('v2', 0, 2000)], NOW);
    expect(res).toMatchObject({ applied: 0, skipped: { stale: 2 }, wentOut: [] });
    expect(rows.map((r) => r.stock)).toEqual([4, 4]);
  });

  it('biến thể lạ, số quá cũ, giờ MSS chạy trước quá 5 phút: bỏ và đếm, không chạy câu ghi', async () => {
    const db = stockDb([row({ id: 'tv1', pancakeId: 'v1' })]);
    const res = await applyMssStock(
      db,
      [line('nope', 1), line('v1', 1, MSS_STOCK_MAX_AGE_MS + 1), line('v1', 1, -(MSS_STOCK_MAX_SKEW_MS + 1))],
      NOW,
    );
    expect(res).toEqual({ received: 3, applied: 0, skipped: { unknown_variation: 1, too_old: 1, clock_skew: 1 }, wentOut: [], backIn: [] });
    expect(db.exec).not.toHaveBeenCalled();
  });

  it('as_of muộn hơn giờ nhận vài giây: kẹp mốc đọc về giờ nhận (không ghi mốc tương lai chặn đồng bộ Pancake)', async () => {
    const rows = [row({ id: 'tv1', pancakeId: 'v1' })];
    await applyMssStock(stockDb(rows), [line('v1', 2, -30_000)], NOW);
    expect(rows[0]!.readAt).toEqual(NOW);
  });

  it('biến thể chưa có mốc Pancake: chỉ ghi mốc, không đụng tồn (giống đồng bộ Pancake lần đầu)', async () => {
    const rows = [row({ id: 'tv1', pancakeId: 'v1', stock: 9, pancakeStock: null })];
    const res = await applyMssStock(stockDb(rows), [line('v1', 0)], NOW);
    expect(res).toMatchObject({ applied: 1, wentOut: [] });
    expect(rows[0]).toMatchObject({ stock: 9, pancakeStock: 0 });
  });
});

describe('CatalogSyncService', () => {
  const env = (over: Partial<CatalogSyncEnvelope> = {}): CatalogSyncEnvelope => ({
    syncId: 'sync-0001',
    sentAt: null,
    products: [],
    stock: [],
    invalidStock: 0,
    bundles: 0,
    ...over,
  });
  const pushStats = (over: Partial<MssCatalogRunStats> = {}): MssCatalogRunStats => ({
    kind: 'push',
    pages: 0,
    received: 1,
    applied: 1,
    unchanged: 0,
    skipped: {},
    trimmed: {},
    ecoProposed: 2,
    ecoKept: 1,
    ...over,
  });

  function setup(opts: { content?: boolean; stock?: boolean; rows?: FakeVariation[]; waiting?: number } = {}) {
    const rows = opts.rows ?? [row({ id: 'tv1', pancakeId: 'v1', stock: 3 }), row({ id: 'tv2', pancakeId: 'v2', stock: 0, pancakeStock: 0 })];
    const db = stockDb(rows);
    const stateUpsert = jest.fn().mockResolvedValue({});
    const alertCount = jest.fn().mockResolvedValue(opts.waiting ?? 0);
    const prisma = { ...db, mssCatalogSyncState: { upsert: stateUpsert }, restockAlert: { count: alertCount } } as unknown as PrismaService;
    const applyPushed = jest.fn(async () => pushStats());
    const catalog = { effective: jest.fn(async () => opts.content ?? false), applyPushed } as unknown as MssCatalogService;
    const health = { assertCapability: jest.fn(async () => opts.stock ?? false) } as unknown as MssHealthService;
    const invalidateCategoryCache = jest.fn();
    const invalidateStatic = jest.fn();
    const kick = jest.fn(async () => 1);
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === CatalogService) return { invalidateCategoryCache };
        if (token === HomeService) return { invalidateStatic };
        if (token === RestockAlertsDispatcher) return { kick };
        throw new Error('không có');
      }),
    } as unknown as ModuleRef;
    const svc = new CatalogSyncService(prisma, catalog, health, moduleRef);
    return { svc, rows, db, stateUpsert, alertCount, applyPushed, invalidateCategoryCache, invalidateStatic, kick, health };
  }
  const state = (f: ReturnType<typeof setup>) => f.stateUpsert.mock.calls.at(-1)![0].update;

  it('mặc định PROD (hai cờ tắt): 200 với status disabled từng phần, không ghi nội dung, tồn, không xoá đệm, không gọi báo hàng về', async () => {
    const f = setup();
    const reply = await f.svc.receive(env({ products: [{}, {}], stock: [line('v1', 0)], invalidStock: 1, bundles: 1 }), NOW);
    expect(reply).toMatchObject({
      ok: true,
      sync_id: 'sync-0001',
      products: { status: 'disabled', received: 2, applied: 0 },
      stock: { status: 'disabled', received: 2, invalid: 1, applied: 0 },
      deferred: { bundles: 1 },
    });
    expect(f.applyPushed).not.toHaveBeenCalled();
    expect(f.db.exec).not.toHaveBeenCalled();
    expect(f.rows[0]!.stock).toBe(3);
    expect(f.invalidateCategoryCache).not.toHaveBeenCalled();
    expect(f.kick).not.toHaveBeenCalled();
    expect(state(f)).toMatchObject({ lastStatus: 'skipped', lastTrigger: 'push', lastError: null });
  });

  it('cờ tồn bật: hết hàng và về hàng phản ánh ngay, xoá bộ đệm danh sách/Trang chủ, khách đang chờ thì gọi sớm lượt báo hàng về', async () => {
    const f = setup({ stock: true, waiting: 3 });
    const reply = await f.svc.receive(env({ stock: [line('v1', 0), line('v2', 5)] }), NOW);
    expect(reply.stock).toEqual({
      status: 'applied',
      received: 2,
      applied: 2,
      invalid: 0,
      skipped: {},
      out_of_stock: 1,
      back_in_stock: 1,
      restock_waiting: 3,
    });
    expect(f.rows.map((r) => r.stock)).toEqual([0, 5]);
    expect(f.health.assertCapability).toHaveBeenCalledWith('stockSync');
    expect(f.alertCount).toHaveBeenCalledWith({ where: { variationId: { in: ['tv2'] }, notifiedAt: null } });
    expect(f.invalidateCategoryCache).toHaveBeenCalledTimes(1);
    expect(f.invalidateStatic).toHaveBeenCalledTimes(1);
    expect(f.kick).toHaveBeenCalledTimes(1);
    expect(state(f)).toMatchObject({ lastStatus: 'ok', lastStats: expect.objectContaining({ syncId: 'sync-0001' }) });
  });

  it('về hàng mà không ai chờ: không gọi lượt báo; không biến thể nào đổi trạng thái: không xoá bộ đệm', async () => {
    const f = setup({ stock: true, waiting: 0 });
    await f.svc.receive(env({ stock: [line('v2', 5)] }), NOW);
    expect(f.kick).not.toHaveBeenCalled();
    const g = setup({ stock: true });
    await g.svc.receive(env({ stock: [line('v1', 2)] }), NOW);
    expect(g.invalidateCategoryCache).not.toHaveBeenCalled();
    expect(g.alertCount).not.toHaveBeenCalled();
  });

  it('gửi lại cùng lô (MSS thử lại): kết quả không đổi tồn, không báo hết/về hàng lần hai', async () => {
    const f = setup({ stock: true, waiting: 1 });
    const e = env({ stock: [line('v1', 0), line('v2', 5)] });
    await f.svc.receive(e, NOW);
    const again = await f.svc.receive(e, NOW);
    expect(again.stock).toMatchObject({ applied: 2, out_of_stock: 0, back_in_stock: 0, restock_waiting: 0 });
    expect(f.rows.map((r) => r.stock)).toEqual([0, 5]);
    expect(f.kick).toHaveBeenCalledTimes(1);
  });

  it('chỉ cờ nội dung bật: ghép tài liệu, trả số đếm (cả nhãn xanh nháp); phần tồn disabled; trạng thái partial', async () => {
    const f = setup({ content: true });
    const reply = await f.svc.receive(env({ products: [{ pancake_product_id: 'a1' }], stock: [line('v1', 0)] }), NOW);
    expect(f.applyPushed).toHaveBeenCalledWith([{ pancake_product_id: 'a1' }]);
    expect(reply.products).toEqual({ status: 'applied', received: 1, applied: 1, unchanged: 0, skipped: {}, trimmed: {}, eco_proposed: 2, eco_kept: 1 });
    expect(reply.stock.status).toBe('disabled');
    expect(f.rows[0]!.stock).toBe(3);
    expect(state(f).lastStatus).toBe('partial');
  });

  it('lô chỉ có tồn: không hỏi cờ nội dung; lô chỉ có nội dung: không hỏi cờ tồn', async () => {
    const f = setup({ stock: true });
    await f.svc.receive(env({ stock: [line('v1', 1)] }), NOW);
    expect(f.applyPushed).not.toHaveBeenCalled();
    const g = setup({ content: true });
    await g.svc.receive(env({ products: [{}] }), NOW);
    expect(g.health.assertCapability).not.toHaveBeenCalled();
  });

  it('DB lỗi giữa chừng: ném để MSS gửi lại (lặp lại an toàn), trạng thái ghi failed kèm lỗi', async () => {
    const f = setup({ stock: true });
    f.db.exec.mockRejectedValueOnce(new Error('deadlock detected'));
    await expect(f.svc.receive(env({ stock: [line('v1', 0)] }), NOW)).rejects.toThrow('deadlock detected');
    expect(state(f)).toMatchObject({ lastStatus: 'failed', lastError: 'deadlock detected' });
  });

  it('ghi dòng trạng thái lỗi: không làm hỏng trả lời cho MSS', async () => {
    const f = setup({ stock: true });
    f.stateUpsert.mockRejectedValueOnce(new Error('db down'));
    await expect(f.svc.receive(env({ stock: [line('v1', 1)] }), NOW)).resolves.toMatchObject({ ok: true });
  });

  it('lượt báo hàng về sớm lỗi: chỉ ghi log, trả lời MSS vẫn 200 (cron mỗi phút gửi bù)', async () => {
    const f = setup({ stock: true, waiting: 1 });
    f.kick.mockRejectedValueOnce(new Error('redis'));
    await expect(f.svc.receive(env({ stock: [line('v2', 3)] }), NOW)).resolves.toMatchObject({ stock: { restock_waiting: 1 } });
  });
});

describe('CatalogSyncController', () => {
  it('đi sau MssInboundGuard, hai đường /integrations/mss và /internal/mss, POST catalog-sync trả 200', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, CatalogSyncController)).toContain(MssInboundGuard);
    expect(Reflect.getMetadata(PATH_METADATA, CatalogSyncController)).toEqual(['integrations/mss', 'internal/mss']);
    const handler = CatalogSyncController.prototype.receive;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('catalog-sync');
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
  });

  it('thân sai: 400 kèm mã lỗi, không gọi service', async () => {
    const receive = jest.fn();
    const ctrl = new CatalogSyncController({ receive } as unknown as CatalogSyncService);
    await expect(ctrl.receive({ sync_id: 'sync-0001' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.receive({ sync_id: 'sync-0001' })).rejects.toMatchObject({ response: { error: 'empty' } });
    expect(receive).not.toHaveBeenCalled();
  });

  it('thân đúng: chuyển phong bì đã đọc cho service', async () => {
    const receive = jest.fn(async () => ({ ok: true }));
    const ctrl = new CatalogSyncController({ receive } as unknown as CatalogSyncService);
    await ctrl.receive({ sync_id: 'sync-0001', stock: [{ pancake_variation_id: 'v1', stock: 0, as_of: '2026-11-18T09:00:00Z' }] });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ syncId: 'sync-0001', stock: [expect.objectContaining({ pancakeVariationId: 'v1', stock: 0 })] }));
  });
});
