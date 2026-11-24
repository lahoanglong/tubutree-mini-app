import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Metadata } from 'next';
import { NextRequest } from 'next/server';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { matchHas } from 'next/dist/shared/lib/router/utils/prepare-destination';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Bản dựng thật đặt NEXT_PUBLIC_SITE_URL=https://tubutree.com (tools/deploy/deploy.sh từ chối host app.*): canonical, sitemap và host mà
// middleware nhận đều là tên miền gốc. Phải đặt trước khi lib/site.ts được nạp.
// stubEnv (không gán thẳng process.env) để afterAll trả lại: file spec khác chạy sau trong cùng tiến trình vẫn thấy host mặc định.
const SITE = vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://tubutree.com');
  return 'https://tubutree.com';
});

// Dữ liệu API giả cho đủ mọi loại URL của sitemap (một mục mỗi loại) và cho generateMetadata của chính các trang đó.
const PRODUCT = {
  id: 'p1', slug: 'nuoc-giat-bo-hon', brand: 'Bồ Hòn Xanh', name: 'Nước giặt bồ hòn', shortDesc: 'Giặt sạch dịu nhẹ', description: '<p>Bồ hòn</p>',
  images: ['https://cdn.test/a.jpg'], thumbnail: 'https://cdn.test/a.jpg', basePrice: 120_000, salePrice: null, certifications: [],
  variations: [{ id: 'v1', sku: 'NG-1L', name: '1L', retailPrice: 120_000, salePrice: null, stock: 5 }], ratingAvg: 0, reviewCount: 0,
};
const BRAND = { name: 'Bồ Hòn Xanh', slug: 'bo-hon-xanh', isVerified: true, tagline: 'Giặt sạch, nhẹ với đất', story: 'Câu chuyện', origin: null, products: [] };
const STOREFRONT = { slug: 'chi-lan', title: 'Góc xanh của Lan', headerNote: 'Đồ sống xanh chị Lan dùng mỗi ngày', isSample: false };
const CAMPAIGN = { slug: 'tuan-le-xanh', title: 'Tuần lễ xanh', subtitle: 'Giảm đến 20%', image: null };
const CATEGORY = { id: 'cat-tay-rua', name: 'Tẩy rửa', slug: 'tay-rua', sortOrder: 1, productCount: 4 };
// Tên phải có dung tích: thẻ Refill chỉ lên trang (và trang chỉ được lập chỉ mục) khi so được giá theo lượng với chai.
const refillItem = (kind: 'chai' | 'refill') => ({
  productId: `${kind}-1`, slug: `${kind}-nuoc-giat`, name: kind === 'chai' ? 'Nước giặt 500ml' : 'Túi Refill nước giặt 2L', thumbnail: null, variationId: `v-${kind}`,
  price: kind === 'chai' ? 68_000 : 200_000, compareAt: null, sizeLabel: kind === 'chai' ? '500ml' : '2L', inStock: true, tubu: true,
});
const REFILL_LANDING = { enabled: true, pairs: [{ bottle: refillItem('chai'), refill: refillItem('refill'), savingPct: 26 }] };

const api = vi.hoisted(() => ({ legalContent: '# Nội dung đã duyệt' as string | null, matcherEnabled: true }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getProducts: async ({ page }: { page?: string }) => (page === '1' ? [{ slug: PRODUCT.slug }] : []),
  getProduct: async (slug: string) => (slug === PRODUCT.slug ? PRODUCT : null),
  getCategories: async () => [CATEGORY],
  getBrands: async () => [{ slug: BRAND.slug, name: BRAND.name }],
  getBrand: async (slug: string) => (slug === BRAND.slug ? BRAND : null),
  getLegalDoc: async () => ({ content: api.legalContent, vars: {} }),
  getStorefrontList: async () => [{ slug: STOREFRONT.slug, updatedAt: '2026-11-01T00:00:00.000Z' }],
  getStorefront: async (slug: string) => (slug === STOREFRONT.slug ? STOREFRONT : null),
}));
vi.mock('@/lib/core-http-server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/core-http-server')>();
  const get = async (p: string) => {
    if (p === '/campaigns/public-slugs') return [{ slug: CAMPAIGN.slug, updatedAt: '2026-11-01T00:00:00.000Z' }];
    if (p === `/campaigns/${CAMPAIGN.slug}`) return CAMPAIGN;
    if (p === '/catalog/refill-pairs/landing') return REFILL_LANDING;
    if (p === '/categories') return [CATEGORY];
    if (p === '/brands') return [{ brand: BRAND.name, count: 4 }];
    if (p === '/game/matcher/status') return { enabled: api.matcherEnabled };
    throw new Error(`GET ${p} chưa có trong dữ liệu giả của sitemap-integrity.spec`);
  };
  return { ...actual, createServerHttp: () => ({ get }) };
});

import sitemap from './sitemap';
import robots from './robots';
import { middleware } from '@/middleware';
import nextConfig from '../../next.config.mjs';
import { LEGAL_SLUGS } from '@/lib/legal';
import { SITE_URL } from '@/lib/site';
import { LEGAL_SLUGS as GUARD_LEGAL_SLUGS, robotsVerdict, sameUrl } from '../../../../scripts/ci/sitemap-guard/index.mjs';

// ---------------------------------------------------------------------------------------------------------------------------------
// Định tuyến như Next: redirects() của next.config, rồi middleware, rồi cây app/ (page.tsx + chuỗi layout.tsx).

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
type SegKind = 'static' | 'dynamic' | 'catchall' | 'optional';
interface PageRoute {
  file: string;
  dirs: string[];
}

function collectPages(dir: string, rel: string[] = []): PageRoute[] {
  const out: PageRoute[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      // Thư mục `_x` là riêng (không thành route); `@slot` song song không dùng ở web.
      if (!name.startsWith('_') && !name.startsWith('@')) out.push(...collectPages(full, [...rel, name]));
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) out.push({ file: full, dirs: rel });
  }
  return out;
}

const segKind = (dir: string): SegKind | 'group' =>
  /^\(.+\)$/.test(dir) ? 'group' : dir.startsWith('[[...') ? 'optional' : dir.startsWith('[...') ? 'catchall' : dir.startsWith('[') ? 'dynamic' : 'static';
const paramName = (dir: string) => dir.replace(/^\[+(\.\.\.)?|\]+$/g, '');
const RANK: Record<SegKind, number> = { static: 3, dynamic: 2, catchall: 1, optional: 0 };

/** Khớp đường dẫn với một page.tsx; nhiều trang khớp thì lấy trang cụ thể hơn (tĩnh > [x] > [...x] > [[...x]]) như Next. */
function resolvePage(pages: PageRoute[], pathname: string): { route: PageRoute; params: Record<string, string | string[]> } | null {
  const segs = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const hits: { route: PageRoute; params: Record<string, string | string[]>; rank: number[] }[] = [];
  for (const route of pages) {
    const dirs = route.dirs.filter((d) => segKind(d) !== 'group');
    const params: Record<string, string | string[]> = {};
    const rank: number[] = [];
    let i = 0;
    let ok = true;
    for (const dir of dirs) {
      const kind = segKind(dir) as SegKind;
      rank.push(RANK[kind]);
      if (kind === 'static') ok = segs[i++] === dir;
      else if (kind === 'dynamic') {
        ok = i < segs.length;
        params[paramName(dir)] = segs[i++]!;
      } else {
        ok = kind === 'optional' || i < segs.length;
        if (i < segs.length) params[paramName(dir)] = segs.slice(i);
        i = segs.length;
      }
      if (!ok) break;
    }
    if (ok && i === segs.length) hits.push({ route, params, rank });
  }
  hits.sort((a, b) => {
    for (let k = 0; k < Math.max(a.rank.length, b.rank.length); k++) {
      const d = (b.rank[k] ?? -1) - (a.rank[k] ?? -1);
      if (d) return d;
    }
    return 0;
  });
  return hits[0] ?? null;
}

const layoutChain = (route: PageRoute): string[] =>
  Array.from({ length: route.dirs.length + 1 }, (_, n) => path.join(APP_DIR, ...route.dirs.slice(0, n), 'layout.tsx')).filter((f) => {
    try {
      return statSync(f).isFile();
    } catch {
      return false;
    }
  });

interface RouteModule {
  metadata?: Metadata;
  generateMetadata?: (props: { params: Promise<unknown>; searchParams: Promise<unknown> }, parent: Promise<Metadata>) => Promise<Metadata>;
}

/** Metadata cuối của trang: layout từ gốc xuống rồi trang; khoá cấp trên cùng của tầng sau thay khoá cùng tên của tầng trước (như Next). */
async function resolveMetadata(route: PageRoute, params: Record<string, string | string[]>, search: URLSearchParams): Promise<Metadata> {
  let acc: Metadata = {};
  const props = { params: Promise.resolve(params), searchParams: Promise.resolve(Object.fromEntries(search)) };
  for (const file of [...layoutChain(route), route.file]) {
    // Đường dẫn tuyệt đối, không phải file:// (pathToFileURL mã hoá `[slug]` thành `%5Bslug%5D` và Vite không tìm thấy tệp).
    const mod = (await import(/* @vite-ignore */ file)) as RouteModule;
    const md = mod.generateMetadata ? await mod.generateMetadata(props, Promise.resolve(acc)) : mod.metadata;
    if (!md) continue;
    acc = { ...acc, ...Object.fromEntries(Object.entries(md).filter(([, v]) => v !== undefined)) };
  }
  return acc;
}

const canonicalOf = (md: Metadata): string | null => {
  const c = md.alternates?.canonical;
  if (!c) return null;
  const raw = typeof c === 'string' ? c : c instanceof URL ? c.href : String((c as { url: string | URL }).url);
  return new URL(raw, md.metadataBase ?? SITE_URL).href;
};
const robotsNoindex = (md: Metadata): boolean => {
  const r = md.robots;
  if (!r) return false;
  if (typeof r === 'string') return /\b(noindex|none)\b/i.test(r);
  return r.index === false || (typeof r.googleBot === 'object' && r.googleBot?.index === false);
};

type Redirect = { source: string; destination: string; has?: unknown[]; missing?: unknown[] };

/** Đi một URL như crawler (không cookie): lỗi định tuyến, hoặc trang + metadata cuối. */
async function audit(url: string, ctx: { pages: PageRoute[]; redirects: Redirect[]; robotsRules: { allow: string[]; disallow: string[] } }): Promise<string[]> {
  const problems: string[] = [];
  const u = new URL(url);
  const host = new URL(SITE_URL).host;
  if (!robotsVerdict(u.pathname + u.search, ctx.robotsRules).allowed) problems.push(`robots.txt chặn ${u.pathname}`);

  const query = Object.fromEntries(u.searchParams);
  for (const r of ctx.redirects) {
    const params = getPathMatch(r.source)(u.pathname);
    if (params && matchHas({ headers: { host }, cookies: {} } as never, query, r.has as never, r.missing as never) !== false) {
      return [...problems, `next.config redirects() chuyển hướng ${r.source} → ${r.destination}`];
    }
  }

  const res = middleware(new NextRequest(url, { headers: { host } }));
  const location = res.headers.get('location');
  if (location) return [...problems, `middleware chuyển hướng ${res.status} → ${location}`];
  if (res.status >= 400) return [...problems, `middleware trả ${res.status}`];
  const robotsHeader = res.headers.get('x-robots-tag');
  if (robotsHeader && /noindex|none/i.test(robotsHeader)) problems.push(`X-Robots-Tag: ${robotsHeader}`);
  const rewrite = res.headers.get('x-middleware-rewrite');
  const target = rewrite ? new URL(rewrite) : u;

  const hit = resolvePage(ctx.pages, target.pathname);
  if (!hit) return [...problems, `không có page.tsx cho ${target.pathname} (404)`];
  let md: Metadata;
  try {
    md = await resolveMetadata(hit.route, hit.params, target.searchParams);
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? '';
    return [...problems, digest.startsWith('NEXT_') ? `generateMetadata gọi ${digest.split(';')[0]}` : `generateMetadata lỗi: ${(err as Error).message}`];
  }
  if (robotsNoindex(md)) problems.push(`metadata robots noindex (${JSON.stringify(md.robots)})`);
  const canonical = canonicalOf(md);
  if (!canonical) problems.push('metadata không có alternates.canonical');
  else if (!sameUrl(canonical, url)) problems.push(`canonical ${canonical} khác URL của sitemap`);
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------------

let ctx: Parameters<typeof audit>[1];
let urls: string[];

beforeAll(async () => {
  const rules = robots().rules as { allow: string[]; disallow: string[] }[];
  ctx = {
    pages: collectPages(APP_DIR),
    redirects: (await nextConfig.redirects!()) as Redirect[],
    robotsRules: { allow: rules.flatMap((r) => r.allow), disallow: rules.flatMap((r) => r.disallow) },
  };
  urls = (await sitemap()).map((e) => e.url);
}, 60_000);
afterAll(() => vi.unstubAllEnvs());

describe('sitemap ↔ canonical ↔ robots (bản dựng NEXT_PUBLIC_SITE_URL=https://tubutree.com)', () => {
  it('dữ liệu giả phủ đủ mọi loại URL: trang chủ, trang tĩnh, sản phẩm, danh mục, nhãn, 5 chính sách, gian hàng, chiến dịch, Refill', () => {
    expect(SITE_URL).toBe(SITE);
    const paths = urls.map((url) => new URL(url).pathname + new URL(url).search);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/',
        '/gioi-thieu',
        `/san-pham/${PRODUCT.slug}`,
        `/san-pham?category=${CATEGORY.id}`,
        `/brand/${BRAND.slug}`,
        ...LEGAL_SLUGS.map((s) => `/chinh-sach/${s}`),
        `/s/${STOREFRONT.slug}`,
        `/chien-dich/${CAMPAIGN.slug}`,
        '/tiet-kiem-refill',
        '/vuon-xanh/chon-chuan-xanh',
      ]),
    );
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('mọi URL của sitemap: không bị chuyển hướng, có page.tsx (200), không noindex, robots.txt không chặn, canonical trùng đúng URL đó', async () => {
    const problems: string[] = [];
    for (const url of urls) {
      for (const p of await audit(url, ctx)) problems.push(`${new URL(url).pathname}${new URL(url).search}: ${p}`);
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it('đủ 5 trang /chinh-sach/* khi nội dung đã duyệt; danh sách của script sitemap-guard khớp LEGAL_SLUGS', () => {
    expect([...LEGAL_SLUGS]).toEqual([...GUARD_LEGAL_SLUGS]);
    expect(LEGAL_SLUGS).toHaveLength(5);
    for (const slug of LEGAL_SLUGS) expect(urls, slug).toContain(`${SITE}/chinh-sach/${slug}`);
  });

  it('chính sách chưa duyệt (content null): sitemap bỏ trang vì chính trang tự noindex — hai bên không mâu thuẫn', async () => {
    api.legalContent = null;
    try {
      const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
      expect(paths.filter((p) => p.startsWith('/chinh-sach/'))).toEqual([]);
      expect(await audit(`${SITE}/chinh-sach/${LEGAL_SLUGS[0]}`, ctx)).toEqual([
        expect.stringMatching(/^metadata robots noindex/),
        'metadata không có alternates.canonical',
      ]);
    } finally {
      api.legalContent = '# Nội dung đã duyệt';
    }
  });

  it('Chọn Chuẩn Xanh tắt (game.matcher_enabled): sitemap bỏ trang vì chính trang tự noindex', async () => {
    api.matcherEnabled = false;
    try {
      const paths = (await sitemap()).map((e) => new URL(e.url).pathname);
      expect(paths).not.toContain('/vuon-xanh/chon-chuan-xanh');
      expect(await audit(`${SITE}/vuon-xanh/chon-chuan-xanh`, ctx)).toEqual([expect.stringMatching(/^metadata robots noindex/)]);
    } finally {
      api.matcherEnabled = true;
    }
  });
});

describe('bộ kiểm tự bắt lỗi (không phải kiểm cho có)', () => {
  it.each([
    ['/gio-hang', /robots\.txt chặn \/gio-hang/],
    ['/cong-dong/xep-hang', /next\.config redirects\(\) chuyển hướng \/cong-dong\/xep-hang → \/cong-dong/],
    ['/gioi-thieu/', /middleware chuyển hướng 308 → https:\/\/tubutree\.com\/gioi-thieu/],
    ['/hub-san-pham', /middleware chuyển hướng 308/],
    ['/khong-co-trang-nay', /không có page\.tsx cho \/khong-co-trang-nay \(404\)/],
    ['/brand/ten%20co%20cach', /middleware trả 404/],
    ['/hop-xanh', /metadata robots noindex/],
    ['/hoan-tien', /metadata robots noindex/],
    ['/chinh-sach/khong-ton-tai', /middleware trả 404/],
  ])('%s', async (p, expected) => {
    const problems = await audit(`${SITE}${p}`, ctx);
    expect(problems.some((m) => expected.test(m)), problems.join(' | ')).toBe(true);
  });

  it('host cũ app.* gắn X-Robots-Tag noindex: bản dựng đặt sai NEXT_PUBLIC_SITE_URL thì mọi URL đều bị loại', async () => {
    const res = middleware(new NextRequest('https://app.tubutree.com/gioi-thieu', { headers: { host: 'app.tubutree.com' } }));
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
  });

  it('trang có canonical trỏ trang khác bị bắt: /san-pham?category=<id lạ> là noindex, không phải canonical của danh mục', async () => {
    const problems = await audit(`${SITE}/san-pham?category=khong-co`, ctx);
    expect(problems.some((m) => m.startsWith('metadata robots noindex'))).toBe(true);
  });
});
