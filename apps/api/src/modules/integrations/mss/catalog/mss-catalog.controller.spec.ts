import { BadRequestException, ConflictException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../../../common/decorators/roles.decorator';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { MssHealthService } from '../mss-health.service';
import { MssInboundGuard } from '../mss-inbound.guard';
import { MssCatalogAdminController, MssCatalogDoorbellController, MssCatalogOpsService, parseDoorbell } from './mss-catalog.controller';
import type { MssCatalogQueue } from './mss-catalog.queue';
import type { MssCatalogService } from './mss-catalog.service';

describe('parseDoorbell (hợp đồng mục 1.3)', () => {
  it('đúng dạng: bỏ mã trùng, bỏ qua khoá lạ', () => {
    expect(parseDoorbell({ kind: 'product', ids: ['a1', 'b2', 'a1'], at: '2026-11-17T01:00:00+07:00', extra: { x: 1 } })).toEqual({ kind: 'product', ids: ['a1', 'b2'] });
  });

  it.each([
    ['không phải object', 'x'],
    ['mảng', []],
    ['loại lạ', { kind: 'order', ids: ['a'] }],
    ['ids rỗng', { kind: 'product', ids: [] }],
    ['quá 200 mã', { kind: 'product', ids: Array.from({ length: 201 }, (_, i) => `p${i}`) }],
    ['mã sai dạng', { kind: 'product', ids: ['../etc'] }],
    ['mã không phải chuỗi', { kind: 'product', ids: [1] }],
    ['at sai', { kind: 'product', ids: ['a'], at: 'hôm qua' }],
  ])('sai dạng: %s', (_label, body) => {
    expect(parseDoorbell(body)).toBeNull();
  });
});

describe('MssCatalogDoorbellController', () => {
  function setup(effective: boolean) {
    const ring = jest.fn(async (ids: readonly string[]) => ids.length);
    const ctrl = new MssCatalogDoorbellController(
      { effective: jest.fn(async () => effective) } as unknown as MssCatalogService,
      { ring } as unknown as MssCatalogQueue,
    );
    return { ctrl, ring };
  }

  it('chỉ nhận request đã ký (MssInboundGuard trên cả controller)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MssCatalogDoorbellController)).toContain(MssInboundGuard);
  });

  it('thân sai: 400, không xếp gì', async () => {
    const { ctrl, ring } = setup(true);
    await expect(ctrl.changed({ kind: 'product' })).rejects.toBeInstanceOf(BadRequestException);
    expect(ring).not.toHaveBeenCalled();
  });

  it('loại Tubu chưa dùng (danh mục, combo, tồn): 202 bỏ qua', async () => {
    const { ctrl, ring } = setup(true);
    expect(await ctrl.changed({ kind: 'stock', ids: ['a1'] })).toEqual({ ok: true, queued: 0, ignored: 'kind' });
    expect(ring).not.toHaveBeenCalled();
  });

  it('cờ chưa có hiệu lực: 202 bỏ qua, không chạm Redis', async () => {
    const { ctrl, ring } = setup(false);
    expect(await ctrl.changed({ kind: 'product', ids: ['a1'] })).toEqual({ ok: true, queued: 0, ignored: 'disabled' });
    expect(ring).not.toHaveBeenCalled();
  });

  it('cờ bật: xếp mã (đã bỏ trùng) vào lượt kéo', async () => {
    const { ctrl, ring } = setup(true);
    expect(await ctrl.changed({ kind: 'product', ids: ['a1', 'a1', 'b2'] })).toEqual({ ok: true, queued: 2 });
    expect(ring).toHaveBeenCalledWith(['a1', 'b2']);
  });
});

describe('MssCatalogOpsService', () => {
  function setup(effective: boolean) {
    const enqueue = jest.fn(async () => undefined);
    const prisma = {
      mssCatalogSyncState: {
        findUnique: jest.fn().mockResolvedValue({
          lastRunAt: new Date('2026-11-17T01:00:00Z'),
          lastFinishedAt: new Date('2026-11-17T01:00:05Z'),
          lastFullAt: null,
          watermark: new Date('2026-11-17T00:59:00Z'),
          lastStatus: 'ok',
          lastTrigger: 'cron',
          lastError: null,
          lastStats: { kind: 'incremental', pages: 1, received: 3, applied: 2, unchanged: 1, skipped: {}, trimmed: {} },
        }),
      },
      productMssEnrichment: {
        groupBy: jest.fn().mockResolvedValue([
          { state: 'published', _count: { _all: 5 } },
          { state: 'removed', _count: { _all: 1 } },
        ]),
      },
    } as unknown as PrismaService;
    const health = {
      opsCard: jest.fn().mockResolvedValue({ flags: [{ flag: 'catalogEnrichment', enabled: true, effective }] }),
    } as unknown as MssHealthService;
    const svc = new MssCatalogOpsService(
      prisma,
      health,
      { effective: jest.fn(async () => effective) } as unknown as MssCatalogService,
      { enqueue, pendingCount: jest.fn(async () => 4) } as unknown as MssCatalogQueue,
    );
    return { svc, enqueue };
  }

  it('thẻ Ops: trạng thái lượt cuối, đếm theo trạng thái, mã chờ', async () => {
    expect(await setup(true).svc.card()).toEqual({
      enabled: true,
      effective: true,
      lastRunAt: '2026-11-17T01:00:00.000Z',
      lastFinishedAt: '2026-11-17T01:00:05.000Z',
      lastFullAt: null,
      watermark: '2026-11-17T00:59:00.000Z',
      lastStatus: 'ok',
      lastTrigger: 'cron',
      lastError: null,
      lastStats: { kind: 'incremental', pages: 1, received: 3, applied: 2, unchanged: 1, skipped: {}, trimmed: {} },
      published: 5,
      unpublished: 0,
      removed: 1,
      pending: 4,
    });
  });

  it('Kéo lại ngay: cờ chưa có hiệu lực thì 409, không xếp', async () => {
    const { svc, enqueue } = setup(false);
    await expect(svc.pullNow('admin-1')).rejects.toBeInstanceOf(ConflictException);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('Kéo lại ngay: xếp một lượt toàn bộ', async () => {
    const { svc, enqueue } = setup(true);
    expect(await svc.pullNow('admin-1')).toEqual({ queued: true });
    expect(enqueue).toHaveBeenCalledWith('full', 'admin');
  });

  it('route admin chỉ cho ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, MssCatalogAdminController)).toEqual(['ADMIN']);
  });
});
