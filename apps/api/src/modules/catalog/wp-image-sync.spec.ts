import 'reflect-metadata';
import { BadGatewayException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import sharp from 'sharp';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { isStorefrontImageValue } from '../../common/uploaded-image';
import { ApproveWpImagesDto, WpImageSyncController } from './wp-image-sync.controller';
import { WpImageSyncService } from './wp-image-sync.service';
import {
  DEFAULT_MAX_IMAGES,
  MAX_ENCODED_BYTES,
  WP_IMAGE_CANDIDATES,
  applyWpCandidate,
  candidateForSlug,
  downloadWpImage,
  encodeWpImage,
  loadDecisions,
  loadWpCatalog,
  parseWpImageUrl,
  pickImageUrls,
  resolveWpProduct,
  runExactSync,
  type ResolvedWpProduct,
  type WpHttp,
  type WpHttpResponse,
} from './wp-image-sync.core';

const EXACT_SLUG = 'cho-be-mat-co-dac-sokfarm-250g-3c395c';
const EXACT = candidateForSlug(EXACT_SLUG)!;
const COMBO_SLUG = 'combo-sach-diu-nhe-po-lang-srm-tt-757657';
const upload = (name: string) => `https://tubutree.com/wp-content/uploads/2024/05/${name}.png`;
const api = (slug: string) => `https://tubutree.com/wp-json/wc/store/v1/products?slug=${slug}`;

const png = (color: string, w = 40, h = 30) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const ok = (body: Buffer | string, contentType = 'image/png'): WpHttpResponse => ({ status: 200, contentType, body: Buffer.isBuffer(body) ? body : Buffer.from(body) });
const wpJson = (id: number, slug: string, urls: string[], name = 'Tên WordPress') => ok(JSON.stringify([{ id, slug, name, images: urls.map((src) => ({ src })) }]), 'application/json');

type Route = WpHttpResponse | Error | (() => Promise<WpHttpResponse>);

/** Giả lập mạng: tra theo URL đầy đủ; thiếu route = 404. Ghi lại các URL đã gọi và số yêu cầu dạng hàm chạy đồng thời. */
function fakeHttp(routes: Record<string, Route>) {
  const calls: string[] = [];
  const state = { active: 0, maxActive: 0 };
  const http: WpHttp = async (url) => {
    const key = url.toString();
    calls.push(key);
    const hit = routes[key];
    if (hit instanceof Error) throw hit;
    if (!hit) return { status: 404, contentType: 'text/html', body: Buffer.alloc(0) };
    if (typeof hit !== 'function') return hit;
    state.active += 1;
    state.maxActive = Math.max(state.maxActive, state.active);
    try {
      return await hit();
    } finally {
      state.active -= 1;
    }
  };
  return { http, calls, state };
}

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  brand: string;
  isActive: boolean;
  storefrontId: string | null;
  images: string[];
  thumbnail: string | null;
  variations: { name: string }[];
}

/** Kho giả đủ cho các truy vấn của core + service (mô phỏng điều kiện images.isEmpty, storefrontId, slug.in). */
function fakeStore(seed: Partial<ProductRow>[]) {
  const products = new Map<string, ProductRow>();
  seed.forEach((p, i) => {
    const row: ProductRow = { id: `id-${i}`, slug: `slug-${i}`, name: `SP ${i}`, brand: 'Tubu Tree', isActive: true, storefrontId: null, images: [], thumbnail: null, variations: [{ name: '250g' }], ...p };
    products.set(row.id, row);
  });
  const decisions = new Map<string, { key: string; detail: unknown; lastOkAt: Date }>();
  const match = (p: ProductRow, where: Record<string, unknown>): boolean => {
    if (where.id !== undefined && p.id !== where.id) return false;
    if (where.slug !== undefined) {
      const s = where.slug as string | { in?: string[]; notIn?: string[] };
      if (typeof s === 'string' ? p.slug !== s : (s.in !== undefined && !s.in.includes(p.slug)) || (s.notIn !== undefined && s.notIn.includes(p.slug))) return false;
    }
    if (where.isActive !== undefined && p.isActive !== where.isActive) return false;
    const any = where.OR as Record<string, unknown>[] | undefined;
    if (any !== undefined && !any.some((w) => match(p, w))) return false;
    if ('storefrontId' in where && p.storefrontId !== where.storefrontId) return false;
    const imgs = where.images as { isEmpty?: boolean } | undefined;
    if (imgs?.isEmpty !== undefined && (p.images.length === 0) !== imgs.isEmpty) return false;
    return true;
  };
  const all = () => [...products.values()];
  const store = {
    product: {
      findUnique: jest.fn(async ({ where }: { where: Record<string, unknown> }) => all().find((p) => match(p, where)) ?? null),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => all().filter((p) => match(p, where))),
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => all().filter((p) => match(p, where)).length),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<ProductRow> }) => {
        const hit = all().filter((p) => match(p, where));
        hit.forEach((p) => Object.assign(p, data));
        return { count: hit.length };
      }),
    },
    opsHealthState: {
      upsert: jest.fn(async ({ where, create, update }: { where: { key: string }; create: { key: string; detail: unknown; lastOkAt: Date }; update: { detail: unknown; lastOkAt: Date } }) => {
        const prev = decisions.get(where.key);
        decisions.set(where.key, prev ? { ...prev, ...update } : create);
      }),
      deleteMany: jest.fn(async ({ where }: { where: { key: string } }) => {
        decisions.delete(where.key);
      }),
      findMany: jest.fn(async ({ where }: { where: { key: { startsWith: string } } }) => [...decisions.values()].filter((d) => d.key.startsWith(where.key.startsWith))),
    },
  };
  return { store, products, decisions, byId: (id: string) => products.get(id)! };
}

describe('danh sách ứng viên', () => {
  it('14 sản phẩm: 4 chắc chắn, 7 cùng dòng, 1 yếu, 2 combo; slug không trùng', () => {
    const counts: Record<string, number> = {};
    for (const c of WP_IMAGE_CANDIDATES) counts[c.tier] = (counts[c.tier] ?? 0) + 1;
    expect(counts).toEqual({ EXACT: 4, SAME_LINE: 7, WEAK: 1, COMPOSITE: 2 });
    expect(new Set(WP_IMAGE_CANDIDATES.map((c) => c.productSlug)).size).toBe(WP_IMAGE_CANDIDATES.length);
  });

  it('mỗi nguồn có slug WordPress an toàn để ghép vào URL, mã dương, và chỉ combo mới có hai nguồn', () => {
    for (const c of WP_IMAGE_CANDIDATES) {
      expect(c.sources.length).toBeGreaterThan(0);
      for (const s of c.sources) {
        expect(s.slug).toMatch(/^[a-z0-9-]+$/);
        expect(s.id).toBeGreaterThan(0);
      }
      expect(c.note.length).toBeGreaterThan(10);
      expect(c.sources.length).toBe(c.tier === 'COMPOSITE' ? 2 : 1);
    }
  });
});

describe('parseWpImageUrl', () => {
  it('nhận ảnh trong wp-content/uploads của tubutree.com, đổi http sang https, bỏ query', () => {
    expect(parseWpImageUrl(upload('a'))?.toString()).toBe(upload('a'));
    expect(parseWpImageUrl('http://www.tubutree.com/wp-content/uploads/b.JPG?ver=3')?.toString()).toBe('https://www.tubutree.com/wp-content/uploads/b.JPG');
    expect(parseWpImageUrl('https://tubutree.com/wp-content/uploads/c.webp')).not.toBeNull();
  });

  it.each([
    ['host lạ', 'https://evil.example/wp-content/uploads/a.png'],
    ['host chứa tên miền', 'https://tubutree.com.evil.example/wp-content/uploads/a.png'],
    ['user:pass đánh lừa host', 'https://tubutree.com@evil.example/wp-content/uploads/a.png'],
    ['có cổng', 'https://tubutree.com:8443/wp-content/uploads/a.png'],
    ['không nằm trong uploads', 'https://tubutree.com/wp-admin/a.png'],
    ['thoát thư mục bằng ..', 'https://tubutree.com/wp-content/uploads/../../wp-config.php'],
    ['đuôi svg', 'https://tubutree.com/wp-content/uploads/a.svg'],
    ['đuôi php', 'https://tubutree.com/wp-content/uploads/a.php'],
    ['giao thức file', 'file:///etc/passwd'],
    ['không phải chuỗi', 42],
    ['quá dài', `https://tubutree.com/wp-content/uploads/${'a'.repeat(1_100)}.png`],
  ])('từ chối: %s', (_name, value) => {
    expect(parseWpImageUrl(value)).toBeNull();
  });
});

describe('resolveWpProduct', () => {
  const source = EXACT.sources[0]!;

  it('đọc tên, lọc ảnh ngoài kho WordPress và bỏ ảnh trùng', async () => {
    const { http } = fakeHttp({ [api(source.slug)]: wpJson(source.id, source.slug, [upload('a'), upload('a'), 'https://evil.example/x.png', upload('b')], 'Mật hoa dừa') });
    expect(await resolveWpProduct(http, source)).toEqual({ id: source.id, slug: source.slug, name: 'Mật hoa dừa', imageUrls: [upload('a'), upload('b')], error: null });
  });

  it('không ném khi WordPress tắt, trả mã lỗi, trả rác, hết sản phẩm hoặc không có ảnh', async () => {
    const cases: [string, Record<string, Route>][] = [
      ['mạng', { [api(source.slug)]: new Error('ECONNREFUSED') }],
      ['mã 503', { [api(source.slug)]: { status: 503, contentType: 'text/html', body: Buffer.alloc(0) } }],
      ['không phải JSON', { [api(source.slug)]: ok('<html>', 'text/html') }],
      ['sản phẩm đã mất', { [api(source.slug)]: ok('[]', 'application/json') }],
      ['không có ảnh', { [api(source.slug)]: wpJson(source.id, source.slug, []) }],
    ];
    for (const [name, routes] of cases) {
      const out = await resolveWpProduct(fakeHttp(routes).http, source);
      expect({ name, imageUrls: out.imageUrls, hasError: typeof out.error === 'string' && out.error.length > 0 }).toEqual({ name, imageUrls: [], hasError: true });
    }
  });

  it('từ chối slug có ký tự lạ trước khi gọi mạng', async () => {
    const { http, calls } = fakeHttp({});
    const out = await resolveWpProduct(http, { id: 1, slug: 'a&per_page=100' });
    expect(out.error).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

describe('pickImageUrls', () => {
  const r = (slug: string, n: number): ResolvedWpProduct => ({ id: 1, slug, name: slug, imageUrls: Array.from({ length: n }, (_, i) => upload(`${slug}-${i}`)), error: null });

  it('SP thường: các ảnh đầu của nguồn đầu tiên có ảnh, tối đa 3 mặc định', () => {
    expect(pickImageUrls('EXACT', [r('a', 5)])).toEqual([upload('a-0'), upload('a-1'), upload('a-2')]);
    expect(DEFAULT_MAX_IMAGES).toBe(3);
    expect(pickImageUrls('SAME_LINE', [{ ...r('x', 0), error: 'lỗi' }, r('b', 2)])).toEqual([upload('b-0'), upload('b-1')]);
  });

  it('combo: xen kẽ ảnh đầu của từng món, tối đa 4', () => {
    expect(pickImageUrls('COMPOSITE', [r('a', 3), r('b', 3)], 4)).toEqual([upload('a-0'), upload('b-0'), upload('a-1'), upload('b-1')]);
    expect(pickImageUrls('COMPOSITE', [r('a', 1), r('b', 3)], 4)).toEqual([upload('a-0'), upload('b-0'), upload('b-1'), upload('b-2')]);
  });

  it('trần 8 ảnh và tối thiểu 1', () => {
    expect(pickImageUrls('EXACT', [r('a', 20)], 99)).toHaveLength(8);
    expect(pickImageUrls('EXACT', [r('a', 20)], 0)).toHaveLength(1);
  });

  it('không có ảnh nào thì trả rỗng', () => {
    expect(pickImageUrls('EXACT', [{ ...r('a', 0), error: 'x' }])).toEqual([]);
    expect(pickImageUrls('COMPOSITE', [r('a', 0), r('b', 0)])).toEqual([]);
  });
});

describe('encodeWpImage', () => {
  it('nén ảnh lớn về WebP cạnh dài ≤ 1200px, qua bộ kiểm ảnh của hệ thống', async () => {
    const out = await encodeWpImage(await png('#336699', 2400, 1600));
    expect(out.dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
    expect(isStorefrontImageValue(out.dataUrl)).toBe(true);
    expect(out.width).toBe(1200);
    expect(out.height).toBe(800);
    expect(out.bytes).toBeLessThanOrEqual(MAX_ENCODED_BYTES);
    expect(out.dataUrl.length).toBeLessThan(1_500_000);
  });

  it('ảnh nhỏ giữ nguyên cỡ, không phóng to', async () => {
    const out = await encodeWpImage(await png('#aa0000', 40, 30));
    expect([out.width, out.height]).toEqual([40, 30]);
  });

  it('từ chối tệp không phải ảnh raster (SVG, HTML, rác)', async () => {
    await expect(encodeWpImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).rejects.toThrow();
    await expect(encodeWpImage(Buffer.from('<html></html>'))).rejects.toThrow();
    await expect(encodeWpImage(Buffer.from('không phải ảnh'))).rejects.toThrow();
  });
});

describe('downloadWpImage', () => {
  it('chỉ tải URL thuộc kho WordPress, không gọi mạng với URL khác', async () => {
    const { http, calls } = fakeHttp({});
    await expect(downloadWpImage(http, 'https://evil.example/a.png')).rejects.toThrow('không thuộc kho ảnh');
    expect(calls).toEqual([]);
  });

  it('mã khác 200 hoặc content-type không phải ảnh thì lỗi', async () => {
    await expect(downloadWpImage(fakeHttp({}).http, upload('thieu'))).rejects.toThrow('404');
    await expect(downloadWpImage(fakeHttp({ [upload('html')]: ok('<html>', 'text/html') }).http, upload('html'))).rejects.toThrow('không phải ảnh');
    await expect(downloadWpImage(fakeHttp({ [upload('svg')]: ok('<svg/>', 'image/svg+xml') }).http, upload('svg'))).rejects.toThrow('không phải ảnh');
  });

  it('ảnh hợp lệ trả data URL WebP', async () => {
    const { http } = fakeHttp({ [upload('ok')]: ok(await png('#00aa00')) });
    expect((await downloadWpImage(http, upload('ok'))).dataUrl).toMatch(/^data:image\/webp;base64,/);
  });
});

describe('applyWpCandidate', () => {
  const source = EXACT.sources[0]!;
  const routes = async (urls = [upload('a'), upload('b'), upload('c'), upload('d')]): Promise<Record<string, Route>> => ({
    [api(source.slug)]: wpJson(source.id, source.slug, urls),
    ...Object.fromEntries(await Promise.all(urls.map(async (u, i) => [u, ok(await png(['#ff0000', '#00ff00', '#0000ff', '#ffff00'][i % 4]!))] as const))),
  });
  const NOW = new Date('2026-11-13T10:00:00.000Z');

  it('ghi 3 ảnh WebP đầu, thumbnail trỏ ảnh đầu, ghi quyết định APPLIED', async () => {
    const { store, byId, decisions } = fakeStore([{ id: 'p1', slug: EXACT_SLUG }]);
    const out = await applyWpCandidate({ store: store as never, http: fakeHttp(await routes()).http, now: () => NOW }, { candidate: EXACT, actor: 'admin-1' });
    expect(out).toMatchObject({ status: 'APPLIED', imageCount: 3, failed: 0 });
    expect(byId('p1').images).toHaveLength(3);
    expect(byId('p1').images.every((i) => i.startsWith('data:image/webp;base64,'))).toBe(true);
    expect(byId('p1').thumbnail).toContain('/product/p1/0');
    expect(decisions.get(`catalog.wp_image:${EXACT_SLUG}`)?.detail).toEqual({ decision: 'APPLIED', by: 'admin-1', at: NOW.toISOString(), imageCount: 3, sources: [source.slug] });
  });

  it('tôn trọng danh sách ảnh đã chọn', async () => {
    const { store, byId } = fakeStore([{ id: 'p1', slug: EXACT_SLUG }]);
    const out = await applyWpCandidate({ store: store as never, http: fakeHttp(await routes()).http }, { candidate: EXACT, imageUrls: [upload('d')], actor: 'a' });
    expect(out).toMatchObject({ status: 'APPLIED', imageCount: 1 });
    expect(byId('p1').images).toHaveLength(1);
  });

  it('SP đã có ảnh: không tải, không ghi, không ghi quyết định', async () => {
    const { store, byId, decisions } = fakeStore([{ id: 'p1', slug: EXACT_SLUG, images: ['data:image/png;base64,iVBORw0KGgo='] }]);
    const { http, calls } = fakeHttp(await routes());
    expect(await applyWpCandidate({ store: store as never, http }, { candidate: EXACT, actor: 'a' })).toEqual({ status: 'SKIPPED', reason: 'HAS_IMAGES' });
    expect(calls).toEqual([]);
    expect(store.product.updateMany).not.toHaveBeenCalled();
    expect(byId('p1').images).toEqual(['data:image/png;base64,iVBORw0KGgo=']);
    expect(decisions.size).toBe(0);
  });

  it('chạy hai lần: lần hai không ghi lại (idempotent)', async () => {
    const { store } = fakeStore([{ id: 'p1', slug: EXACT_SLUG }]);
    const deps = { store: store as never, http: fakeHttp(await routes()).http };
    expect((await applyWpCandidate(deps, { candidate: EXACT, actor: 'a' })).status).toBe('APPLIED');
    expect(await applyWpCandidate(deps, { candidate: EXACT, actor: 'a' })).toEqual({ status: 'SKIPPED', reason: 'HAS_IMAGES' });
    expect(store.product.updateMany).toHaveBeenCalledTimes(1);
  });

  it('thua cuộc đua (ai đó thêm ảnh giữa lúc tải): UPDATE có điều kiện ghi 0 dòng, không đè, không ghi quyết định', async () => {
    const { store, byId, decisions } = fakeStore([{ id: 'p1', slug: EXACT_SLUG }]);
    store.product.updateMany.mockImplementationOnce(async () => {
      byId('p1').images = ['data:image/png;base64,iVBORw0KGgo='];
      return { count: 0 };
    });
    expect(await applyWpCandidate({ store: store as never, http: fakeHttp(await routes()).http }, { candidate: EXACT, actor: 'a' })).toEqual({ status: 'SKIPPED', reason: 'HAS_IMAGES' });
    expect(byId('p1').images).toEqual(['data:image/png;base64,iVBORw0KGgo=']);
    expect(decisions.size).toBe(0);
  });

  it('SP đối tác và SP không tồn tại không bị đụng', async () => {
    const partner = fakeStore([{ id: 'p1', slug: EXACT_SLUG, storefrontId: 'sf1' }]);
    expect(await applyWpCandidate({ store: partner.store as never, http: fakeHttp({}).http }, { candidate: EXACT, actor: 'a' })).toEqual({ status: 'SKIPPED', reason: 'PARTNER_OWNED' });
    const none = fakeStore([]);
    expect(await applyWpCandidate({ store: none.store as never, http: fakeHttp({}).http }, { candidate: EXACT, actor: 'a' })).toEqual({ status: 'SKIPPED', reason: 'PRODUCT_NOT_FOUND' });
    expect(partner.store.product.updateMany).not.toHaveBeenCalled();
  });

  it('một ảnh lỗi thì bỏ ảnh đó, vẫn ghi các ảnh còn lại', async () => {
    const { store, byId } = fakeStore([{ id: 'p1', slug: EXACT_SLUG }]);
    const r = await routes([upload('a'), upload('hong'), upload('c')]);
    r[upload('hong')] = ok('không phải ảnh');
    const out = await applyWpCandidate({ store: store as never, http: fakeHttp(r).http }, { candidate: EXACT, actor: 'a' });
    expect(out).toMatchObject({ status: 'APPLIED', imageCount: 2, failed: 1 });
    expect(byId('p1').images).toHaveLength(2);
  });

  it('không tải được ảnh nào: THẤT BẠI, DB không đổi', async () => {
    const { store, byId, decisions } = fakeStore([{ id: 'p1', slug: EXACT_SLUG }]);
    const r = { [api(source.slug)]: wpJson(source.id, source.slug, [upload('a')]) };
    const out = await applyWpCandidate({ store: store as never, http: fakeHttp(r).http }, { candidate: EXACT, actor: 'a' });
    expect(out.status).toBe('FAILED');
    expect(byId('p1').images).toEqual([]);
    expect(store.product.updateMany).not.toHaveBeenCalled();
    expect(decisions.size).toBe(0);
  });

  it('WordPress đã tắt: THẤT BẠI kèm lý do, DB không đổi', async () => {
    const { store, byId } = fakeStore([{ id: 'p1', slug: EXACT_SLUG }]);
    const out = await applyWpCandidate({ store: store as never, http: fakeHttp({ [api(source.slug)]: new Error('ENOTFOUND') }).http }, { candidate: EXACT, actor: 'a' });
    expect(out).toMatchObject({ status: 'FAILED', reason: expect.stringContaining('WordPress') });
    expect(byId('p1').images).toEqual([]);
  });

  it('combo nạp ảnh xen kẽ của hai món', async () => {
    const combo = candidateForSlug(COMBO_SLUG)!;
    const [s1, s2] = combo.sources as [(typeof combo.sources)[number], (typeof combo.sources)[number]];
    const r = {
      [api(s1.slug)]: wpJson(s1.id, s1.slug, [upload('m1')]),
      [api(s2.slug)]: wpJson(s2.id, s2.slug, [upload('m2')]),
      [upload('m1')]: ok(await png('#111111')),
      [upload('m2')]: ok(await png('#eeeeee')),
    };
    const { store, byId } = fakeStore([{ id: 'p9', slug: COMBO_SLUG }]);
    const out = await applyWpCandidate({ store: store as never, http: fakeHttp(r).http }, { candidate: combo, actor: 'a' });
    expect(out).toMatchObject({ status: 'APPLIED', imageCount: 2 });
    expect(byId('p9').images).toHaveLength(2);
  });
});

describe('runExactSync', () => {
  const exactRoutes = async () => {
    const r: Record<string, Route> = {};
    for (const c of WP_IMAGE_CANDIDATES.filter((x) => x.tier === 'EXACT')) {
      const s = c.sources[0]!;
      r[api(s.slug)] = wpJson(s.id, s.slug, [upload(`${s.slug}-1`)]);
      r[upload(`${s.slug}-1`)] = ok(await png('#abcdef'));
    }
    return r;
  };
  const seed = () => WP_IMAGE_CANDIDATES.map((c, i) => ({ id: `p${i}`, slug: c.productSlug }));

  it('mặc định chỉ xem: không ghi DB, chỉ nhóm EXACT', async () => {
    const { store } = fakeStore(seed());
    const rows = await runExactSync({ store: store as never, http: fakeHttp(await exactRoutes()).http }, { apply: false, actor: 'script' });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.outcome.status === 'DRY_RUN')).toBe(true);
    expect(store.product.updateMany).not.toHaveBeenCalled();
    expect(store.opsHealthState.upsert).not.toHaveBeenCalled();
  });

  it('apply ghi đúng 4 SP EXACT, các nhóm khác vẫn rỗng; chạy lại không ghi thêm', async () => {
    const { store, products } = fakeStore(seed());
    const deps = { store: store as never, http: fakeHttp(await exactRoutes()).http };
    const rows = await runExactSync(deps, { apply: true, actor: 'script' });
    expect(rows.map((r) => r.outcome.status)).toEqual(['APPLIED', 'APPLIED', 'APPLIED', 'APPLIED']);
    const withImages = [...products.values()].filter((p) => p.images.length > 0).map((p) => p.slug).sort();
    expect(withImages).toEqual(WP_IMAGE_CANDIDATES.filter((c) => c.tier === 'EXACT').map((c) => c.productSlug).sort());
    const again = await runExactSync(deps, { apply: true, actor: 'script' });
    expect(again.every((r) => r.outcome.status === 'SKIPPED')).toBe(true);
    expect(store.product.updateMany).toHaveBeenCalledTimes(4);
  });
});

describe('WpImageSyncService', () => {
  const source = EXACT.sources[0]!;
  const OTHER_SLUG = 'cho-be-nuoc-tuong-mat-hoa-dua-sokfarm-200ml-6b9b40';

  async function setup(seed: Partial<ProductRow>[] = [{ id: 'p1', slug: EXACT_SLUG, name: 'Mật cô đặc 250g' }], routes?: Record<string, Route>) {
    const fs = fakeStore(seed);
    const net = fakeHttp(routes ?? { [api(source.slug)]: wpJson(source.id, source.slug, [upload('a'), upload('b')], 'Mật hoa dừa WP'), [upload('a')]: ok(await png('#ff0000')), [upload('b')]: ok(await png('#00ff00')) });
    const imageResize = { invalidateRegistry: jest.fn() };
    const svc = new WpImageSyncService(fs.store as never, imageResize as never, net.http);
    return { svc, imageResize, ...fs, ...net };
  }

  it('list(false): chỉ đọc DB, không gọi mạng; chỉ SP có trong danh sách ứng viên', async () => {
    const { svc, calls } = await setup([{ id: 'p1', slug: EXACT_SLUG, name: 'Mật cô đặc 250g' }, { id: 'x', slug: 'khong-phai-ung-vien' }]);
    const res = await svc.list(false);
    expect(calls).toEqual([]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ productId: 'p1', name: 'Mật cô đặc 250g', tier: 'EXACT', state: 'PENDING', variations: ['250g'], wp: null, defaultImageUrls: null });
    expect(res.counts).toEqual({ PENDING: 1, SKIPPED: 0, APPLIED: 0, HAS_IMAGES: 0 });
  });

  it('list(true): kèm ảnh WordPress, cache giữa các lượt, lỗi không bị cache', async () => {
    const { svc, calls } = await setup();
    const first = await svc.list(true);
    expect(first.items[0]!.wp).toEqual([{ id: source.id, slug: source.slug, name: 'Mật hoa dừa WP', imageUrls: [upload('a'), upload('b')], error: null }]);
    expect(first.items[0]!.defaultImageUrls).toEqual([upload('a'), upload('b')]);
    await svc.list(true);
    expect(calls.filter((u) => u === api(source.slug))).toHaveLength(1);

    const down = await setup(undefined, { [api(source.slug)]: new Error('ECONNREFUSED') });
    expect((await down.svc.list(true)).items[0]!.wp![0]!.error).toBeTruthy();
    await down.svc.list(true);
    expect(down.calls.filter((u) => u === api(source.slug))).toHaveLength(2);
  });

  it('SP đã có ảnh hiện HAS_IMAGES và không gọi WordPress; SP đối tác không vào danh sách', async () => {
    const { svc, calls } = await setup([{ id: 'p1', slug: EXACT_SLUG, images: ['data:image/png;base64,iVBORw0KGgo='] }]);
    const res = await svc.list(true);
    expect(res.items[0]).toMatchObject({ state: 'HAS_IMAGES', wp: null });
    expect(calls).toEqual([]);
    const partner = await setup([{ id: 'p1', slug: EXACT_SLUG, storefrontId: 'sf' }]);
    expect((await partner.svc.list(false)).items).toEqual([]);
  });

  it('approve: ghi ảnh, làm tươi bộ nhớ đệm ảnh, lần hai báo đã có ảnh', async () => {
    const { svc, imageResize, byId } = await setup();
    expect(await svc.approve('admin-1', 'p1')).toEqual({ productId: 'p1', state: 'APPLIED', appliedCount: 2 });
    expect(byId('p1').images).toHaveLength(2);
    expect(imageResize.invalidateRegistry).toHaveBeenCalledTimes(1);
    await expect(svc.approve('admin-1', 'p1')).rejects.toBeInstanceOf(ConflictException);
    expect(imageResize.invalidateRegistry).toHaveBeenCalledTimes(1);
    expect((await svc.list(false)).items[0]).toMatchObject({ state: 'APPLIED', appliedCount: 2, decidedBy: 'admin-1' });
  });

  it('approve với ảnh chọn tay: chỉ nhận ảnh nằm trong danh sách WordPress của đúng sản phẩm', async () => {
    const { svc, byId } = await setup();
    await expect(svc.approve('a', 'p1', ['https://evil.example/x.png'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.approve('a', 'p1', [upload('khong-co-trong-danh-sach')])).rejects.toBeInstanceOf(BadRequestException);
    expect(byId('p1').images).toEqual([]);
    expect(await svc.approve('a', 'p1', [upload('b')])).toMatchObject({ appliedCount: 1 });
    expect(byId('p1').images).toHaveLength(1);
  });

  it('approve khi WordPress tắt: 502, DB không đổi, không làm tươi bộ nhớ đệm', async () => {
    const { svc, byId, imageResize } = await setup(undefined, { [api(source.slug)]: new Error('ENOTFOUND') });
    await expect(svc.approve('a', 'p1')).rejects.toBeInstanceOf(BadGatewayException);
    await expect(svc.approve('a', 'p1', [upload('a')])).rejects.toBeInstanceOf(BadGatewayException);
    expect(byId('p1').images).toEqual([]);
    expect(imageResize.invalidateRegistry).not.toHaveBeenCalled();
  });

  it('approve/skip/restore: SP lạ, không phải ứng viên, SP đối tác', async () => {
    // Kho WordPress rỗng: "x" không có bảng làm tay lẫn gợi ý theo tên nên không phải ứng viên.
    const { svc } = await setup([{ id: 'p1', slug: EXACT_SLUG }, { id: 'x', slug: 'khong-phai-ung-vien' }, { id: 'sf', slug: OTHER_SLUG, storefrontId: 'sf1' }], { 'https://tubutree.com/wp-json/wc/store/v1/products?per_page=100&page=1': ok('[]', 'application/json') });
    for (const act of [(id: string) => svc.approve('a', id), (id: string) => svc.skip('a', id), (id: string) => svc.restore(id)]) {
      await expect(act('khong-ton-tai')).rejects.toBeInstanceOf(NotFoundException);
      await expect(act('x')).rejects.toBeInstanceOf(NotFoundException);
      await expect(act('sf')).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('skip rồi restore: trạng thái đổi theo, không chạm ảnh; không skip được SP đã nạp', async () => {
    const { svc, byId } = await setup();
    expect(await svc.skip('admin-2', 'p1')).toEqual({ productId: 'p1', state: 'SKIPPED' });
    expect((await svc.list(false)).items[0]).toMatchObject({ state: 'SKIPPED', decidedBy: 'admin-2' });
    expect(await svc.restore('p1')).toEqual({ productId: 'p1', state: 'PENDING' });
    expect((await svc.list(false)).items[0]!.state).toBe('PENDING');
    expect(byId('p1').images).toEqual([]);

    await svc.approve('a', 'p1');
    await expect(svc.skip('a', 'p1')).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.restore('p1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('bỏ qua không chặn duyệt về sau (đổi ý)', async () => {
    const { svc, byId } = await setup();
    await svc.skip('a', 'p1');
    expect(await svc.approve('a', 'p1')).toMatchObject({ state: 'APPLIED' });
    expect(byId('p1').images).toHaveLength(2);
  });

  it.each([
    ['skip', (svc: WpImageSyncService) => svc.skip('b', 'p1')],
    ['restore', (svc: WpImageSyncService) => svc.restore('p1')],
  ])('%s chen giữa lúc đang duyệt không đè quyết định APPLIED: xếp sau lượt duyệt rồi báo đã có ảnh', async (_name, act) => {
    const pngA = await png('#123456');
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 25));
      return ok(pngA);
    };
    const routes: Record<string, Route> = { [api(source.slug)]: wpJson(source.id, source.slug, [upload('a1')]), [upload('a1')]: slow };
    const { svc, store, calls, decisions, byId } = await setup([{ id: 'p1', slug: EXACT_SLUG }], routes);

    // Giữ phần GHI của skip/restore cho tới khi lượt duyệt xong: nếu chúng không xếp hàng thì kiểm xong rồi mới ghi, đè lên APPLIED.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realUpsert = store.opsHealthState.upsert.getMockImplementation()!;
    store.opsHealthState.upsert.mockImplementation(async (args) => {
      if ((args.create.detail as { decision: string }).decision === 'SKIPPED') await gate;
      return realUpsert(args);
    });
    const realDelete = store.opsHealthState.deleteMany.getMockImplementation()!;
    store.opsHealthState.deleteMany.mockImplementation(async (args) => {
      await gate;
      return realDelete(args);
    });

    const approving = svc.approve('a', 'p1');
    for (let i = 0; i < 200 && !calls.includes(upload('a1')); i += 1) await new Promise((r) => setTimeout(r, 1));
    expect(calls).toContain(upload('a1'));
    const racing = act(svc).then(
      () => null,
      (e: unknown) => e,
    );
    void approving.finally(release);

    await approving;
    expect(await racing).toBeInstanceOf(ConflictException);
    expect(byId('p1').images).toHaveLength(1);
    expect(decisions.get(`catalog.wp_image:${EXACT_SLUG}`)?.detail).toMatchObject({ decision: 'APPLIED', by: 'a' });
  });

  it('hai lượt duyệt đồng thời được xếp hàng: không bao giờ tải ảnh chồng lên nhau', async () => {
    const other = candidateForSlug(OTHER_SLUG)!.sources[0]!;
    const pngA = await png('#123456');
    const slow = () => async () => {
      await new Promise((r) => setTimeout(r, 15));
      return ok(pngA);
    };
    const routes: Record<string, Route> = {
      [api(source.slug)]: wpJson(source.id, source.slug, [upload('a1'), upload('a2')]),
      [api(other.slug)]: wpJson(other.id, other.slug, [upload('b1'), upload('b2')]),
      [upload('a1')]: slow(),
      [upload('a2')]: slow(),
      [upload('b1')]: slow(),
      [upload('b2')]: slow(),
    };
    const { svc, state, byId } = await setup([{ id: 'p1', slug: EXACT_SLUG }, { id: 'p2', slug: OTHER_SLUG }], routes);
    const [a, b] = await Promise.all([svc.approve('x', 'p1'), svc.approve('x', 'p2')]);
    expect(a.state).toBe('APPLIED');
    expect(b.state).toBe('APPLIED');
    expect(state.maxActive).toBe(1);
    expect(byId('p1').images).toHaveLength(2);
    expect(byId('p2').images).toHaveLength(2);
  });

  it('lượt duyệt hỏng không làm kẹt hàng đợi của các lượt sau', async () => {
    const pngOk = await png('#654321');
    const { svc, byId } = await setup(undefined, { [api(source.slug)]: wpJson(source.id, source.slug, [upload('a')]), [upload('a')]: ok('không phải ảnh') });
    await expect(svc.approve('a', 'p1')).rejects.toBeInstanceOf(BadGatewayException);
    expect(byId('p1').images).toEqual([]);
    const retry = await setup(undefined, { [api(source.slug)]: wpJson(source.id, source.slug, [upload('a')]), [upload('a')]: ok(pngOk) });
    await expect(retry.svc.approve('a', 'p1')).resolves.toMatchObject({ state: 'APPLIED' });
  });

  it('loadDecisions bỏ qua dòng hỏng, đọc đúng dòng hợp lệ', async () => {
    const { store, decisions } = fakeStore([]);
    decisions.set('catalog.wp_image:a', { key: 'catalog.wp_image:a', lastOkAt: new Date(), detail: { decision: 'SKIPPED', by: 'u', at: '2026-11-13T00:00:00.000Z' } });
    decisions.set('catalog.wp_image:b', { key: 'catalog.wp_image:b', lastOkAt: new Date(), detail: { decision: 'LẠ' } });
    decisions.set('catalog.wp_image:c', { key: 'catalog.wp_image:c', lastOkAt: new Date(), detail: null });
    expect([...(await loadDecisions(store as never)).keys()]).toEqual(['a']);
  });
});

const catalogUrl = (page = 1) => `https://tubutree.com/wp-json/wc/store/v1/products?per_page=100&page=${page}`;
const wpItem = (id: number, slug: string, name: string, images = 1) => ({ id, slug, name, images: Array.from({ length: images }, (_, i) => ({ src: upload(`${slug}-${i}`) })) });
const wpCatalog = (rows: unknown[]) => ok(JSON.stringify(rows), 'application/json');

describe('loadWpCatalog', () => {
  const bulk = (from: number, count: number) => wpCatalog(Array.from({ length: count }, (_, i) => wpItem(from + i, `sp-${from + i}`, `SP ${from + i}`)));

  it('dưới 100 sản phẩm: đọc đúng một trang, bỏ sản phẩm không ảnh', async () => {
    const { http, calls } = fakeHttp({ [catalogUrl()]: wpCatalog([wpItem(1, 'sp-1', 'SP 1'), wpItem(2, 'sp-2', 'SP 2', 0)]) });
    expect(await loadWpCatalog(http)).toEqual([{ id: 1, slug: 'sp-1', name: 'SP 1' }]);
    expect(calls).toEqual([catalogUrl()]);
  });

  it('đủ 100 sản phẩm thì đọc trang kế; trang sau lỗi thì trả null chứ không trả kho đọc dở', async () => {
    const { http, calls } = fakeHttp({ [catalogUrl(1)]: bulk(1, 100), [catalogUrl(2)]: bulk(101, 5) });
    expect(await loadWpCatalog(http)).toHaveLength(105);
    expect(calls).toEqual([catalogUrl(1), catalogUrl(2)]);

    for (const second of [new Error('ECONNRESET'), { status: 500, contentType: 'text/html', body: Buffer.alloc(0) }, ok('<html>', 'text/html')]) {
      expect(await loadWpCatalog(fakeHttp({ [catalogUrl(1)]: bulk(1, 100), [catalogUrl(2)]: second as Route }).http)).toBeNull();
    }
  });

  it('dừng ở 5 trang dù WordPress cứ trả đủ 100', async () => {
    const routes: Record<string, Route> = {};
    for (let p = 1; p <= 8; p += 1) routes[catalogUrl(p)] = bulk(p * 1000, 100);
    const { http, calls } = fakeHttp(routes);
    expect(await loadWpCatalog(http)).toHaveLength(500);
    expect(calls).toHaveLength(5);
  });

  it('trang đầu lỗi (mạng, mã khác 200, rác, không phải mảng) trả null, không ném', async () => {
    for (const first of [new Error('ENOTFOUND'), { status: 503, contentType: 'text/html', body: Buffer.alloc(0) }, ok('<html>', 'text/html'), wpCatalog({ not: 'mảng' } as never)]) {
      expect(await loadWpCatalog(fakeHttp({ [catalogUrl()]: first as Route }).http)).toBeNull();
    }
  });
});

describe('WpImageSyncService: gợi ý theo tên cho sản phẩm ngoài bảng làm tay', () => {
  const GRANOLA = 'granola-mix-nuts-tui-tien-loi-bh-nong-3b8792';
  const MANGO = 'xoai-say-deo-bh-nong-5f75de';
  const WP_GRANOLA = 'granola-mix-trai-cay-say-bh-nong';
  const KHO = [wpItem(8927, WP_GRANOLA, 'Granola mix trái cây sấy BH.NONG', 2), wpItem(8654, 'ca-phe-muoi-csea', 'Cà Phê Muối C&#038;Sea Hộp 16g x 10 gói')];
  const SEED: Partial<ProductRow>[] = [
    { id: 'g', slug: GRANOLA, name: 'Granola mix nuts túi tiện lợi BH.NONG', brand: 'BH.Nong' },
    { id: 'm', slug: MANGO, name: 'Xoài sấy dẻo BH.NONG', brand: 'BH.Nong' },
    // Cùng tên với "g" nên nếu không bị chặn vì tắt/đối tác/đã có ảnh thì đều có gợi ý: bỏ chốt chặn nào là test đỏ.
    { id: 'off', slug: 'granola-mix-nuts-tat', name: 'Granola mix nuts túi tiện lợi BH.NONG', brand: 'BH.Nong', isActive: false },
    { id: 'sf', slug: 'granola-mix-nuts-doi-tac', name: 'Granola mix nuts túi tiện lợi BH.NONG', brand: 'BH.Nong', storefrontId: 'sf1' },
    { id: 'has', slug: 'granola-mix-nuts-co-anh', name: 'Granola mix nuts túi tiện lợi BH.NONG', brand: 'BH.Nong', images: ['data:image/png;base64,iVBORw0KGgo='] },
  ];

  async function setup(routes?: Record<string, Route>, seed: Partial<ProductRow>[] = SEED) {
    const fs = fakeStore(seed);
    const net = fakeHttp(routes ?? { [catalogUrl()]: wpCatalog(KHO), [api(WP_GRANOLA)]: wpJson(8927, WP_GRANOLA, [upload('g0'), upload('g1')], 'Granola mix trái cây sấy BH.NONG'), [upload('g0')]: ok(await png('#aa0000')), [upload('g1')]: ok(await png('#00aa00')) });
    const imageResize = { invalidateRegistry: jest.fn() };
    const svc = new WpImageSyncService(fs.store as never, imageResize as never, net.http);
    return { svc, imageResize, ...fs, ...net };
  }

  it('list(true): SP rỗng ảnh có gợi ý là CANDIDATE kèm ảnh WordPress, SP không có gợi ý là NONE; SP tắt, đối tác, đã có ảnh không vào', async () => {
    const { svc } = await setup();
    const res = await svc.list(true);
    expect(res.items.map((r) => [r.productSlug, r.tier, r.state])).toEqual([[GRANOLA, 'CANDIDATE', 'PENDING'], [MANGO, 'NONE', 'PENDING']]);
    expect(res.items[0]).toMatchObject({ tierLabel: 'Gợi ý theo tên, chưa kiểm', defaultImageUrls: [upload('g0'), upload('g1')] });
    expect(res.items[0]!.note).toContain('Granola mix trái cây sấy BH.NONG');
    expect(res.items[0]!.note).toMatch(/khớp \d+%/);
    expect(res.items[0]!.wp).toEqual([{ id: 8927, slug: WP_GRANOLA, name: 'Granola mix trái cây sấy BH.NONG', imageUrls: [upload('g0'), upload('g1')], error: null }]);
    expect(res.items[1]).toMatchObject({ tierLabel: 'Chưa có gợi ý', wp: null, defaultImageUrls: null });
    expect(res.items[1]!.note).toMatch(/Cần ảnh mới/);
    expect(res.counts).toEqual({ PENDING: 2, SKIPPED: 0, APPLIED: 0, HAS_IMAGES: 0 });
  });

  it('list(false) không gọi mạng và không có dòng gợi ý', async () => {
    const { svc, calls } = await setup();
    expect((await svc.list(false)).items).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('kho WordPress được cache giữa các lượt; lỗi không bị cache và không làm hỏng danh sách', async () => {
    const { svc, calls } = await setup();
    await svc.list(true);
    await svc.list(true);
    expect(calls.filter((u) => u === catalogUrl())).toHaveLength(1);

    const down = await setup({ [catalogUrl()]: new Error('ECONNREFUSED') });
    const res = await down.svc.list(true);
    expect(res.items.map((r) => r.tier)).toEqual(['NONE', 'NONE']);
    expect(res.items[0]!.note).toMatch(/Chưa đọc được kho sản phẩm WordPress/);
    await down.svc.list(true);
    expect(down.calls.filter((u) => u === catalogUrl())).toHaveLength(2);
  });

  it('approve CANDIDATE: ghi ảnh, ghi quyết định kèm nguồn; dòng vẫn hiện là "Đã duyệt" ở lượt tải sau', async () => {
    const { svc, byId, decisions, imageResize } = await setup();
    expect(await svc.approve('admin-1', 'g')).toEqual({ productId: 'g', state: 'APPLIED', appliedCount: 2 });
    expect(byId('g').images).toHaveLength(2);
    expect(imageResize.invalidateRegistry).toHaveBeenCalledTimes(1);
    expect(decisions.get(`catalog.wp_image:${GRANOLA}`)!.detail).toMatchObject({ decision: 'APPLIED', by: 'admin-1', imageCount: 2, sources: [WP_GRANOLA] });

    const after = await svc.list(true);
    expect(after.items.find((r) => r.productSlug === GRANOLA)).toMatchObject({ state: 'APPLIED', appliedCount: 2, decidedBy: 'admin-1', wp: null });
    expect(after.counts).toMatchObject({ APPLIED: 1, PENDING: 1 });
    await expect(svc.approve('admin-1', 'g')).rejects.toBeInstanceOf(ConflictException);
  });

  it('approve CANDIDATE chỉ nhận ảnh nằm trong danh sách WordPress của sản phẩm được gợi ý', async () => {
    const { svc, byId } = await setup();
    await expect(svc.approve('a', 'g', ['https://evil.example/x.png'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.approve('a', 'g', [upload('khong-co')])).rejects.toBeInstanceOf(BadRequestException);
    expect(byId('g').images).toEqual([]);
    expect(await svc.approve('a', 'g', [upload('g1')])).toMatchObject({ appliedCount: 1 });
  });

  it('approve với SP không có gợi ý, SP tắt, SP đối tác: 404; kho WordPress tắt: 502; DB không đổi', async () => {
    const { svc, byId } = await setup();
    await expect(svc.approve('a', 'm')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.approve('a', 'off')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.approve('a', 'sf')).rejects.toBeInstanceOf(NotFoundException);
    const down = await setup({ [catalogUrl()]: new Error('ENOTFOUND') });
    await expect(down.svc.approve('a', 'g')).rejects.toBeInstanceOf(BadGatewayException);
    expect([byId('g').images, byId('m').images, down.byId('g').images]).toEqual([[], [], []]);
  });

  it('skip rồi restore dòng CANDIDATE: trạng thái đổi theo, không chạm ảnh; dòng NONE không có thao tác', async () => {
    const { svc, byId } = await setup();
    expect(await svc.skip('admin-2', 'g')).toEqual({ productId: 'g', state: 'SKIPPED' });
    expect((await svc.list(true)).items[0]).toMatchObject({ productSlug: GRANOLA, tier: 'CANDIDATE', state: 'SKIPPED', decidedBy: 'admin-2' });
    expect(await svc.restore('g')).toEqual({ productId: 'g', state: 'PENDING' });
    expect(byId('g').images).toEqual([]);
    await expect(svc.skip('a', 'm')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.restore('m')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gợi ý không bao giờ tự nạp: runExactSync chỉ đụng đúng các dòng EXACT của bảng làm tay', async () => {
    const { store, byId, http } = await setup();
    const rows = await runExactSync({ store: store as never, http }, { apply: true, actor: 'cli' });
    expect(rows.map((r) => r.productSlug)).toEqual(WP_IMAGE_CANDIDATES.filter((c) => c.tier === 'EXACT').map((c) => c.productSlug));
    expect([byId('g').images, byId('m').images]).toEqual([[], []]);
  });

  it('SP đã bỏ qua rồi bị tắt: dòng NONE kèm lý do (không gợi ý, không bấm được); cờ chưa-hỏi-được chỉ bật khi kho WordPress lỗi', async () => {
    const seed: Partial<ProductRow>[] = [{ id: 'g', slug: GRANOLA, name: 'Granola mix nuts túi tiện lợi BH.NONG', brand: 'BH.Nong' }, { id: 'off', slug: 'granola-tat', name: 'Granola mix nuts túi tiện lợi BH.NONG', brand: 'BH.Nong', isActive: false }];
    const skipped = { key: 'catalog.wp_image:granola-tat', lastOkAt: new Date(), detail: { decision: 'SKIPPED', by: 'u', at: '2026-11-14T00:00:00.000Z' } };
    const up = await setup(undefined, seed);
    up.decisions.set(skipped.key, skipped);
    const ok1 = await up.svc.list(true);
    expect(ok1.items.map((r) => [r.productSlug, r.tier, r.state, r.suggestUnavailable])).toEqual([[GRANOLA, 'CANDIDATE', 'PENDING', false], ['granola-tat', 'NONE', 'SKIPPED', false]]);
    expect(ok1.items[1]!.note).toMatch(/đang tắt/);
    const down = await setup({ [catalogUrl()]: new Error('ENOTFOUND') }, seed);
    down.decisions.set(skipped.key, skipped);
    expect((await down.svc.list(true)).items.map((r) => [r.productSlug, r.tier, r.suggestUnavailable])).toEqual([[GRANOLA, 'NONE', true], ['granola-tat', 'NONE', false]]);
  });

  it('restore dòng đã bỏ qua không cần kho WordPress: WordPress tắt hay đổi tên vẫn gỡ được "Đã bỏ qua"; SP chưa từng quyết định thì 404', async () => {
    const { svc, decisions } = await setup();
    await svc.skip('admin-2', 'g');
    const down = await setup({ [catalogUrl()]: new Error('ENOTFOUND') });
    for (const [key, value] of decisions) down.decisions.set(key, value);
    expect(await down.svc.restore('g')).toEqual({ productId: 'g', state: 'PENDING' });
    expect(down.decisions.size).toBe(0);
    await expect(down.svc.restore('m')).rejects.toBeInstanceOf(NotFoundException);
    await expect(down.svc.restore('sf')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ứng viên làm tay vẫn đi trước gợi ý, dòng làm tay và dòng gợi ý cùng hiện trong một danh sách', async () => {
    const seed: Partial<ProductRow>[] = [{ id: 'p1', slug: EXACT_SLUG, name: 'Mật cô đặc 250g', brand: 'Sokfarm' }, ...SEED];
    const routes: Record<string, Route> = {
      [catalogUrl()]: wpCatalog(KHO),
      [api(EXACT.sources[0]!.slug)]: wpJson(EXACT.sources[0]!.id, EXACT.sources[0]!.slug, [upload('e0')]),
      [api(WP_GRANOLA)]: wpJson(8927, WP_GRANOLA, [upload('g0')]),
    };
    const { svc } = await setup(routes, seed);
    const res = await svc.list(true);
    expect(res.items.map((r) => [r.productSlug, r.tier])).toEqual([[EXACT_SLUG, 'EXACT'], [GRANOLA, 'CANDIDATE'], [MANGO, 'NONE']]);
  });
});

describe('WpImageSyncController', () => {
  it('chỉ ADMIN', () => {
    expect(Reflect.getMetadata(ROLES_KEY, WpImageSyncController)).toEqual(['ADMIN']);
  });

  it('chuyển đúng tham số cho service', async () => {
    const svc = { list: jest.fn().mockResolvedValue({}), approve: jest.fn().mockResolvedValue({}), skip: jest.fn().mockResolvedValue({}), restore: jest.fn().mockResolvedValue({}) };
    const c = new WpImageSyncController(svc as never);
    await c.list('1');
    await c.list(undefined);
    await c.list('true');
    expect(svc.list.mock.calls).toEqual([[true], [false], [false]]);
    await c.approve('admin', 'p1', { imageUrls: [upload('a')] });
    await c.approve('admin', 'p1', {});
    expect(svc.approve.mock.calls).toEqual([['admin', 'p1', [upload('a')]], ['admin', 'p1', undefined]]);
    await c.skip('admin', 'p1');
    await c.restore('p1');
    expect(svc.skip).toHaveBeenCalledWith('admin', 'p1');
    expect(svc.restore).toHaveBeenCalledWith('p1');
  });

  describe('ApproveWpImagesDto', () => {
    const errors = (body: unknown) => validateSync(plainToInstance(ApproveWpImagesDto, body));
    it('nhận thân rỗng (ảnh mặc định) và danh sách ảnh hợp lệ', () => {
      expect(errors({})).toEqual([]);
      expect(errors({ imageUrls: [upload('a')] })).toEqual([]);
    });
    it.each([
      ['mảng rỗng', { imageUrls: [] }],
      ['quá 8 ảnh', { imageUrls: Array.from({ length: 9 }, (_, i) => upload(`a${i}`)) }],
      ['trùng ảnh', { imageUrls: [upload('a'), upload('a')] }],
      ['không phải chuỗi', { imageUrls: [1] }],
      ['không phải mảng', { imageUrls: upload('a') }],
      ['URL quá dài', { imageUrls: ['a'.repeat(1_001)] }],
    ])('từ chối: %s', (_n, body) => {
      expect(errors(body).length).toBeGreaterThan(0);
    });
  });
});
