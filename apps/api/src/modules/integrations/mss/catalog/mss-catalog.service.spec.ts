import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleRef } from '@nestjs/core';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { ImageRegistryStale } from '../../../catalog/image-registry-stale';
import { EMPTY_MSS_PAYLOAD } from '../../../catalog/mss-enrichment';
import { MssRequestError, type MssClient } from '../mss.client';
import type { MssHealthService } from '../mss-health.service';
import { enrichmentColumns, isNewerDoc, MSS_CATALOG_MAX_PAGES, MssCatalogService, parseListPage } from './mss-catalog.service';

const HOST = 'mss.example.test';
const media = (h: string, ext = 'webp') => `https://${HOST}/api/pub/media/${h}.${ext}`;

function doc(pid: string, over: Record<string, unknown> = {}, enrichment: Record<string, unknown> = {}) {
  return {
    pancake_product_id: pid,
    mss_product_id: `m-${pid}`,
    state: 'published',
    published_version: 3,
    updated_at: '2026-11-17T01:00:00Z',
    enrichment: { title: `Tựa ${pid}`, images: [{ url: media(`${pid}cover01`), alt: null, w: null, h: null, variation_id: null }], ...enrichment },
    ...over,
  };
}

interface Fake {
  svc: MssCatalogService;
  request: jest.Mock;
  stateUpsert: jest.Mock;
  stateFind: jest.Mock;
  productFind: jest.Mock;
  enrichFind: jest.Mock;
  exec: jest.Mock;
  markStale: jest.Mock;
  invalidateCategoryCache: jest.Mock;
}

function setup(opts: { on?: boolean; responses?: ((path: string) => unknown)[]; watermark?: Date | null; products?: { id: string; pancakeId: string }[]; existing?: unknown[]; written?: number } = {}): Fake {
  const responses = [...(opts.responses ?? [])];
  const request = jest.fn(async (_m: string, path: string) => {
    const next = responses.shift();
    if (!next) throw new Error(`không có phản hồi cho ${path}`);
    return { status: 200, data: next(path), durationMs: 1 };
  });
  const stateUpsert = jest.fn().mockResolvedValue({});
  const stateFind = jest.fn().mockResolvedValue({ watermark: opts.watermark ?? null });
  const productFind = jest.fn(async ({ where }: { where: { pancakeId: { in: string[] } } }) =>
    (opts.products ?? [{ id: 'p-a', pancakeId: 'a1' }, { id: 'p-b', pancakeId: 'b2' }]).filter((p) => where.pancakeId.in.includes(p.pancakeId)),
  );
  const enrichFind = jest.fn().mockResolvedValue(opts.existing ?? []);
  const exec = jest.fn().mockResolvedValue(opts.written ?? 1);
  const prisma = {
    mssCatalogSyncState: { upsert: stateUpsert, findUnique: stateFind },
    category: { findMany: jest.fn().mockResolvedValue([{ id: 'cat-1', slug: 'Tay-Rua' }, { id: 'cat-2', slug: 'giat' }]) },
    product: { findMany: productFind },
    productMssEnrichment: { findMany: enrichFind },
    $executeRaw: exec,
  } as unknown as PrismaService;
  const health = { assertCapability: jest.fn(async () => opts.on ?? true) } as unknown as MssHealthService;
  const markStale = jest.fn();
  const invalidateCategoryCache = jest.fn();
  const moduleRef = { get: jest.fn(() => ({ invalidateCategoryCache })) } as unknown as ModuleRef;
  const svc = new MssCatalogService(prisma, { request } as unknown as MssClient, health, { markStale } as unknown as ImageRegistryStale, moduleRef);
  return { svc, request, stateUpsert, stateFind, productFind, enrichFind, exec, markStale, invalidateCategoryCache };
}

/** Tham số của câu upsert (tagged template): [strings, productId, pancakeId, mssId, state, payloadJson, version, updatedAt, sha, title, imagesOverride, coverImage, categoryOverride, categoryIds, mediaUrls]. */
const upsertArgs = (exec: jest.Mock, i = 0) => {
  const a = exec.mock.calls[i] as unknown[];
  return { productId: a[1], state: a[4], payload: JSON.parse(a[5] as string), version: a[6], title: a[9], categoryOverride: a[12], categoryIds: a[13], mediaUrls: a[14] };
};
const finalState = (f: Fake) => f.stateUpsert.mock.calls.at(-1)![0].update;

const OLD_ENV = process.env.MSS_BASE_URL;
beforeAll(() => {
  process.env.MSS_BASE_URL = `https://${HOST}`;
});
afterAll(() => {
  process.env.MSS_BASE_URL = OLD_ENV;
});

describe('MssCatalogService.run', () => {
  it('cờ chưa có hiệu lực: không gọi MSS, không ghi DB', async () => {
    const f = setup({ on: false });
    expect(await f.svc.run('incremental', 'cron')).toMatchObject({ status: 'skipped', error: 'disabled' });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.stateUpsert).not.toHaveBeenCalled();
    expect(f.exec).not.toHaveBeenCalled();
  });

  it('theo mốc: hỏi từ mốc trừ 60 giây, lật trang theo cursor, mốc mới = server_time trang đầu; bỏ và đếm sản phẩm lạ, tài liệu hỏng', async () => {
    const f = setup({
      watermark: new Date('2026-11-17T00:00:00Z'),
      responses: [
        () => ({ items: [doc('a1'), doc('zz-unknown'), { pancake_product_id: 'b2', state: 'weird' }], next_cursor: 'c2', server_time: '2026-11-17T02:00:00Z' }),
        () => ({ items: [doc('b2')], next_cursor: null, server_time: '2026-11-17T02:00:05Z' }),
      ],
    });
    const res = await f.svc.run('incremental', 'cron');
    expect(res).toEqual({
      status: 'ok',
      error: null,
      stats: { kind: 'incremental', pages: 2, received: 4, applied: 2, unchanged: 0, skipped: { unknown_product: 1, invalid_doc: 1 }, trimmed: {} },
    });
    const [p1, p2] = f.request.mock.calls.map((c) => new URL(`https://x${c[1]}`)) as [URL, URL];
    expect(p1.pathname).toBe('/catalog/products');
    expect(Object.fromEntries(p1.searchParams)).toEqual({ limit: '200', updated_after: '2026-11-16T23:59:00.000Z' });
    expect(p2.searchParams.get('cursor')).toBe('c2');
    expect(finalState(f)).toMatchObject({ lastStatus: 'ok', lastTrigger: 'cron', watermark: new Date('2026-11-17T02:00:00Z'), lastError: null });
    expect(finalState(f).lastFullAt).toBeUndefined();
    expect(upsertArgs(f.exec, 0)).toMatchObject({ productId: 'p-a', state: 'published', version: 3, title: 'Tựa a1', mediaUrls: [media('a1cover01')] });
    expect(f.markStale).toHaveBeenCalledTimes(1);
    expect(f.invalidateCategoryCache).toHaveBeenCalledTimes(1);
  });

  it('chưa có mốc / kéo toàn bộ: không gửi updated_after; toàn bộ xong thì ghi lastFullAt', async () => {
    const f = setup({ watermark: new Date('2026-11-17T00:00:00Z'), responses: [() => ({ items: [], next_cursor: null, server_time: '2026-11-17T02:00:00Z' })] });
    await f.svc.run('full', 'full');
    expect(f.request.mock.calls[0][1]).toBe('/catalog/products?limit=200');
    expect(f.stateFind).not.toHaveBeenCalled();
    expect(finalState(f).lastFullAt).toBeInstanceOf(Date);
    // Không ghi gì thì không xoá bộ đệm.
    expect(f.markStale).not.toHaveBeenCalled();
  });

  it('MSS lỗi giữa chừng: phần đã nhận vẫn ghi, mốc giữ nguyên để lượt sau hỏi lại', async () => {
    const f = setup({
      responses: [
        () => ({ items: [doc('a1')], next_cursor: 'c2', server_time: '2026-11-17T02:00:00Z' }),
        () => {
          throw new MssRequestError('server_error', 'MSS lỗi máy chủ', { status: 500 });
        },
      ],
    });
    const res = await f.svc.run('incremental', 'cron');
    expect(res).toMatchObject({ status: 'partial', error: 'server_error HTTP 500', stats: { applied: 1, pages: 1 } });
    expect(finalState(f).watermark).toBeUndefined();
    expect(finalState(f)).toMatchObject({ lastStatus: 'partial', lastError: 'server_error HTTP 500' });
  });

  it('trang sai dạng: cả lượt hỏng, không đoán', async () => {
    const f = setup({ responses: [() => ({ data: [] })] });
    expect(await f.svc.run('incremental', 'cron')).toMatchObject({ status: 'failed', error: 'invalid_response HTTP 200' });
    expect(f.exec).not.toHaveBeenCalled();
  });

  it(`MSS trả cursor mãi: dừng ở ${MSS_CATALOG_MAX_PAGES} trang, không tiến mốc`, async () => {
    const f = setup({ responses: Array.from({ length: MSS_CATALOG_MAX_PAGES + 5 }, () => () => ({ items: [], next_cursor: 'again', server_time: '2026-11-17T02:00:00Z' })) });
    const res = await f.svc.run('incremental', 'cron');
    expect(f.request).toHaveBeenCalledTimes(MSS_CATALOG_MAX_PAGES);
    expect(res.status).toBe('failed');
    expect(res.error).toContain(`${MSS_CATALOG_MAX_PAGES} trang`);
    expect(finalState(f).watermark).toBeUndefined();
  });

  it('theo mã (chuông): hỏi từng mã, 404 đếm not_found, mã sai dạng bỏ không gọi', async () => {
    const f = setup({
      responses: [
        () => doc('a1'),
        () => {
          throw new MssRequestError('client_error', 'MSS từ chối yêu cầu', { status: 404 });
        },
      ],
    });
    const res = await f.svc.run('ids', 'doorbell', ['a1', 'gone', '../x']);
    expect(f.request.mock.calls.map((c) => c[1])).toEqual(['/catalog/products/a1', '/catalog/products/gone']);
    expect(res).toMatchObject({ status: 'ok', stats: { kind: 'ids', received: 1, applied: 1, skipped: { not_found: 1 } } });
    expect(f.stateFind).not.toHaveBeenCalled();
    expect(finalState(f).watermark).toBeUndefined();
  });
});

describe('MssCatalogService.applyDocs: không lùi phiên bản, không ghi lại bản trùng', () => {
  const stats = () => ({ kind: 'ids' as const, pages: 0, received: 0, applied: 0, unchanged: 0, skipped: {}, trimmed: {} });
  const ctx = { mediaHosts: [HOST], categories: new Map([['tay-rua', 'cat-1'], ['giat', 'cat-2']]) };

  it('bản đang lưu có phiên bản cao hơn, hoặc cùng phiên bản mà mới hơn: bỏ stale_version, không chạy câu ghi', async () => {
    const f = setup({
      existing: [
        { productId: 'p-a', contentVersion: 4, mssUpdatedAt: new Date('2026-11-17T00:00:00Z'), sha256: 'x' },
        { productId: 'p-b', contentVersion: 3, mssUpdatedAt: new Date('2026-11-17T05:00:00Z'), sha256: 'x' },
      ],
    });
    const s = stats();
    await f.svc.applyDocs([doc('a1'), doc('b2')], s, ctx);
    expect(s).toMatchObject({ applied: 0, skipped: { stale_version: 2 } });
    expect(f.exec).not.toHaveBeenCalled();
  });

  it('cùng phiên bản, cùng giờ, cùng nội dung: unchanged; câu ghi trả 0 dòng (thua đua với tiến trình khác): stale_version', async () => {
    const probe = setup();
    await probe.svc.applyDocs([doc('a1')], stats(), ctx);
    const sha = (probe.exec.mock.calls[0] as unknown[])[8];
    const same = setup({ existing: [{ productId: 'p-a', contentVersion: 3, mssUpdatedAt: new Date('2026-11-17T01:00:00Z'), sha256: sha }] });
    const s1 = stats();
    await same.svc.applyDocs([doc('a1')], s1, ctx);
    expect(s1).toMatchObject({ unchanged: 1, applied: 0 });
    expect(same.exec).not.toHaveBeenCalled();

    const lost = setup({ written: 0 });
    const s2 = stats();
    await lost.svc.applyDocs([doc('a1')], s2, ctx);
    expect(s2).toMatchObject({ applied: 0, skipped: { stale_version: 1 } });
  });

  it('gỡ xuất bản không mang published_version (đọc thành 0): thắng bản xuất bản v7 khi updated_at mới hơn, thua khi cũ hơn', async () => {
    const stored = [{ productId: 'p-a', contentVersion: 7, mssUpdatedAt: new Date('2026-11-17T01:00:00Z'), sha256: 'x' }];
    const later = setup({ existing: stored });
    const s1 = stats();
    await later.svc.applyDocs([doc('a1', { state: 'unpublished', published_version: null, updated_at: '2026-11-17T02:00:00Z' })], s1, ctx);
    expect(s1).toMatchObject({ applied: 1, skipped: {} });
    expect(upsertArgs(later.exec)).toMatchObject({ state: 'unpublished', version: 0, mediaUrls: [] });

    const earlier = setup({ existing: stored });
    const s2 = stats();
    await earlier.svc.applyDocs([doc('a1', { state: 'removed', published_version: null, updated_at: '2026-11-17T00:30:00Z' })], s2, ctx);
    expect(s2).toMatchObject({ applied: 0, skipped: { stale_version: 1 } });
  });

  it('isNewerDoc: luật mới hơn cho bản xuất bản và bản gỡ', () => {
    // published: phiên bản trước, giờ sau
    expect(isNewerDoc('published', 8, 1, 7, 9)).toBe(true);
    expect(isNewerDoc('published', 7, 10, 7, 9)).toBe(true);
    expect(isNewerDoc('published', 7, 9, 7, 9)).toBe(false);
    expect(isNewerDoc('published', 6, 99, 7, 9)).toBe(false);
    // gỡ: giờ quyết định (phiên bản 0 khi MSS không gửi), phiên bản lớn hơn vẫn thắng
    expect(isNewerDoc('unpublished', 0, 10, 7, 9)).toBe(true);
    expect(isNewerDoc('removed', 0, 8, 7, 9)).toBe(false);
    expect(isNewerDoc('unpublished', 8, 8, 7, 9)).toBe(true);
  });

  it('cùng một lô có hai bản của một sản phẩm: bản sau cũ hơn bị chặn bởi bản vừa ghi', async () => {
    const f = setup();
    const s = stats();
    await f.svc.applyDocs([doc('a1', { published_version: 7 }), doc('a1', { published_version: 6 })], s, ctx);
    expect(s).toMatchObject({ applied: 1, skipped: { stale_version: 1 } });
    expect(f.exec).toHaveBeenCalledTimes(1);
    expect(upsertArgs(f.exec).version).toBe(7);
  });

  it('danh mục: slug biết thì đổi sang id; slug lạ bỏ và đếm; gửi slug mà không slug nào có ở Tubu thì giữ danh mục Tubu', async () => {
    const f = setup();
    const s = stats();
    await f.svc.applyDocs([doc('a1', {}, { category_slugs: ['tay-rua', 'khong-co'] }), doc('b2', {}, { category_slugs: ['khong-co'] })], s, ctx);
    expect(upsertArgs(f.exec, 0)).toMatchObject({ categoryOverride: true, categoryIds: ['cat-1'], payload: expect.objectContaining({ categoryIds: ['cat-1'] }) });
    expect(upsertArgs(f.exec, 1)).toMatchObject({ categoryOverride: false, categoryIds: [], payload: expect.objectContaining({ categoryIds: null }) });
    expect(s.trimmed).toEqual({ unknown_category_slug: 2 });
  });

  it('ghi lỗi một dòng: đếm apply_failed, các dòng khác vẫn ghi', async () => {
    const f = setup();
    f.exec.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValueOnce(1);
    const s = stats();
    await f.svc.applyDocs([doc('a1'), doc('b2')], s, ctx);
    expect(s).toMatchObject({ applied: 1, skipped: { apply_failed: 1 } });
  });

  it('URL media ngoài host bị gọt và đếm, phần còn lại vẫn ghi', async () => {
    const f = setup();
    const s = stats();
    const images = [
      { url: 'https://evil.test/api/pub/media/aaaaaaaa11.webp', alt: null, w: null, h: null, variation_id: null },
      { url: media('okokokok11'), alt: null, w: null, h: null, variation_id: null },
    ];
    await f.svc.applyDocs([doc('a1', {}, { images })], s, ctx);
    expect(s.trimmed).toEqual({ media_rejected: 1 });
    expect(upsertArgs(f.exec).mediaUrls).toEqual([media('okokokok11')]);
  });
});

describe('enrichmentColumns', () => {
  const payload = {
    ...EMPTY_MSS_PAYLOAD,
    title: 'T',
    images: [
      { url: media('variant001'), alt: null, w: null, h: null, variationId: 'v1' },
      { url: media('general001'), alt: null, w: null, h: null, variationId: null },
    ],
    videos: [{ url: media('video00001', 'mp4'), posterUrl: media('poster0001'), durationS: 3 }],
    categoryIds: ['c'],
  };

  it('đã xuất bản: ảnh đại diện là ảnh chung đầu; danh sách /img gồm ảnh, video, poster', () => {
    expect(enrichmentColumns('published', payload)).toEqual({
      title: 'T',
      imagesOverride: true,
      coverImage: media('general001'),
      categoryOverride: true,
      categoryIds: ['c'],
      mediaUrls: [media('general001'), media('variant001'), media('video00001', 'mp4'), media('poster0001')],
    });
  });

  it('chưa xuất bản / đã gỡ: không đưa URL nào vào danh sách /img', () => {
    expect(enrichmentColumns('unpublished', payload).mediaUrls).toEqual([]);
    expect(enrichmentColumns('removed', payload).mediaUrls).toEqual([]);
  });

  it('không có ý kiến về ảnh/danh mục: không thay', () => {
    expect(enrichmentColumns('published', EMPTY_MSS_PAYLOAD)).toEqual({ title: null, imagesOverride: false, coverImage: null, categoryOverride: false, categoryIds: [], mediaUrls: [] });
  });
});

describe('đồng bộ Pancake không đụng nội dung MSS', () => {
  it('không file nào trong modules/integrations/pancake nhắc tới bảng hay model nội dung bổ sung', () => {
    const dir = join(__dirname, '..', '..', 'pancake');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect({ f, hit: /productMssEnrichment|product_mss_enrichment|mssCatalogSyncState/.test(readFileSync(join(dir, f), 'utf8')) }).toEqual({ f, hit: false });
    }
  });
});

describe('parseListPage', () => {
  it.each([
    [null],
    [[]],
    [{ items: {}, server_time: '2026-11-17T00:00:00Z' }],
    [{ items: [], server_time: 'hôm qua' }],
    [{ items: [], next_cursor: 5, server_time: '2026-11-17T00:00:00Z' }],
    [{ items: [], next_cursor: 'a b', server_time: '2026-11-17T00:00:00Z' }],
  ])('sai dạng: %j', (json) => {
    expect(parseListPage(json)).toBeNull();
  });

  it('đúng dạng', () => {
    expect(parseListPage({ items: [1], next_cursor: 'eyJpZCI6MX0=', server_time: '2026-11-17T00:00:00Z' })).toEqual({
      items: [1],
      nextCursor: 'eyJpZCI6MX0=',
      serverTime: new Date('2026-11-17T00:00:00Z'),
    });
  });
});
