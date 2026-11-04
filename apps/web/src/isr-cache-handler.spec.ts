// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import IsrCacheHandler, { notFoundStore } from '../isr-cache-handler.mjs';

// Lớp cache bám vào cấu trúc nội bộ của Next: chạy thật FileSystemCache trên thư mục tạm, không giả lập, để đổi phiên bản Next là hỏng ở đây.
const require = createRequire(import.meta.url);
const { nodeFs } = require('next/dist/server/lib/node-fs-methods.js');
const { getRouteCacheKey } = require('next/dist/server/lib/route-cache-key.js');
const { CachedRouteKind, IncrementalCacheKind } = require('next/dist/server/response-cache/types.js');
const FileSystemCache = require('next/dist/server/lib/incremental-cache/file-system-cache.js').default;

const pdpKey = (slug: string) => getRouteCacheKey(`/san-pham/${slug}`, { kind: 'APP_PAGE', sourceRoute: '/san-pham/[slug]/page' });
const page = (status?: number) => ({ kind: 'APP_PAGE', html: '<html>trang</html>', rscData: Buffer.from('rsc'), headers: {}, postponed: undefined, status, segmentData: undefined });
const pageCtx = { fetchCache: false, isRoutePPREnabled: false, isFallback: false };
const readPage = { kind: 'APP_PAGE', isRoutePPREnabled: false, isFallback: false };

let dir: string;
const make = (Cls: typeof FileSystemCache = IsrCacheHandler) =>
  new Cls({ fs: nodeFs, flushToDisk: true, serverDistDir: join(dir, 'server'), revalidatedTags: [], maxMemoryCacheSize: 0 });

const defaults = { ttlMs: notFoundStore.ttlMs, maxEntries: notFoundStore.maxEntries, maxBytes: notFoundStore.maxBytes, now: notFoundStore.now };
let clock = 0;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'isr-cache-'));
  clock = 1_000_000;
  notFoundStore.clear();
  notFoundStore.now = () => clock;
});
afterEach(() => {
  Object.assign(notFoundStore, defaults);
  notFoundStore.clear();
  rmSync(dir, { recursive: true, force: true });
});

describe('Next 15.5.28: cấu trúc nội bộ mà isr-cache-handler.mjs dựa vào', () => {
  it('đúng phiên bản Next đã kiểm (đổi phiên bản thì đọc lại file-system-cache.js rồi sửa số ở đây)', () => {
    expect(require('next/package.json').version).toBe('15.5.28');
  });

  it('tên loại cache là chuỗi APP_PAGE / APP_ROUTE / FETCH', () => {
    expect([CachedRouteKind.APP_PAGE, CachedRouteKind.APP_ROUTE, CachedRouteKind.FETCH]).toEqual(['APP_PAGE', 'APP_ROUTE', 'FETCH']);
    expect(IncrementalCacheKind.APP_PAGE).toBe('APP_PAGE');
  });

  it('FileSystemCache gốc ghi trang 404 xuống đĩa và mã 404 nằm trong giá trị đọc lại (thứ lớp này lọc)', async () => {
    const cache = make(FileSystemCache);
    await cache.set(pdpKey('bia'), page(404), pageCtx);
    const got = await cache.get(pdpKey('bia'), readPage);
    expect(got?.value).toMatchObject({ kind: 'APP_PAGE', status: 404 });
  });

  it('IncrementalCache khởi tạo cacheHandler tuỳ chỉnh với cùng ngữ cảnh (fs, flushToDisk, serverDistDir…)', () => {
    const src = readFileSync(require.resolve('next/dist/server/lib/incremental-cache/index.js'), 'utf8');
    expect(src).toMatch(/new CurCacheHandler\(\{\s*dev,\s*fs,\s*flushToDisk,\s*serverDistDir,\s*revalidatedTags,\s*maxMemoryCacheSize,/);
  });
});

describe('isr-cache-handler: không lưu trang 404 của đường dẫn lạ', () => {
  it('404 APP_PAGE chưa từng có bản: không ghi file nào xuống đĩa, nhưng đọc lại trong hạn vẫn có (lần hỏi sau không dựng lại)', async () => {
    const cache = make();
    await cache.set(pdpKey('slug-bia'), page(404), pageCtx);
    expect(existsSync(join(dir, 'server'))).toBe(false);
    // Handler mới cho mỗi request như Next: kho 404 dùng chung.
    const got = await make().get(pdpKey('slug-bia'), readPage);
    expect(got?.value).toMatchObject({ kind: 'APP_PAGE', status: 404 });
    expect(got?.lastModified).toBe(clock);
  });

  it('hết hạn (300 s) thì trống, Next dựng lại', async () => {
    const cache = make();
    await cache.set(pdpKey('het-han'), page(404), pageCtx);
    clock += 299_000;
    expect(await cache.get(pdpKey('het-han'), readPage)).not.toBeNull();
    clock += 1_000;
    expect(await cache.get(pdpKey('het-han'), readPage)).toBeNull();
    expect(notFoundStore.entries.size).toBe(0);
  });

  it('kho 404 không vượt trần số khoá: khoá cũ nhất bị đẩy ra', async () => {
    notFoundStore.maxEntries = 3;
    const cache = make();
    for (const slug of ['a', 'b', 'c', 'd']) await cache.set(pdpKey(slug), page(404), pageCtx);
    expect(notFoundStore.entries.size).toBe(3);
    expect(await cache.get(pdpKey('a'), readPage)).toBeNull();
    expect(await cache.get(pdpKey('d'), readPage)).not.toBeNull();
  });

  it('kho 404 không vượt trần byte', async () => {
    const one = page(404).html.length + page(404).rscData.length;
    notFoundStore.maxBytes = one * 2;
    const cache = make();
    for (const slug of ['a', 'b', 'c']) await cache.set(pdpKey(slug), page(404), pageCtx);
    expect(notFoundStore.entries.size).toBe(2);
    expect(notFoundStore.bytes).toBeLessThanOrEqual(one * 2);
  });

  it('đường dẫn trong kho 404 rồi có trang 200 (sản phẩm mới đúng slug): bỏ khỏi kho, ghi đĩa', async () => {
    const cache = make();
    await cache.set(pdpKey('moi'), page(404), pageCtx);
    await cache.set(pdpKey('moi'), page(200), pageCtx);
    expect(notFoundStore.entries.size).toBe(0);
    expect((await cache.get(pdpKey('moi'), readPage))?.value).toMatchObject({ status: 200 });
  });

  it('APP_PAGE 200 (status vắng hoặc 200) vẫn lưu', async () => {
    const cache = make();
    await cache.set(pdpKey('that'), page(), pageCtx);
    await cache.set(pdpKey('that-200'), page(200), pageCtx);
    expect((await cache.get(pdpKey('that'), readPage))?.value).toMatchObject({ kind: 'APP_PAGE', html: '<html>trang</html>' });
    expect((await cache.get(pdpKey('that-200'), readPage))?.value).toMatchObject({ kind: 'APP_PAGE', status: 200 });
  });

  it('trang đã có bản (sản phẩm vừa bị gỡ): 404 vẫn ghi đè, không để bản 200 cũ phục vụ mãi', async () => {
    const cache = make();
    await cache.set(pdpKey('vua-go'), page(200), pageCtx);
    await cache.set(pdpKey('vua-go'), page(404), pageCtx);
    expect(notFoundStore.entries.size).toBe(0);
    expect((await make().get(pdpKey('vua-go'), readPage))?.value).toMatchObject({ status: 404 });
  });

  it('APP_ROUTE và FETCH vẫn lưu như cũ', async () => {
    const cache = make();
    const routeKey = getRouteCacheKey('/sitemap.xml', { kind: 'APP_ROUTE', sourceRoute: '/sitemap.xml/route' });
    await cache.set(routeKey, { kind: 'APP_ROUTE', body: Buffer.from('<xml/>'), headers: {}, status: 200 }, pageCtx);
    expect((await cache.get(routeKey, { kind: 'APP_ROUTE' }))?.value).toMatchObject({ kind: 'APP_ROUTE', status: 200 });

    const fetchValue = { kind: 'FETCH', data: { headers: {}, body: 'e30=', status: 200, url: 'http://api/products' }, revalidate: 300 };
    await cache.set('abc123', fetchValue, { fetchCache: true, tags: [] });
    expect((await cache.get('abc123', { kind: 'FETCH', tags: [], softTags: [] }))?.value).toMatchObject({ kind: 'FETCH', revalidate: 300 });
  });
});
