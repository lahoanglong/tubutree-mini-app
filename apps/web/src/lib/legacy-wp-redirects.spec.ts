// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import routeMap from '@tubutree/app-core/route-map.json';
import { PROD_CATALOG_2026_11_12 } from '@tubutree/app-core/commerce/prod-catalog-full.fixture';
import { classifyChain, expectedFor, parseArgs, parseSitemapLocs, toPathAndSearch, walk, type ChainStep } from '../../../../scripts/ops/check-cutover-redirects.mjs';
import { collectUploadPaths, parseArgs as parseExportArgs, safeUploadPath } from '../../../../scripts/ops/wp-public-export.mjs';
import {
  AUTO_MIN,
  DEFAULT_PATHS,
  HITS_DAY,
  REVIEW_MIN,
  buildProductMap,
  classifyHits,
  loadInputs,
  parseArgs as parseMapArgs,
  slugsFromHits,
  tokens,
  volumes,
} from '../../../../scripts/ops/build-legacy-wp-product-map.mjs';
import { LEGAL_SLUGS } from '@/lib/legal';
import { middleware } from '../middleware';
import { MINIAPP_PERMANENT_SOURCES, buildMiniappRedirects } from './miniapp-redirects.mjs';
import {
  BLOG_ORIGIN,
  LEGACY_FILE_REDIRECTS,
  LEGACY_GONE_EXACT,
  LEGACY_GONE_PREFIXES,
  LEGACY_PAGE_REDIRECTS,
  LEGACY_PRODUCT_REDIRECTS,
  LEGACY_WP_PRODUCT_MAP,
  carryLegacyParams,
  isWpBlogPath,
  isWpUploadPath,
  resolveLegacyWpPath,
} from './legacy-wp-redirects';

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (relative: string): string => readFileSync(`${REPO}${relative}`, 'utf8');

// 91 slug sản phẩm trong product-sitemap.xml của tubutree.com (WordPress), đo ngày 13/11/2026.
const WP_PRODUCT_SLUGS = [
  'banh-mam-gao-lut-bh-nong', 'bot-rua-binh-sua-cho-be-pineboo-500ml', 'bot-rua-tay-pineboo-cho-be', 'bot-tam-goi-cho-be-pineboo-500ml',
  'ca-phe-muoi-csea', 'ca-phe-sau-rieng-durica', 'ca-phe-sua-dua-kafedua', 'ca-phe-trung', 'combo-dau-goi-bo-bac-ha-gel-tam',
  'dau-gac-nguyen-chat-po-lang-30ml', 'dau-goi-dau-thao-duoc-tu-trai-bo-po-lang', 'dau-goi-thao-duoc-chiet-xuat-sam-visante',
  'dau-goi-thao-duoc-sam-visante-tri-gau', 'dau-qua-bo-ep-lanh-po-lang', 'dau-tay-trang-rua-mat-polang', 'dau-u-toc-bo-po-lang-50ml',
  'dau-xa-thao-duoc-chiet-xuat-sam-visante', 'dong-trung-ha-thao-hector-lite', 'dung-dich-rua-binh-sua-cho-be-fuwa3e',
  'dung-dich-sat-khuan-do-choi-tre-em-fuwa3e', 'duong-hoa-dua-organic-sokfarm', 'duong-hoa-dua-organic-sokfarm-5kg', 'gel-rua-chen-cho-may',
  'gel-rua-chen-cho-may-fuwa3e-10l', 'gel-tam-thao-duoc-po-lang-300ml', 'giam-mat-hoa-dua-huu-co-sokfarm-256ml', 'granola-mix-trai-cay-say-bh-nong',
  'granola-sieu-hat-bh-nong', 'hector-collagen-dong-trung-ha-thao', 'lau-da-nang-fuwa3e-500ml', 'mat-hoa-dua-co-dac-organic-sokfarm',
  'mat-hoa-dua-co-dac-organic-sokfarm-7kg', 'mat-hoa-dua-tuoi-organic-sokfarm', 'mat-na-bo-tuoi-po-lang', 'mat-na-ngu-po-lang',
  'muoi-rua-chen-cho-may', 'muoi-tam-po-lang-tinh-chat-bo-ca-phe', 'nap-diem', 'nuoc-dong-trung-ha-thao-hector-sam', 'nuoc-giat-fuwa3e-10l',
  'nuoc-giat-fuwa3e-500ml-100ml', 'nuoc-giat-huu-co-cho-be-pineboo-500ml', 'nuoc-giat-huu-co-fuwa3e', 'nuoc-lam-bong-chen-bat-fuwa3e',
  'nuoc-lau-da-nang-huu-co-fuwa3e-10l-2', 'nuoc-lau-san-fuwa3e', 'nuoc-lau-san-fuwa3e-10l', 'nuoc-nam-dong-trung-ha-thao',
  'nuoc-nam-dong-trung-ha-thao-hector-basic', 'nuoc-ngam-rua-thuc-pham-fuwa3e-10l', 'nuoc-ngam-rua-thuc-pham-fuwa3e-big-size',
  'nuoc-ngam-rua-thuc-pham-fuwa3e-size-nho', 'nuoc-rua-chen-fuwa3e-10l', 'nuoc-rua-chen-fuwa3e-sinh-hoc', 'nuoc-rua-chen-fuwa3e-size-nho',
  'nuoc-rua-tay-fuwa3e-big-size', 'nuoc-tay-bon-cau-huu-co-fuwa3e', 'nuoc-tay-trang-po-lang', 'nuoc-tay-trang-thien-nhien-tu-sam-visante',
  'nuoc-tuong-mat-hoa-dua-organic-sokfarm', 'nuoc-tuong-mat-hoa-dua-organic-sokfarm-1l', 'nuoc-tuong-mat-hoa-dua-organic-sokfarm-5l',
  'nuoc-uong-dong-trung-ha-thao-hector-thao-moc', 'nuoc-uong-sang-da-hector-white', 'phan-lanh-khu-mui-po-lang-huong-thao',
  'socola-hoa-tan-uong-lien-choco-oke', 'son-duong-moi-co-mau-bo-tuoi-po-lang', 'son-duong-moi-gac-tuoi-po-lang',
  'son-duong-moi-khong-mau-bo-tuoi-po-lang', 'sua-hat-gao-lut-nay-mam-bh-nong', 'sua-hat-gao-lut-nay-mam-thuan-chay-bh-nong',
  'sua-rua-mat-tao-bot-rau-ma-po-lang', 'sua-rua-mat-tao-bot-tu-sam-visante', 'sua-tam-goi-ngua-rom-say-cho-be-sam-visante',
  'sua-tam-ngua-mun-tu-sam-visante', 'tam-goi-3in1-cho-nam-tu-sam-visante', 'tay-bon-cau-size-lon-10l', 'tay-te-bao-chet-da-dau-thao-duoc-visante',
  'thanh-gao-lut-rong-bien-an-vat-bh-nong-180g', 'tinh-dau-treo-xe-o-to-thien-nhienfuwa3e', 'to-yen-anbinest-diet-nhung-huou',
  'to-yen-nhung-huou-anbinest-gold', 'to-yen-nhung-huou-anbinest-queen', 'tra-gao-lut-dong-trung-bh-nong', 'tra-gao-lut-ray-bh-nong',
  'xit-duong-toc-thao-duoc-visante', 'xit-lau-do-choi-pineboo-cho-be-500ml', 'xit-tram-cho-be-pineboo-150ml', 'xit-ve-sinh-noi-that',
  'yen-nhung-huou-anbinest-kids', 'yen-nhung-huou-anbinest-king',
];

// 40 trang thật trong page-sitemap.xml (đã bỏ 67 trang /elements/* và /demos/*), cùng ngày đo.
const WP_PAGE_PATHS = [
  '/', '/checkout', '/cart', '/about-fuwa3e', '/home', '/car-fresh', '/chinh-sach-dai-ly', '/fuwa3e-x-fundiin', '/draf-main-page', '/lien-he-2',
  '/my-account', '/shop', '/combo-qua-tet-2023', '/doi-tra-hoan-tien', '/refill', '/cua-hang', '/gio-hang', '/thanh-toan', '/tai-khoan',
  '/chinh-sach-bao-mat', '/dang-ky-thanh-cong', '/cong-bo-tccs', '/eco-enzyme', '/phuong-thuc-thanh-toan',
  '/chinh-sach-ban-hang/danh-sach-dai-ly-toan-quoc', '/chinh-sach-ban-hang', '/cau-chuyen-fuwa-3e', '/eco-enzyme-fuwa3e', '/ho-so-nang-luc',
  '/qua-trinh-san-xuat-fuwa3e', '/lich-su-hinh-thanh', '/kiem-dinh-chat-luong', '/hoat-dong-ban-hang', '/giai-thuong', '/lien-he',
  '/huong-dan-mua-hang', '/phuong-thuc-van-chuyen', '/test', '/track-order', '/my-account/wishlist',
];

// Trang WordPress không cần dòng ở bảng: trùng đúng đường dẫn web mới (middleware chỉ bỏ dấu / cuối bằng 308).
const IDENTITY_PAGES = ['/', '/gio-hang', '/thanh-toan', '/tai-khoan'];
// Ba đường trùng URL WooCommerce cũ và trùng đường dẫn Mini App: next.config redirects (301) chạy trước middleware, bảng này giữ cùng đích cho dạng có dấu /.
const WOOCOMMERCE_AND_MINIAPP_PATHS = ['/cart', '/checkout', '/refill'];

const WP_CATEGORY_PATHS = [
  '/category/uncategorized/', '/category/cau-chuyen-fuwa/', '/category/gel-rua-chen-cho-may-fuwa3e/', '/category/nuoc-giat-fuwa3e/',
  '/category/nuoc-rua-chen-fuwa3e/', '/category/nuoc-rua-tay-fuwa3e/', '/category/tin-tuc/', '/category/tin-tuc/cac-su-kien-fuwa/',
  '/category/hector/', '/category/thong-tin-san-pham/', '/category/du-lich/', '/category/suc-khoe/',
];

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
const CATALOG_SLUGS = new Set(PROD_CATALOG_2026_11_12.map((p) => p.slug));
const FOLDED_NAMES = PROD_CATALOG_2026_11_12.map((p) => fold(p.name));
const ROUTE_DIRS = new Set(readdirSync(APP_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
const MINIAPP_REDIRECT_SOURCES = new Map<string, string>(buildMiniappRedirects(routeMap.routes).map((r: { source: string; destination: string }) => [r.source, r.destination]));

const locationOf = (path: string): string => {
  const hit = resolveLegacyWpPath(path);
  if (hit?.kind !== 'redirect') throw new Error(`${path} không phải chuyển hướng`);
  return hit.location;
};
const targetUrl = (location: string): URL => new URL(location, 'https://tubutree.test');
const redirectTo = (location: string) => ({ kind: 'redirect', location }) as const;
const firstSegment = (path: string): string => path.split('/').filter(Boolean)[0] ?? '';

describe('chuyển hướng sản phẩm WordPress /product/<slug>', () => {
  it('bảng có đủ 91 slug của sitemap, không thừa không thiếu', () => {
    expect(new Set(WP_PRODUCT_SLUGS).size).toBe(91);
    expect(Object.keys(LEGACY_PRODUCT_REDIRECTS).sort()).toEqual([...WP_PRODUCT_SLUGS].sort());
  });

  it('mọi URL /product/<slug>/ (có hoặc không có dấu / cuối) ra 301', () => {
    for (const slug of WP_PRODUCT_SLUGS) {
      for (const path of [`/product/${slug}/`, `/product/${slug}`]) {
        expect(resolveLegacyWpPath(path), path).toMatchObject({ kind: 'redirect', status: 301 });
      }
    }
  });

  it('đích /san-pham/<slug> là sản phẩm có thật trong ảnh chụp catalog PROD 12/11/2026 (111 SP)', () => {
    const pdp = Object.entries(LEGACY_PRODUCT_REDIRECTS).filter(([, to]) => to.startsWith('/san-pham/'));
    expect(pdp.length).toBeGreaterThan(40);
    for (const [wp, to] of pdp) {
      expect(CATALOG_SLUGS.has(to.slice('/san-pham/'.length)), `${wp} -> ${to}`).toBe(true);
    }
  });

  it('đích /san-pham?q=<từ khoá> có ít nhất một sản phẩm chứa mọi từ khoá (tìm không dấu): không rơi vào trang rỗng', () => {
    const searches = Object.entries(LEGACY_PRODUCT_REDIRECTS).filter(([, to]) => to.startsWith('/san-pham?'));
    expect(searches.length).toBeGreaterThan(10);
    for (const [wp, to] of searches) {
      const terms = fold(targetUrl(to).searchParams.get('q') ?? '').split(/\s+/).filter(Boolean);
      expect(terms.length, `${wp} -> ${to}`).toBeGreaterThan(0);
      expect(FOLDED_NAMES.some((name) => terms.every((term) => name.includes(term))), `${wp} -> ${to}`).toBe(true);
    }
  });

  it('chỉ sản phẩm đã ngừng hẳn (tổ yến Anbinest, nạp điểm) mới về cả kệ /san-pham', () => {
    const toAll = Object.entries(LEGACY_PRODUCT_REDIRECTS).filter(([, to]) => to === '/san-pham').map(([wp]) => wp).sort();
    expect(toAll).toEqual(['nap-diem', 'to-yen-anbinest-diet-nhung-huou', 'to-yen-nhung-huou-anbinest-gold', 'to-yen-nhung-huou-anbinest-queen', 'yen-nhung-huou-anbinest-kids', 'yen-nhung-huou-anbinest-king']);
  });

  it('không slug WordPress nào trùng slug catalog mới: route /product/[slug] của link CTV và Mini App không bị chặn', () => {
    for (const slug of WP_PRODUCT_SLUGS) expect(CATALOG_SLUGS.has(slug), slug).toBe(false);
    for (const p of PROD_CATALOG_2026_11_12) expect(resolveLegacyWpPath(`/product/${p.slug}`), p.slug).toBeNull();
  });

  it('slug lạ và khoá của Object.prototype không được coi là sản phẩm WordPress', () => {
    for (const slug of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'san-pham-khong-co']) {
      expect(resolveLegacyWpPath(`/product/${slug}`), slug).toBeNull();
    }
    expect(resolveLegacyWpPath('/product')).toBeNull();
    expect(resolveLegacyWpPath('/product/a/b')).toBeNull();
  });
});

describe('bản đồ sản phẩm WordPress sinh tự động (legacy-wp-product-map.json)', () => {
  const inputs = loadInputs(DEFAULT_PATHS);
  const SNAPSHOT_SLUGS = new Set(inputs.catalog.map((p) => p.slug));
  const WP_SNAPSHOT_SLUGS = new Set(inputs.wpProducts.map((p) => p.slug));
  const LOG_SLUGS = new Set(slugsFromHits(...Object.values(JSON.parse(read('scripts/ops/data/legacy-product-hits-20261116.json')).hits as Record<string, Record<string, number>>)));
  const mapEntries = Object.entries(LEGACY_WP_PRODUCT_MAP);

  it('sinh lại từ ảnh chụp đi kèm ra đúng tệp đang commit (không ai sửa tay bản đồ)', () => {
    const { map } = buildProductMap({ ...inputs, curated: LEGACY_PRODUCT_REDIRECTS });
    expect(map).toEqual(LEGACY_WP_PRODUCT_MAP);
    expect(read('apps/web/src/lib/legacy-wp-product-map.json')).toBe(`${JSON.stringify(map, null, 2)}\n`);
  });

  it('ảnh chụp catalog đi kèm trùng ảnh chụp PROD 12/11/2026 về tập slug', () => {
    expect([...SNAPSHOT_SLUGS].sort()).toEqual([...CATALOG_SLUGS].sort());
  });

  it('mọi đích là slug có thật trong ảnh chụp catalog; mọi nguồn là slug WordPress (Store API cũ hoặc log), không phải slug mới', () => {
    expect(mapEntries.length).toBeGreaterThanOrEqual(12);
    for (const [wp, slug] of mapEntries) {
      expect(SNAPSHOT_SLUGS.has(slug), `${wp} -> ${slug}`).toBe(true);
      expect(CATALOG_SLUGS.has(slug), `${wp} -> ${slug}`).toBe(true);
      expect(WP_SNAPSHOT_SLUGS.has(wp) || LOG_SLUGS.has(wp), wp).toBe(true);
      expect(CATALOG_SLUGS.has(wp), wp).toBe(false);
    }
  });

  it('không đè cặp PDP người đã duyệt trong LEGACY_PRODUCT_REDIRECTS', () => {
    for (const [wp] of mapEntries) {
      expect(LEGACY_PRODUCT_REDIRECTS[wp]?.startsWith('/san-pham/') ?? false, wp).toBe(false);
    }
  });

  it('/product/<slug>/, /product/<slug>, chữ hoa và đường con /feed, /embed đều ra cùng một 301 tới PDP của bản đồ', () => {
    for (const [wp, slug] of mapEntries) {
      for (const path of [`/product/${wp}/`, `/product/${wp}`, `/Product/${wp.toUpperCase()}/`, `/product/${wp}/feed/`, `/product/${wp}/embed`]) {
        expect(resolveLegacyWpPath(path), path).toEqual({ kind: 'redirect', status: 301, location: `/san-pham/${slug}` });
      }
    }
  });

  it('đường con của slug lạ hoặc slug mới vẫn không bị bắt (route /product/[slug] giữ nguyên)', () => {
    for (const path of ['/product/khong-co/feed', '/product/xit-tram-cho-be-pineboo-150ml-b70d1d/x', '/product/a/b/c']) {
      expect(resolveLegacyWpPath(path), path).toBeNull();
    }
  });

  it('đường con /feed và /&gsessionid=... của slug ở bảng tay về đích của bảng', () => {
    expect(locationOf('/product/thanh-gao-lut-rong-bien-an-vat-bh-nong-180g/feed/')).toBe('/san-pham/thanh-gao-lut-rong-bien-bh-nong-180g-da009b');
    expect(locationOf('/product/son-duong-moi-co-mau-bo-tuoi-po-lang/&gsessionid=X')).toBe('/san-pham/son-duong-co-mau-po-lang-a01-a03-a04-a05-ef066b');
    expect(locationOf('/product/giam-mat-hoa-dua-huu-co-sokfarm-256ml/feed')).toBe('/san-pham?q=sokfarm');
  });

  it('các cặp có bằng chứng rõ (tên trang cũ, giá biến thể) về đúng sản phẩm', () => {
    expect(locationOf('/product/nuoc-nam-dong-trung-ha-thao/')).toBe('/san-pham/nuoc-dong-trung-ha-thao-hector-collagen-plus-dep-da-chong-lao-hoa-70ml-x-10-chai-d0c0e1');
    expect(locationOf('/product/nuoc-giat-fuwa3e-10l/')).toBe('/san-pham/refill-nuoc-giat-cam-fuwa3e-10l-dc4433');
    expect(locationOf('/product/nuoc-tuong-mat-hoa-dua-organic-sokfarm/')).toBe('/san-pham/nuoc-tuong-mat-hoa-dua-sokfarm-cham-034cc1');
    expect(locationOf('/product/nuoc-tuong-mat-hoa-dua-organic-sokfarm-5l/')).toBe('/san-pham/nuoc-tuong-mat-hoa-dua-sokfarm-nau-2dc907');
    expect(locationOf('/product/nuoc-rua-chen-fuwa3e-size-nho/')).toBe('/san-pham/nuoc-rua-chen-fuwa3e-500ml-185d77');
    expect(locationOf('/product/nuoc-rua-chen-fuwa3e-sinh-hoc/')).toBe('/san-pham/nuoc-rua-chen-fuwa3e-3-8l-ef3979');
  });

  it(`lượt /product/* ngày ${HITS_DAY} qua bộ luật thật: lượt nào cũng 301, không giảm số lượt về PDP (136/171)`, () => {
    let pdpHits = 0;
    let total = 0;
    for (const [path, count] of Object.entries(inputs.hits)) {
      const hit = resolveLegacyWpPath(`/product/${path}/`);
      expect(hit, path).toMatchObject({ kind: 'redirect', status: 301 });
      total += count;
      if (hit?.kind === 'redirect' && hit.location.startsWith('/san-pham/')) pdpHits += count;
    }
    expect(total).toBe(171);
    expect(pdpHits).toBeGreaterThanOrEqual(136);
    expect(classifyHits(inputs.hits, LEGACY_WP_PRODUCT_MAP, LEGACY_PRODUCT_REDIRECTS).pdp).toBe(pdpHits);
  });

  it('middleware: 301 một chặng tới PDP của bản đồ, giữ utm/gclid/fbclid/ref, bỏ tham số riêng của WordPress', () => {
    const res = middleware(new NextRequest('https://tubutree.com/product/nuoc-giat-fuwa3e-10l/?utm_source=zalo&fbclid=F1&orderby=price&ref=CTV2', { headers: { host: 'tubutree.com' } }));
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://tubutree.com/san-pham/refill-nuoc-giat-cam-fuwa3e-10l-dc4433?utm_source=zalo&fbclid=F1&ref=CTV2');
    const feed = middleware(new NextRequest('https://tubutree.com/product/nuoc-nam-dong-trung-ha-thao/feed/', { headers: { host: 'tubutree.com' } }));
    expect(feed.status).toBe(301);
    expect(new URL(feed.headers.get('location')!).pathname).toBe('/san-pham/nuoc-dong-trung-ha-thao-hector-collagen-plus-dep-da-chong-lao-hoa-70ml-x-10-chai-d0c0e1');
  });
});

describe('scripts/ops/build-legacy-wp-product-map.mjs: hàm thuần', () => {
  const product = (slug: string, name: string, price = 100000) => ({ slug, name, basePrice: price, salePrice: null });

  it('volumes quy về ml/g, nhận dấu phẩy thập phân và số dính chữ; tokens bỏ dấu và chữ đóng gói', () => {
    expect(volumes('Nước rửa chén Fuwa3e 3,8L')).toEqual(['3800ml']);
    expect(volumes('sả chanh1L đuổi muỗi')).toEqual(['1000ml']);
    expect(volumes('Mật hoa dừa 1,4KG, 250G và 25gr, 30gam')).toEqual(['1400g', '250g', '25g', '30g']);
    expect(volumes('Nước giặt 500ml/ 100ml')).toEqual(['500ml', '100ml']);
    expect(volumes('Fuwa3e A01 3in1')).toEqual([]);
    expect(tokens('[Can 10L] Refill Nước giặt Bạc hà Fuwa3e')).toEqual(['nuoc', 'giat', 'bac', 'ha', 'fuwa3e']);
  });

  it('khớp chính xác theo tên hoặc slug bỏ hậu tố băm', () => {
    const catalog = [product('xit-tram-pineboo-150ml-abc123', 'Xịt tràm Pineboo 150ml'), product('ca-phe-muoi-c-sea-hop-16g-def456', 'Cà Phê Muối C&Sea Hộp 16g')];
    const { map, decisions } = buildProductMap({
      wpProducts: [{ slug: 'xit-tram-pineboo-150ml', name: 'Khác hẳn' }, { slug: 'ca-phe-muoi-csea', name: 'Cà Phê Muối C&Sea Hộp 16g' }],
      catalog,
    });
    expect(map).toEqual({ 'ca-phe-muoi-csea': 'ca-phe-muoi-c-sea-hop-16g-def456', 'xit-tram-pineboo-150ml': 'xit-tram-pineboo-150ml-abc123' });
    expect(decisions.every((d) => d.kind === 'exact')).toBe(true);
  });

  it(`điểm ${REVIEW_MIN}–${AUTO_MIN} chỉ vào danh sách cần duyệt, không vào bản đồ; sai dung tích hoặc khác loại sản phẩm bị loại`, () => {
    const catalog = [product('nuoc-rua-chen-x-300ml-aaaaaa', 'Nước rửa chén X 300ml'), product('nuoc-rua-tay-dang-gel-x-300ml-bbbbbb', 'Nước rửa tay dạng gel X 300ml'), product('xit-rua-tay-x-500ml-cccccc', 'Xịt rửa tay X 500ml')];
    const { map, decisions } = buildProductMap({ wpProducts: [{ slug: 'nuoc-rua-tay-x', name: 'Nước rửa tay X 300ml' }], catalog });
    expect(map).toEqual({});
    const d = decisions[0]!;
    expect(d.kind).toBe('review');
    expect(d.candidates.map((c) => c.slug)).not.toContain('xit-rua-tay-x-500ml-cccccc');
  });

  it('dòng PDP người đã duyệt không bị bản đồ ghi đè, kể cả khi tự động chọn khác', () => {
    const catalog = [product('nuoc-x-500ml-aaaaaa', 'Nước X 500ml'), product('nuoc-x-3-8l-bbbbbb', 'Nước X 3,8L')];
    const { map, decisions } = buildProductMap({ wpProducts: [{ slug: 'nuoc-x', name: 'Nước X 3.8L' }], catalog, curated: { 'nuoc-x': '/san-pham/nuoc-x-500ml-aaaaaa' } });
    expect(map).toEqual({});
    expect(decisions[0]).toMatchObject({ product: 'nuoc-x-3-8l-bbbbbb', curated: 'nuoc-x-500ml-aaaaaa' });
  });

  it('biến thể bị tách trang: tên cũ nhắc trước thắng; không nhắc thì giá trùng; không phân được thì cần người duyệt', () => {
    const scents = [product('refill-nuoc-giat-bac-ha-x-10l-aaaaaa', 'Refill nước giặt Bạc hà X 10L', 990000), product('refill-nuoc-giat-cam-x-10l-bbbbbb', 'Refill nước giặt Cam X 10L', 940000)];
    const byTitle = buildProductMap({ wpProducts: [{ slug: 'nuoc-giat-x-10l', name: '[Can 10L] Nước giặt X 10L hương cam/ bạc hà', attributes: [{ name: 'HƯƠNG', terms: ['BẠC HÀ', 'CAM'] }] }], catalog: scents });
    expect(byTitle.map).toEqual({ 'nuoc-giat-x-10l': 'refill-nuoc-giat-cam-x-10l-bbbbbb' });
    const byAttr = buildProductMap({ wpProducts: [{ slug: 'nuoc-giat-x-10l', name: 'Nước giặt X 10L', attributes: [{ name: 'HƯƠNG', terms: ['CAM', 'BẠC HÀ'] }] }], catalog: scents });
    expect(byAttr.map).toEqual({ 'nuoc-giat-x-10l': 'refill-nuoc-giat-cam-x-10l-bbbbbb' });
    const sauces = [
      { ...product('nuoc-tuong-mat-hoa-dua-zeta-cham-aaaaaa', 'Nước tương mật hoa dừa Zeta (chấm)', 86000), variations: [{ name: '5L', price: 820000 }] },
      { ...product('nuoc-tuong-mat-hoa-dua-zeta-nau-bbbbbb', 'Nước tương mật hoa dừa Zeta (nấu)', 110000), variations: [{ name: '5L', price: 710000 }] },
    ];
    const byPrice = buildProductMap({ wpProducts: [{ slug: 'nuoc-tuong-mat-hoa-dua-zeta-5l', name: 'Nước tương mật hoa dừa Zeta can 5L', price: 710000 }], catalog: sauces });
    expect(byPrice.map).toEqual({ 'nuoc-tuong-mat-hoa-dua-zeta-5l': 'nuoc-tuong-mat-hoa-dua-zeta-nau-bbbbbb' });
    expect(byPrice.decisions[0]).toMatchObject({ kind: 'variant', rule: 'giá trùng trang cũ' });
    const unresolved = buildProductMap({ wpProducts: [{ slug: 'nuoc-tuong-mat-hoa-dua-zeta-5l', name: 'Nước tương mật hoa dừa Zeta can 5L', price: 1 }], catalog: sauces });
    expect(unresolved.map).toEqual({});
    expect(unresolved.decisions[0]!.kind).toBe('tie');
  });

  it('slug chỉ thấy trong log (không có tên trang cũ) không tự vào bản đồ khi sản phẩm mới ghi dung tích', () => {
    const { map, decisions } = buildProductMap({ wpProducts: [], catalog: [product('lau-noi-that-o-to-x-300ml-aaaaaa', 'Lau nội thất ô tô X 300ml')], extraSlugs: ['lau-noi-that-o-to-x'] });
    expect(map).toEqual({});
    expect(decisions[0]).toMatchObject({ kind: 'review', candidates: [{ slug: 'lau-noi-that-o-to-x-300ml-aaaaaa', volumeUnverified: true }] });
  });

  it('slugsFromHits lấy phần đầu đường dẫn, bỏ đường dẫn kiểu tiêu đề mã hoá % và số trần', () => {
    expect(slugsFromHits({ 'a-b/feed': 1, 'Th%C3%A0nh%20Ph%E1%BA%A7n': 2, '1280': 1 }, { 'a-b': 1, 'c-1': 1 })).toEqual(['a-b', 'c-1']);
  });

  it('parseArgs: mặc định, đủ tuỳ chọn, và lỗi tham số', () => {
    expect(parseMapArgs([])).toMatchObject({ write: false, check: false, report: '' });
    expect(parseMapArgs(['--write', '--report', 'r.md', '--catalog', 'c.json'])).toMatchObject({ write: true, report: 'r.md', catalog: 'c.json' });
    expect(() => parseMapArgs(['--write', '--check'])).toThrow(/không dùng cùng/);
    expect(() => parseMapArgs(['--report'])).toThrow(/cần một giá trị/);
    expect(() => parseMapArgs(['--lạ'])).toThrow(/Tham số lạ/);
  });

  it('CLI --check thoát 0 trên bản đồ đang commit', () => {
    expect(() => execFileSync(process.execPath, [`${REPO}scripts/ops/build-legacy-wp-product-map.mjs`, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('chuyển hướng trang WordPress', () => {
  it('40 trang thật của sitemap: hoặc có luật, hoặc nằm trong danh sách trùng đường dẫn/đã có chủ', () => {
    expect(new Set(WP_PAGE_PATHS).size).toBe(40);
    for (const path of WP_PAGE_PATHS) {
      const known = resolveLegacyWpPath(`${path}/`) !== null || IDENTITY_PAGES.includes(path);
      expect(known, path).toBe(true);
    }
  });

  it('trang trùng đường dẫn web mới không có dòng chuyển hướng (tránh vòng lặp /gio-hang -> /gio-hang) và route đó có thật', () => {
    for (const path of IDENTITY_PAGES.filter((p) => p !== '/')) {
      expect(resolveLegacyWpPath(path), path).toBeNull();
      expect(ROUTE_DIRS.has(firstSegment(path)), path).toBe(true);
    }
  });

  it('đích của mọi dòng tồn tại trên web mới: thư mục route thật, chính sách đúng slug', () => {
    const destinations = new Set([...Object.values(LEGACY_PAGE_REDIRECTS), ...Object.values(LEGACY_PRODUCT_REDIRECTS)]);
    for (const to of destinations) {
      const url = targetUrl(to);
      if (url.pathname === '/') continue;
      expect(ROUTE_DIRS.has(firstSegment(url.pathname)), to).toBe(true);
      if (url.pathname.startsWith('/chinh-sach/')) expect(LEGAL_SLUGS as readonly string[], to).toContain(url.pathname.split('/')[2]);
    }
  });

  it('đích không phải cổng riêng tư (/dai-ly, /admin, /merchant): khách vãng lai không bị đẩy tới trang đăng nhập', () => {
    const privateHeads = ['dai-ly', 'admin', 'merchant', 'nhan-vien', 'chu-thuong-hieu', 'ctv'];
    for (const to of Object.values(LEGACY_PAGE_REDIRECTS)) expect(privateHeads, to).not.toContain(firstSegment(targetUrl(to).pathname));
  });

  it('không có chuỗi chuyển hướng: đích không phải nguồn của bảng này, của Mini App hay của danh mục', () => {
    const mapped = Object.values(LEGACY_WP_PRODUCT_MAP).map((slug) => `/san-pham/${slug}`);
    for (const to of [...Object.values(LEGACY_PAGE_REDIRECTS), ...Object.values(LEGACY_PRODUCT_REDIRECTS), ...mapped]) {
      const path = targetUrl(to).pathname;
      expect(resolveLegacyWpPath(path), to).toBeNull();
      expect(MINIAPP_REDIRECT_SOURCES.has(path), to).toBe(false);
    }
  });

  it('nguồn trùng nguồn chuyển hướng của Mini App (next.config chạy trước middleware) phải cùng đích, không thì luật ở đây là mã chết', () => {
    for (const [source, to] of Object.entries(LEGACY_PAGE_REDIRECTS)) {
      const config = MINIAPP_REDIRECT_SOURCES.get(source);
      if (config) expect(config, source).toBe(to);
    }
  });

  it('/cart, /checkout, /refill: bảng WordPress, luật Mini App và next.config cùng đích và đều là 301', () => {
    expect(new Set(MINIAPP_PERMANENT_SOURCES)).toEqual(new Set(WOOCOMMERCE_AND_MINIAPP_PATHS));
    const rules = buildMiniappRedirects(routeMap.routes);
    for (const path of WOOCOMMERCE_AND_MINIAPP_PATHS) {
      const to = LEGACY_PAGE_REDIRECTS[path];
      expect(to, path).toBeDefined();
      expect(rules.find((r: { source: string }) => r.source === path), path).toEqual({ source: path, destination: to, statusCode: 301 });
      expect(resolveLegacyWpPath(`${path}/`), path).toEqual({ kind: 'redirect', status: 301, location: to });
    }
    expect(locationOf('/refill/')).toBe('/doi-rac');
  });

  it('nguồn không đè route thật của web (trừ /product, nơi chỉ slug WordPress bị bắt)', () => {
    const heads = [...Object.keys(LEGACY_PAGE_REDIRECTS), ...LEGACY_GONE_PREFIXES, ...LEGACY_GONE_EXACT].map(firstSegment);
    for (const head of heads) expect(ROUTE_DIRS.has(head), head).toBe(false);
  });

  it('/shop, /cua-hang, phân trang và danh mục sản phẩm cũ đều về kệ hàng, không 404', () => {
    expect(locationOf('/shop/')).toBe('/san-pham');
    expect(locationOf('/cua-hang/')).toBe('/san-pham');
    expect(locationOf('/shop/page/3/')).toBe('/san-pham');
    expect(locationOf('/product-tag/organic/')).toBe('/san-pham');
    expect(locationOf('/product-category/')).toBe('/san-pham');
    expect(locationOf('/product-category/nuoc-giat-fuwa3e/')).toBe('/san-pham?q=fuwa3e');
    expect(locationOf('/product-category/po-lang/mat-na/')).toBe('/san-pham?q=po+lang');
    expect(locationOf('/product-category/danh-muc-la/')).toBe('/san-pham');
  });

  it('giỏ, thanh toán, tài khoản và trang con của WooCommerce', () => {
    expect(locationOf('/cart/')).toBe('/gio-hang');
    expect(locationOf('/checkout/')).toBe('/thanh-toan');
    expect(locationOf('/checkout/order-received/1234/')).toBe('/thanh-toan');
    expect(locationOf('/my-account/')).toBe('/tai-khoan');
    expect(locationOf('/my-account/lost-password/')).toBe('/tai-khoan');
    expect(locationOf('/my-account/wishlist/')).toBe('/tai-khoan/yeu-thich');
    expect(locationOf('/track-order/')).toBe('/tai-khoan/don-hang');
  });

  it('trang chính sách và giới thiệu cũ về trang tương ứng', () => {
    expect(locationOf('/chinh-sach-bao-mat/')).toBe('/chinh-sach/bao-mat');
    expect(locationOf('/doi-tra-hoan-tien/')).toBe('/chinh-sach/doi-tra');
    expect(locationOf('/phuong-thuc-van-chuyen/')).toBe('/chinh-sach/van-chuyen');
    expect(locationOf('/about-fuwa3e/')).toBe('/gioi-thieu');
    expect(locationOf('/lien-he/')).toBe('/gioi-thieu');
    expect(locationOf('/eco-enzyme/')).toBe('/cau-chuyen');
    expect(locationOf('/cau-chuyen-fuwa-3e/')).toBe('/cau-chuyen');
  });
});

describe('410 Gone cho nội dung mẫu của theme', () => {
  it('/elements/*, /demos/*, /blocks/*, /featured_item/* và trang nháp/thử', () => {
    for (const path of ['/elements/hotspot/', '/elements/', '/demos/shop-demo/', '/demos', '/blocks/shop-header/', '/featured_item/magazine/', '/draf-main-page/', '/test/']) {
      expect(resolveLegacyWpPath(path), path).toEqual({ kind: 'gone', status: 410 });
    }
  });

  it('không bắt nhầm đường dẫn chỉ giống tiền tố', () => {
    for (const path of ['/elements-ui', '/demosaic', '/blocksize/x', '/testing', '/test-kit/a']) {
      expect(resolveLegacyWpPath(path), path).toBeNull();
    }
  });
});

describe('resolveLegacyWpPath: chuẩn hoá và an toàn', () => {
  it('bỏ dấu / cuối, // thừa, chữ hoa; đường dẫn mã hoá % vẫn khớp', () => {
    const want = '/san-pham/xit-tram-cho-be-pineboo-150ml-b70d1d';
    for (const path of ['/product/xit-tram-cho-be-pineboo-150ml', '/product/xit-tram-cho-be-pineboo-150ml/', '//product//xit-tram-cho-be-pineboo-150ml//', '/Product/XIT-TRAM-CHO-BE-PINEBOO-150ML/', '/product/xit%2Dtram-cho-be-pineboo-150ml']) {
      expect(locationOf(path), path).toBe(want);
    }
  });

  it('đường dẫn mã hoá hỏng không ném lỗi', () => {
    expect(resolveLegacyWpPath('/product/%E0%A4%A')).toBeNull();
    expect(resolveLegacyWpPath('/%')).toBeNull();
  });

  it('trang chủ và đường dẫn của web mới đi thẳng', () => {
    for (const path of ['/', '', '/san-pham', '/san-pham/xit-tram-cho-be-pineboo-150ml-b70d1d', '/gio-hang', '/chinh-sach/bao-mat', '/s/ctv-an', '/admin', '/ctv']) {
      expect(resolveLegacyWpPath(path), path).toBeNull();
    }
  });

  it('bài blog, danh mục bài, thẻ, tác giả, feed chuyển 301 sang https://blog.tubutree.com/...; riêng ảnh /wp-content/uploads/* giữ nguyên (null) để Apache phục vụ 200 từ đĩa', () => {
    expect(BLOG_ORIGIN).toBe('https://blog.tubutree.com');
    expect(resolveLegacyWpPath('/2021/10/16/nuoc-rua-chen-organic/')).toEqual({
      kind: 'redirect',
      status: 301,
      location: 'https://blog.tubutree.com/2021/10/16/nuoc-rua-chen-organic/',
    });
    expect(resolveLegacyWpPath('/2021/10/16/nuoc-rua-chen-organic')).toEqual({
      kind: 'redirect',
      status: 301,
      location: 'https://blog.tubutree.com/2021/10/16/nuoc-rua-chen-organic/',
    });
    expect(resolveLegacyWpPath('/blog/')).toEqual({ kind: 'redirect', status: 301, location: 'https://blog.tubutree.com/blog/' });
    expect(resolveLegacyWpPath('/tag/nuoc-rua-chen/')).toEqual({ kind: 'redirect', status: 301, location: 'https://blog.tubutree.com/tag/nuoc-rua-chen/' });
    expect(resolveLegacyWpPath('/author/admin/')).toEqual({ kind: 'redirect', status: 301, location: 'https://blog.tubutree.com/author/admin/' });
    expect(resolveLegacyWpPath('/feed/')).toEqual({ kind: 'redirect', status: 301, location: 'https://blog.tubutree.com/feed/' });
    expect(resolveLegacyWpPath('/comments/feed/')).toEqual({ kind: 'redirect', status: 301, location: 'https://blog.tubutree.com/comments/feed/' });
    expect(resolveLegacyWpPath('/wp-json')).toEqual({ kind: 'redirect', status: 301, location: 'https://blog.tubutree.com/wp-json/' });
    expect(resolveLegacyWpPath('/wp-json/wp/v2/posts')).toEqual({ kind: 'redirect', status: 301, location: 'https://blog.tubutree.com/wp-json/wp/v2/posts' });
    expect(resolveLegacyWpPath('/wp-includes/js/x.js')).toEqual({ kind: 'redirect', status: 301, location: 'https://blog.tubutree.com/wp-includes/js/x.js' });
    expect(resolveLegacyWpPath('/wp-content/themes/flatsome/style.css')).toEqual({
      kind: 'redirect',
      status: 301,
      location: 'https://blog.tubutree.com/wp-content/themes/flatsome/style.css',
    });
    for (const cat of WP_CATEGORY_PATHS) {
      expect(resolveLegacyWpPath(cat), cat).toEqual({ kind: 'redirect', status: 301, location: `https://blog.tubutree.com${cat}` });
    }
    for (const upload of ['/wp-content/uploads', '/wp-content/uploads/', '/wp-content/uploads/2021/10/a.jpg']) {
      expect(resolveLegacyWpPath(upload), upload).toBeNull();
      expect(isWpUploadPath(upload), upload).toBe(true);
    }
  });
});

describe('carryLegacyParams', () => {
  it('chỉ giữ utm_*, gclid, fbclid, ref; bỏ khoá riêng của WordPress', () => {
    expect(carryLegacyParams('/san-pham', '?utm_source=fb&s=nuoc&add-to-cart=12&ref=ABC&gclid=g1&orderby=price')).toBe('/san-pham?utm_source=fb&ref=ABC&gclid=g1');
    expect(carryLegacyParams('/san-pham', '?s=nuoc&orderby=price')).toBe('/san-pham');
  });

  it('nối vào đích đã có query mà không đè khoá có sẵn và giữ dấu + của từ khoá', () => {
    expect(carryLegacyParams('/san-pham?q=po+lang', '?utm_campaign=tet&q=khac&ref=A')).toBe('/san-pham?q=po+lang&utm_campaign=tet&ref=A');
    expect(carryLegacyParams('/san-pham/x?ref=OLD', '?ref=NEW')).toBe('/san-pham/x?ref=OLD');
  });

  it('không có query thì giữ nguyên đích', () => {
    expect(carryLegacyParams('/san-pham?q=po+lang', '')).toBe('/san-pham?q=po+lang');
    expect(carryLegacyParams('/san-pham', '?')).toBe('/san-pham');
  });
});

describe('isWpBlogPath và isWpUploadPath', () => {
  it('isWpBlogPath nhận bài viết theo ngày, /blog, danh mục bài, thẻ, tác giả, feed và API/theme của WordPress, nhưng KHÔNG nhận /wp-content/uploads/*', () => {
    for (const path of ['/2021/10/16/nuoc-rua-chen-organic/', '/2026/03/01/bai-moi', '/blog', '/blog/trang-2/', '/tag/eco/', '/author/admin/', '/wp-content/themes/flatsome/style.css', '/wp-includes/js/x.js', '/wp-json/wp/v2/posts', '/feed/', '/comments/feed/', ...WP_CATEGORY_PATHS]) {
      expect(isWpBlogPath(path), path).toBe(true);
      expect(isWpUploadPath(path), path).toBe(false);
    }
    for (const upload of ['/wp-content/uploads/a.jpg', '/wp-content/uploads/2025/05/banner.webp']) {
      expect(isWpBlogPath(upload), upload).toBe(false);
      expect(isWpUploadPath(upload), upload).toBe(true);
    }
  });

  it('không nhận đường dẫn của web mới hay của bảng chuyển hướng sản phẩm/trang', () => {
    for (const path of ['/', '/san-pham', '/product/nap-diem/', '/shop/', '/cau-chuyen', '/2021', '/2021/10/16', '/categories', '/feedback', '/blogger']) {
      expect(isWpBlogPath(path), path).toBe(false);
      expect(isWpUploadPath(path), path).toBe(false);
    }
  });
});

describe('middleware: URL WordPress cũ', () => {
  const visit = (host: string, path: string, scheme = 'https') => middleware(new NextRequest(`${scheme}://${host}${path}`, { headers: { host } }));
  // Next 15 không nhận Location tương đối từ middleware (500), nên Location là URL tuyệt đối; so đường dẫn + query ở đây, so gốc ở ca riêng.
  const pathOf = (res: Response): string | null => {
    const location = res.headers.get('location');
    if (!location) return null;
    const url = new URL(location);
    return url.pathname + url.search;
  };

  it('301 sang trang mới trên apex, www, app và localhost, Location tuyệt đối trên đúng host khách gọi', () => {
    for (const host of ['tubutree.com', 'www.tubutree.com', 'app.tubutree.com', 'localhost:3000']) {
      const res = visit(host, '/product/xit-tram-cho-be-pineboo-150ml/');
      expect(res.status, host).toBe(301);
      expect(pathOf(res), host).toBe('/san-pham/xit-tram-cho-be-pineboo-150ml-b70d1d');
    }
  });

  it('URL WordPress có dấu / cuối đi MỘT chặng 301 thẳng tới đích (không 308 rồi 301), giữ cả utm và ref', () => {
    const cases: Array<[string, string]> = [
      ['/product/xit-tram-cho-be-pineboo-150ml/', '/san-pham/xit-tram-cho-be-pineboo-150ml-b70d1d'],
      ['/product/giam-mat-hoa-dua-huu-co-sokfarm-256ml/?utm_source=gg&ref=CTV9', '/san-pham?q=sokfarm&utm_source=gg&ref=CTV9'],
      ['/shop/', '/san-pham'],
      ['/cart/', '/gio-hang'],
      ['/checkout/', '/thanh-toan'],
      ['/refill/', '/doi-rac'],
      ['/my-account/orders/', '/tai-khoan/don-hang'],
    ];
    for (const [path, to] of cases) {
      const res = visit('tubutree.com', path);
      expect(res.status, path).toBe(301);
      expect(pathOf(res), path).toBe(to);
    }
  });

  it('mọi 91 slug sản phẩm WordPress có dấu / cuối đều 301 một chặng với Location là đích của bảng', () => {
    for (const slug of WP_PRODUCT_SLUGS) {
      const res = visit('tubutree.com', `/product/${slug}/`);
      expect(res.status, slug).toBe(301);
      expect(pathOf(res), slug).toBe(locationOf(`/product/${slug}`));
    }
  });

  it('/cart, /checkout, /refill không dấu / cuối cũng 301 (không 307) và không có chặng thứ hai', () => {
    for (const [path, to] of [['/cart', '/gio-hang'], ['/checkout', '/thanh-toan'], ['/refill', '/doi-rac']] as const) {
      const res = visit('tubutree.com', path);
      expect(res.status, path).toBe(301);
      expect(pathOf(res), path).toBe(to);
    }
  });

  it('/sitemap_index.xml (dấu chấm trong tên, có hoặc không dấu / cuối) 301 về /sitemap.xml, giữ utm', () => {
    for (const path of ['/sitemap_index.xml', '/sitemap_index.xml/', '/Sitemap_Index.xml']) {
      const res = visit('tubutree.com', path);
      expect(res.status, path).toBe(301);
      expect(pathOf(res), path).toBe('/sitemap.xml');
    }
    expect(pathOf(visit('www.tubutree.com', '/sitemap_index.xml?utm_source=gsc'))).toBe('/sitemap.xml?utm_source=gsc');
    expect(LEGACY_FILE_REDIRECTS['/sitemap_index.xml']).toBe('/sitemap.xml');
    expect(readdirSync(APP_DIR)).toContain('sitemap.ts');
  });

  it('/sitemap.xml của web mới và tệp tĩnh khác có dấu chấm đi thẳng; host gian hàng CTV không bị áp luật tệp', () => {
    for (const path of ['/sitemap.xml', '/robots.txt', '/wp-content/uploads/2025/05/a.png']) {
      const res = visit('tubutree.com', path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('location'), path).toBeNull();
    }
    expect(visit('ctv-an.tubutree.com', '/sitemap_index.xml').status).toBe(200);
  });

  it('đường dẫn không phải URL WordPress mà có dấu / cuối vẫn 308 về dạng không dấu như Next làm trước đây, giữ query', () => {
    const cases: Array<[string, string]> = [
      ['/san-pham/', '/san-pham'],
      ['/gio-hang/', '/gio-hang'],
      ['/san-pham/abc-123/?q=po+lang', '/san-pham/abc-123?q=po+lang'],
      ['/chinh-sach/bao-mat/', '/chinh-sach/bao-mat'],
      ['/product/slug-moi-cua-ctv/', '/product/slug-moi-cua-ctv'],
    ];
    for (const [path, to] of cases) {
      const res = visit('tubutree.com', path);
      expect(res.status, path).toBe(308);
      expect(pathOf(res), path).toBe(to);
    }
    expect(visit('tubutree.com', '/').status).toBe(200);
    expect(visit('ctv-an.tubutree.com', '/san-pham/').status).toBe(308);
  });

  it('Location do NextResponse.redirect dựng trên URL của chính request (Next 15 trả 500 nếu middleware tự viết Location tương đối; Next đổi Location cùng host thành tương đối khi gửi)', () => {
    for (const host of ['tubutree.com', 'www.tubutree.com', 'app.tubutree.com']) {
      expect(visit(host, '/shop/').headers.get('location'), host).toBe(`https://${host}/san-pham`);
    }
    expect(visit('localhost:3000', '/shop/', 'http').headers.get('location')).toBe('http://localhost:3000/san-pham');
    expect(visit('localhost:3000', '/san-pham/', 'http').headers.get('location')).toBe('http://localhost:3000/san-pham');
    expect(visit('tubutree.com', '/san-pham/?q=po+lang').headers.get('location')).toBe('https://tubutree.com/san-pham?q=po+lang');
  });

  it('bỏ dấu / cuối không bao giờ thành chuyển hướng sang host khác: //evil.com/ và /\\evil.com/ về đường dẫn cùng host', () => {
    for (const path of ['//evil.com/', '///evil.com//', '/\\evil.com/', '//evil.com/x/']) {
      const res = visit('tubutree.com', path);
      expect(res.status, path).toBe(308);
      expect(new URL(res.headers.get('location')!).origin, path).toBe('https://tubutree.com');
    }
  });

  it('410 kèm noindex cho trang demo, không có Location', () => {
    const res = visit('tubutree.com', '/elements/hotspot/');
    expect(res.status).toBe(410);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('location')).toBeNull();
  });

  it('giữ utm và mã giới thiệu CTV, bỏ tham số riêng của WordPress', () => {
    const res = visit('tubutree.com', '/shop/?utm_source=fb&s=nuoc&ref=CTV1');
    expect(res.status).toBe(301);
    expect(pathOf(res)).toBe('/san-pham?utm_source=fb&ref=CTV1');
  });

  it('cache ngắn để còn sửa bảng sau cutover', () => {
    expect(visit('tubutree.com', '/cua-hang').headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=86400');
  });

  it('host gian hàng CTV không bị áp luật WordPress', () => {
    for (const path of ['/shop', '/product/xit-tram-cho-be-pineboo-150ml', '/elements/hotspot']) {
      const res = visit('ctv-an.tubutree.com', path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('location'), path).toBeNull();
    }
  });

  it('bài blog WordPress qua middleware chuyển 301 thẳng sang https://blog.tubutree.com/... (giữ utm/ref, không qua chặng 308)', () => {
    const res = visit('tubutree.com', '/2021/10/16/nuoc-rua-chen-organic/?utm_source=fb&s=rac&ref=CTV1');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://blog.tubutree.com/2021/10/16/nuoc-rua-chen-organic/?utm_source=fb&ref=CTV1');
    expect(visit('ctv-an.tubutree.com', '/blog').status).toBe(200);
  });

  it('slug mới của route /product/[slug] (link CTV, Mini App) và trang web mới đi thẳng', () => {
    for (const path of ['/product/xit-tram-cho-be-pineboo-150ml-b70d1d', '/san-pham', '/gio-hang', '/tai-khoan', '/']) {
      const res = visit('tubutree.com', path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('location'), path).toBeNull();
    }
  });
});

describe('cấu hình cutover', () => {
  // Dòng SITE_URL của docker-compose.vietnix.yml do site.spec.ts canh.
  it('.env.production.example hướng dẫn biến NEXT_PUBLIC_SITE_URL', () => {
    expect(read('.env.production.example')).toContain('NEXT_PUBLIC_SITE_URL=');
  });

  it('vhost apex: HTTPS có HSTS không includeSubDomains/preload, cổng 80 giữ đường HTTP-01 acme-challenge, www và http về apex, khối 301 blog nằm trước `ProxyPass /`', () => {
    const vhost = read('ops/vietnix-vhost-apex.conf.cutover');
    expect(vhost).toContain('ServerName tubutree.com');
    expect(vhost).toContain('ServerName www.tubutree.com');
    expect(vhost).toContain('Alias /.well-known/acme-challenge/ /var/www/certbot/.well-known/acme-challenge/');
    expect(vhost).toContain('RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/');
    expect(vhost).toContain('RewriteRule ^(.*)$ https://tubutree.com$1 [L,R=301]');
    expect(vhost).toContain('Strict-Transport-Security "max-age=31536000"');
    const activeLines = vhost.split('\n').filter((line) => !line.trimStart().startsWith('#'));
    expect(activeLines.some((line) => /includeSubDomains|preload/.test(line))).toBe(false);
    expect(vhost).toContain('ProxyPass / http://127.0.0.1:14000/ ttl=30');
    const blogAt = vhost.indexOf('RewriteRule ^/([0-9]{4}/[0-9]{2}/[0-9]{2}/');
    expect(blogAt).toBeGreaterThan(-1);
    expect(blogAt).toBeLessThan(vhost.indexOf('ProxyPass / http://127.0.0.1:14000/'));
  });

  it('vhost apex: khối chuyển hướng blog 301 sang https://blog.tubutree.com phủ đúng nhóm đường dẫn của isWpBlogPath và không còn reverse proxy về 42.1.122.84', () => {
    const vhost = read('ops/vietnix-vhost-apex.conf.cutover');
    const activeLines = vhost.split('\n').filter((line) => !line.trimStart().startsWith('#'));
    const active = activeLines.join('\n');
    for (const prefix of ['blog', 'category', 'tag', 'author', 'wp-content', 'wp-includes', 'wp-json', 'feed']) {
      expect(active, prefix).toMatch(new RegExp(`\\b${prefix}\\b`));
    }
    expect(activeLines.some((line) => /^\s*RewriteRule .*https:\/\/blog\.tubutree\.com\/.*\[R=301,L\]/.test(line))).toBe(true);
    expect(activeLines.some((line) => /42\.1\.122\.84|SSLProxyEngine|ProxyPassMatch/.test(line))).toBe(false);
  });

  it('vhost apex: /wp-content/uploads/ phục vụ thẳng từ đĩa, chỉ đọc, chặn thực thi, không bị chuyển hướng sang blog, và đứng TRƯỚC `ProxyPass /`', () => {
    const vhost = read('ops/vietnix-vhost-apex.conf.cutover');
    const active = vhost.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
    const exclude = active.indexOf('ProxyPass /wp-content/uploads/ !');
    const dateMatch = active.indexOf('RewriteRule ^/([0-9]{4}');
    const wpContentRule = active.indexOf('RewriteRule ^/((?:wp-content|wp-includes)/');
    const next = active.indexOf('ProxyPass / http://127.0.0.1:14000/');
    expect(exclude).toBeGreaterThan(-1);
    expect(exclude).toBeLessThan(dateMatch);
    expect(exclude).toBeLessThan(wpContentRule);
    expect(wpContentRule).toBeLessThan(next);
    expect(active).toContain('RewriteCond %{REQUEST_URI} !^/wp-content/uploads(?:/|$)');
    expect(active).toContain('Alias /wp-content/uploads/ /www/wwwroot/tubutree.com/wp-content/uploads/');
    const dir = /<Directory "\/www\/wwwroot\/tubutree\.com\/wp-content\/uploads\/">([\s\S]*?)<\/Directory>/.exec(active)?.[1] ?? '';
    expect(dir).toContain('-Indexes');
    expect(dir).toContain('-ExecCGI');
    expect(dir).toContain('AllowOverride None');
    expect(dir).toMatch(/RemoveHandler[^\n]*\.php/);
    expect(dir).toMatch(/FilesMatch[^\n]*php[\s\S]*Require all denied/);
    expect(dir).toContain('X-Content-Type-Options "nosniff"');
  });

  it('8 sitemap con Rank Math và locations.kml: có luật 301 về /sitemap.xml hoặc 410, không còn 404 sau cutover', () => {
    const children = ['post-sitemap1', 'post-sitemap2', 'page-sitemap', 'product-sitemap', 'category-sitemap', 'blocks-sitemap', 'featured_item-sitemap', 'local-sitemap'];
    for (const name of children) {
      for (const path of [`/${name}.xml`, `/${name}.xml/`, `/${name.toUpperCase()}.XML`]) {
        expect(resolveLegacyWpPath(path), path).toEqual({ kind: 'redirect', status: 301, location: '/sitemap.xml' });
        const res = middleware(new NextRequest(`https://tubutree.com${path}`, { headers: { host: 'tubutree.com' } }));
        expect(res.status, path).toBe(301);
        expect(res.headers.get('location'), path).toMatch(/\/sitemap\.xml$/);
      }
    }
    expect(resolveLegacyWpPath('/locations.kml')).toEqual({ kind: 'gone', status: 410 });
    expect(middleware(new NextRequest('https://tubutree.com/locations.kml/', { headers: { host: 'tubutree.com' } })).status).toBe(410);
  });
});

describe('ops/cutover-apex-apply.sh, cutover-apex-http01.sh và cutover-apex-rollback.sh (chỉ đọc mã, KHÔNG chạy)', () => {
  const apply = read('ops/cutover-apex-apply.sh');
  const http01 = read('ops/cutover-apex-http01.sh');
  const phase1 = read('ops/vietnix-vhost-apex.conf.phase1');
  const rollback = read('ops/cutover-apex-rollback.sh');
  const code = (text: string) => text.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');

  it('cả ba chạy được (bit thực thi) và cú pháp bash hợp lệ', () => {
    for (const file of ['ops/cutover-apex-apply.sh', 'ops/cutover-apex-http01.sh', 'ops/cutover-apex-rollback.sh', 'scripts/ops/wp-public-export.mjs']) {
      expect(statSync(`${REPO}${file}`).mode & 0o111, file).not.toBe(0);
    }
    for (const file of ['ops/cutover-apex-apply.sh', 'ops/cutover-apex-http01.sh', 'ops/cutover-apex-rollback.sh']) {
      expect(() => execFileSync('bash', ['-n', `${REPO}${file}`]), file).not.toThrow();
    }
  });

  it('không bao giờ restart/stop Apache dùng chung với ChoDeli: chỉ configtest rồi graceful, và configtest đứng trước graceful', () => {
    for (const [name, text] of [['apply', apply], ['http01', http01], ['rollback', rollback]] as const) {
      const body = code(text);
      expect(body, name).not.toMatch(/apachectl[^\n]*\b(restart|stop|start)\b|systemctl|service\s+(httpd|apache)|httpd\s+-k\s+(stop|restart)|killall|pkill/i);
      expect(body.indexOf('-t 2>&1'), name).toBeGreaterThan(-1);
      expect(body.indexOf('-t 2>&1'), name).toBeLessThan(body.indexOf('-k graceful'));
    }
    expect(phase1).toContain('Alias /.well-known/acme-challenge/ /var/www/certbot/.well-known/acme-challenge/');
    expect(phase1).toContain('ProxyPass /wp-content/uploads/ !');
    expect(code(http01)).toContain('--webroot');
    expect(code(http01)).toContain('cutover-apex-apply.sh');
  });

  it('apply: mặc định chỉ kiểm, phải có --apply mới cài; kiểm đủ điều kiện trước khi đụng Apache; hỏng thì tự gọi rollback', () => {
    const body = code(apply);
    expect(body).toMatch(/APPLY=0/);
    expect(body.indexOf('if [ "$APPLY" = 0 ]')).toBeGreaterThan(-1);
    expect(body.indexOf('if [ "$APPLY" = 0 ]')).toBeLessThan(body.indexOf('install -m 600'));
    for (const needle of ['sha256sum -c', 'subjectAltName', 'checkend', 'CORS_ORIGINS', 'sitemap.xml', 'check-cutover-redirects.mjs', '--blog skip', '--blog proxy', '--host-header tubutree.com', 'cutover-apex-rollback.sh']) {
      expect(body, needle).toContain(needle);
    }
    expect(body).toContain('rollback_and_exit');
    expect((body.match(/rollback_and_exit "/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(body).not.toMatch(/certbot\s|docker\s+(compose|build|restart|stop|rm)|git\s+(push|pull)/);
  });

  it('rollback: trả đúng trạng thái trước khi cài, từ chối xoá tệp lạ nếu không có --force, và không xoá ảnh uploads', () => {
    const body = code(rollback);
    expect(body).toContain('PRE_EXISTED');
    expect(body).toContain('cmp -s "$TARGET" "$VHOST_SRC"');
    expect(body).toContain('--force');
    expect(body).not.toMatch(/rm\s+-[a-z]*r|wp-content|UPLOADS/);
  });
});

describe('scripts/ops/wp-public-export.mjs: hàm thuần', () => {
  it('safeUploadPath chỉ nhận đường dẫn con của /wp-content/uploads/, không thoát thư mục', () => {
    expect(safeUploadPath('/wp-content/uploads/2024/05/a.png')).toBe('2024/05/a.png');
    expect(safeUploadPath('/wp-content/uploads/2025/01/dao%C2%A7u-1.png')).toBe(`2025/01/dao${String.fromCharCode(0xa7)}u-1.png`);
    for (const bad of ['/wp-content/uploads/', '/wp-content/uploads/../../wp-config.php', '/wp-content/uploads/%2e%2e/x', '/wp-content/uploads/a//b.png', '/wp-content/uploads/./a.png', '/wp-content/themes/a.png', '/uploads/a.png', '/wp-content/uploads/%ZZ.png']) {
      expect(safeUploadPath(bad), bad).toBeNull();
    }
  });

  it('collectUploadPaths gom URL ảnh trong JSON/HTML, bỏ query và host lạ, hiểu cả JSON thô viết \\/', () => {
    const found = collectUploadPaths([
      { content: { rendered: '<img src="https://tubutree.com/wp-content/uploads/2024/05/a.png?x=1" srcset="https://tubutree.com/wp-content/uploads/2024/05/a-300x200.png 300w, https://www.tubutree.com/wp-content/uploads/2024/05/a-150x150.png 150w">' } },
      { link: 'https://evil.example/wp-content/uploads/2024/05/x.png' },
      { link: 'https://tubutree.com/wp-content/uploads/../../wp-config.php' },
    ]);
    collectUploadPaths(String.raw`{"guid":"http:\/\/tubutree.com\/wp-content\/uploads\/2020\/01\/b.jpg"}`, found);
    expect([...found].sort()).toEqual(['/wp-content/uploads/2020/01/b.jpg', '/wp-content/uploads/2024/05/a-150x150.png', '/wp-content/uploads/2024/05/a-300x200.png', '/wp-content/uploads/2024/05/a.png']);
  });

  it('parseArgs: mặc định, đủ tuỳ chọn, và lỗi tham số', () => {
    expect(parseExportArgs(['--out', '/b'])).toMatchObject({ out: '/b', uploadsDir: '', origin: 'https://tubutree.com', concurrency: 3, dryRun: false });
    expect(parseExportArgs(['--out', '/b', '--uploads-dir', '/u', '--resolve-ip', '42.1.122.84', '--concurrency', '5', '--delay-ms', '0', '--limit', '10', '--dry-run'])).toMatchObject({
      uploadsDir: '/u',
      resolveIp: '42.1.122.84',
      concurrency: 5,
      delayMs: 0,
      limit: 10,
      dryRun: true,
    });
    expect(() => parseExportArgs([])).toThrow(/--out/);
    expect(() => parseExportArgs(['--out', '/b', '--lạ'])).toThrow(/Tham số lạ/);
    expect(() => parseExportArgs(['--out', '/b', '--origin', 'khong-phai-url'])).toThrow(/--origin/);
    expect(() => parseExportArgs(['--out', '/b', '--limit', '-1'])).toThrow(/số nguyên/);
  });
});

describe('danh mục URL WordPress đang index (scripts/ops/data/wp-live-urls-20261114.txt): diễn tập N/N PASS qua middleware thật', () => {
  const inventory = read('scripts/ops/data/wp-live-urls-20261114.txt')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith('#'));
  const OWN_PATHS = new Set(['/', '/gio-hang/', '/tai-khoan/', '/thanh-toan/']);

  it('459 đường dẫn không trùng; mỗi URL hoặc có luật 301/410 (gồm cả 221 URL blog -> blog.tubutree.com), hoặc là trang của web mới', () => {
    expect(inventory).toHaveLength(459);
    expect(new Set(inventory).size).toBe(459);
    const unexplained = inventory.filter((line) => {
      const path = toPathAndSearch(line)?.path ?? '';
      return !resolveLegacyWpPath(path) && !OWN_PATHS.has(path);
    });
    expect(unexplained).toEqual([]);
  });

  it('đi theo TOÀN BỘ 459 URL bằng bộ kiểm thật: PASS hết (gồm 221 URL blog 301 sang https://blog.tubutree.com/...), đúng một chặng nội dung, 0 vòng lặp, 0 chuỗi 2 chặng', async () => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'https://tubutree.com');
      const out = middleware(new NextRequest(`https://tubutree.com${url.pathname}${url.search}`, { headers: { host: 'tubutree.com' } }));
      const location = out.headers.get('location')?.replace(/^https:\/\/tubutree\.com/, '');
      res.writeHead(out.status, location ? { location } : {});
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    try {
      const failures: string[] = [];
      let checked = 0;
      let blogRedirected = 0;
      for (const line of inventory) {
        const target = toPathAndSearch(line);
        if (!target) continue;
        const expected = expectedFor(resolveLegacyWpPath(target.path));
        const { steps, flags } = await walk({ base: `http://127.0.0.1:${port}`, path: target.path, search: target.search, timeout: 5000 });
        const verdict = classifyChain({ expected, steps, flags });
        checked += 1;
        if (isWpBlogPath(target.path)) blogRedirected += 1;
        if (verdict.verdict !== 'PASS') failures.push(`${line}: ${verdict.verdict} ${verdict.reason}`);
        if (expected.kind === 'redirect' && steps.filter((st) => st.next && st.status === 301).length !== 1) failures.push(`${line}: không đúng một chặng 301`);
      }
      expect(checked).toBe(459);
      expect(blogRedirected).toBe(221);
      expect(failures).toEqual([]);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('--host-header: bộ kiểm gửi Host của tên miền thật tới cổng Next (127.0.0.1:14000) thay vì host của --base', async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(String(req.headers.host));
      res.writeHead(200);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const { port } = server.address() as AddressInfo;
    try {
      await walk({ base: `http://127.0.0.1:${port}`, hostHeader: 'tubutree.com', path: '/', timeout: 3000 });
      await walk({ base: `http://127.0.0.1:${port}`, path: '/', timeout: 3000 });
      expect(seen).toEqual(['tubutree.com', `127.0.0.1:${port}`]);
      expect(parseArgs(['--base', 'http://127.0.0.1:14000', '--host-header', 'tubutree.com']).hostHeader).toBe('tubutree.com');
      expect(() => parseArgs(['--host-header'])).toThrow(/cần một giá trị/);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});

describe('scripts/ops/check-cutover-redirects.mjs: hàm thuần', () => {
  const step = (status: number, path: string, next: { path: string; search?: string } | null, search = ''): ChainStep => ({
    status,
    path,
    search,
    next: next ? { origin: 'https://tubutree.com', path: next.path, search: next.search ?? '' } : null,
  });
  it('parseSitemapLocs lấy <loc>, bỏ <image:loc>, đổi &amp;', () => {
    const xml = '<urlset><url><loc>https://tubutree.com/product/a/</loc><image:image><image:loc>https://tubutree.com/wp-content/a.jpg</image:loc></image:image></url><url><loc> https://tubutree.com/shop/?a=1&amp;b=2 </loc></url></urlset>';
    expect(parseSitemapLocs(xml)).toEqual(['https://tubutree.com/product/a/', 'https://tubutree.com/shop/?a=1&b=2']);
  });

  it('toPathAndSearch nhận URL tuyệt đối và đường dẫn, từ chối chuỗi khác', () => {
    expect(toPathAndSearch('https://tubutree.com/shop/?x=1')).toEqual({ path: '/shop/', search: '?x=1' });
    expect(toPathAndSearch('/shop/')).toEqual({ path: '/shop/', search: '' });
    expect(toPathAndSearch('shop')).toBeNull();
    expect(toPathAndSearch('  ')).toBeNull();
  });

  it('301 một chặng tới đúng đích và đích 200: PASS', () => {
    const steps = [step(301, '/shop/', { path: '/san-pham' }), step(200, '/san-pham', null)];
    expect(classifyChain({ expected: redirectTo('/san-pham'), steps })).toEqual({ verdict: 'PASS', reason: '301', notes: [] });
  });

  it('URL WordPress phải bỏ dấu / cuối bằng 308 rồi mới 301 (hoặc 410) là FAIL: cần một chặng; URL không có luật bỏ dấu / là bình thường', () => {
    const two = [step(308, '/shop/', { path: '/shop' }), step(301, '/shop', { path: '/san-pham' }), step(200, '/san-pham', null)];
    expect(classifyChain({ expected: redirectTo('/san-pham'), steps: two })).toMatchObject({ verdict: 'FAIL', reason: expect.stringContaining('chuỗi 2 chặng') });
    const gone = [step(308, '/elements/a/', { path: '/elements/a' }), step(410, '/elements/a', null)];
    expect(classifyChain({ expected: { kind: 'gone' }, steps: gone })).toMatchObject({ verdict: 'FAIL', reason: expect.stringContaining('410') });
    const plain = [step(308, '/gio-hang/', { path: '/gio-hang' }), step(200, '/gio-hang', null)];
    expect(classifyChain({ expected: { kind: 'none' }, steps: plain })).toEqual({ verdict: 'PASS', reason: '200', notes: ['1 chặng bỏ dấu /'] });
  });

  it('chuyển hướng tạm thời là WARN; sai đích, chuỗi hai chặng, đích 404, không chuyển hướng là FAIL', () => {
    const base = [step(307, '/cart', { path: '/gio-hang' }), step(200, '/gio-hang', null)];
    expect(classifyChain({ expected: redirectTo('/gio-hang'), steps: base }).verdict).toBe('WARN');
    expect(classifyChain({ expected: redirectTo('/san-pham'), steps: [step(301, '/x', { path: '/khac' }), step(200, '/khac', null)] }).reason).toContain('sai đích');
    expect(classifyChain({ expected: redirectTo('/b'), steps: [step(301, '/a', { path: '/b' }), step(301, '/b', { path: '/c' }), step(200, '/c', null)] }).reason).toContain('chuỗi 2 chặng');
    expect(classifyChain({ expected: redirectTo('/c'), steps: [step(301, '/a', { path: '/c' }), step(404, '/c', null)] }).reason).toBe('đích trả 404');
    expect(classifyChain({ expected: redirectTo('/c'), steps: [step(200, '/a', null)] }).reason).toContain('không chuyển hướng');
  });

  it('so đích theo cả query, bỏ qua dấu / cuối', () => {
    const ok = [step(301, '/p', { path: '/san-pham', search: '?q=po+lang' }), step(200, '/san-pham', null, '?q=po+lang')];
    expect(classifyChain({ expected: redirectTo('/san-pham?q=po+lang'), steps: ok }).verdict).toBe('PASS');
    expect(classifyChain({ expected: redirectTo('/san-pham?q=visante'), steps: ok }).verdict).toBe('FAIL');
    expect(classifyChain({ expected: redirectTo('/san-pham/'), steps: [step(301, '/p', { path: '/san-pham' }), step(200, '/san-pham', null)] }).verdict).toBe('PASS');
  });

  it('410: PASS khi đúng 410 không chuyển hướng; FAIL khi 200, 404 hoặc bị chuyển hướng', () => {
    expect(classifyChain({ expected: { kind: 'gone' }, steps: [step(410, '/elements/a', null)] }).verdict).toBe('PASS');
    expect(classifyChain({ expected: { kind: 'gone' }, steps: [step(200, '/elements/a', null)] }).reason).toBe('mong 410, nhận 200');
    expect(classifyChain({ expected: { kind: 'gone' }, steps: [step(404, '/elements/a', null)] }).verdict).toBe('FAIL');
    expect(classifyChain({ expected: { kind: 'gone' }, steps: [step(301, '/elements/a', { path: '/' }), step(200, '/', null)] }).verdict).toBe('FAIL');
  });

  it('URL không có luật: 2xx là PASS, bị chuyển hướng hay 404 là FAIL', () => {
    expect(classifyChain({ expected: { kind: 'none' }, steps: [step(200, '/gio-hang', null)] }).verdict).toBe('PASS');
    expect(classifyChain({ expected: { kind: 'none' }, steps: [step(404, '/la', null)] }).verdict).toBe('FAIL');
    expect(classifyChain({ expected: { kind: 'none' }, steps: [step(301, '/la', { path: '/khac' }), step(200, '/khac', null)] }).verdict).toBe('FAIL');
  });

  it('lỗi mạng, vòng lặp, sang origin khác, quá nhiều chặng đều FAIL', () => {
    expect(classifyChain({ expected: { kind: 'none' }, steps: [step(0, '/a', null)] }).reason).toContain('lỗi mạng');
    expect(classifyChain({ expected: { kind: 'none' }, steps: [step(301, '/a', { path: '/b' })], flags: { loop: true } }).reason).toContain('vòng lặp');
    expect(classifyChain({ expected: { kind: 'none' }, steps: [step(301, '/a', { path: '/b' })], flags: { external: true } }).reason).toContain('origin khác');
    expect(classifyChain({ expected: { kind: 'none' }, steps: [step(301, '/a', { path: '/b' })], flags: { tooMany: true } }).reason).toContain('quá');
  });

  it('expectedFor đổi kết quả của bảng sang kỳ vọng', () => {
    expect(expectedFor(null)).toEqual({ kind: 'none' });
    expect(expectedFor({ kind: 'gone' })).toEqual({ kind: 'gone' });
    expect(expectedFor({ kind: 'redirect', location: '/san-pham' })).toEqual({ kind: 'redirect', location: '/san-pham' });
  });

  it('parseArgs: mặc định, đủ tuỳ chọn, và lỗi tham số', () => {
    expect(parseArgs([])).toMatchObject({ base: 'https://app.tubutree.com', blog: 'skip', method: 'HEAD', concurrency: 4, strict: false });
    expect(parseArgs(['--base', 'https://tubutree.com', '--resolve-ip', '14.225.207.177', '--sitemap', 'a.xml', '--sitemap', 'b.xml', '--blog', 'proxy', '--method', 'get', '--concurrency', '2', '--strict', '--json'])).toMatchObject({
      base: 'https://tubutree.com',
      resolveIp: '14.225.207.177',
      sitemaps: ['a.xml', 'b.xml'],
      blog: 'proxy',
      method: 'GET',
      concurrency: 2,
      strict: true,
      json: true,
    });
    expect(() => parseArgs(['--lạ'])).toThrow(/Tham số lạ/);
    expect(() => parseArgs(['--base'])).toThrow(/cần một giá trị/);
    expect(() => parseArgs(['--blog', 'x'])).toThrow(/--blog/);
    expect(() => parseArgs(['--base', 'khong-phai-url'])).toThrow(/--base/);
    expect(() => parseArgs(['--timeout', '-5'])).toThrow(/số nguyên/);
  });
});

describe('scripts/ops/check-cutover-redirects.mjs: đi theo chuyển hướng thật qua middleware', () => {
  // Máy chủ giả: next.config đặt skipTrailingSlashRedirect nên Next KHÔNG bỏ dấu / cuối trước middleware; middleware của web trả lời mọi đường dẫn (kể cả 308 bỏ dấu /); trang không bị chặn trả 200.
  function startFakeSite(extra?: (path: string) => { status: number; location?: string } | null): Promise<{ base: string; close: () => Promise<void> }> {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://app.tubutree.com');
      const special = extra?.(url.pathname);
      if (special) {
        res.writeHead(special.status, special.location ? { location: special.location } : {});
        res.end();
        return;
      }
      const out = middleware(new NextRequest(`http://app.tubutree.com${url.pathname}${url.search}`, { headers: { host: 'app.tubutree.com' } }));
      // Location dựng trên URL của request (http://app.tubutree.com); Next thật đổi nó thành tương đối trước khi gửi (đã kiểm bằng next dev), nên ở đây chỉ giữ đường dẫn.
      const location = out.headers.get('location')?.replace(/^http:\/\/app\.tubutree\.com/, '');
      res.writeHead(out.status, location ? { location } : {});
      res.end();
    });
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(() => done())) });
      });
    });
  }

  it('91 URL sản phẩm, mọi trang và tệp trong bảng, kèm dấu / cuối như WordPress: PASS hết và đúng MỘT chặng (không chặng bỏ dấu /)', async () => {
    const site = await startFakeSite();
    try {
      const paths = [
        ...Object.keys(LEGACY_PAGE_REDIRECTS),
        ...Object.keys(LEGACY_FILE_REDIRECTS),
        ...WP_PRODUCT_SLUGS.map((s) => `/product/${s}`),
        '/elements/hotspot',
        '/demos/x',
        '/product-category/fuwa3e',
      ].map((p) => `${p}/`);
      expect(paths.length).toBeGreaterThan(120);
      const failures: string[] = [];
      for (const path of paths) {
        const expected = expectedFor(resolveLegacyWpPath(path));
        const { steps, flags } = await walk({ base: site.base, path, timeout: 5000 });
        const verdict = classifyChain({ expected, steps, flags });
        if (verdict.verdict !== 'PASS') failures.push(`${path}: ${verdict.verdict} ${verdict.reason}`);
        if (verdict.notes.length > 0) failures.push(`${path}: còn chặng bỏ dấu /: ${verdict.notes.join(', ')}`);
        expect(steps[0]?.status, path).toBe(expected.kind === 'gone' ? 410 : 301);
      }
      expect(failures).toEqual([]);
    } finally {
      await site.close();
    }
  });

  it('đường dẫn của web mới có dấu / cuối vẫn về dạng không dấu bằng 308 rồi 200: PASS, chỉ ghi chú chặng bỏ dấu /', async () => {
    const site = await startFakeSite();
    try {
      const { steps, flags } = await walk({ base: site.base, path: '/gio-hang/', timeout: 5000 });
      expect(classifyChain({ expected: { kind: 'none' }, steps, flags })).toEqual({ verdict: 'PASS', reason: '200', notes: ['1 chặng bỏ dấu /'] });
      expect(steps[0]?.status).toBe(308);
    } finally {
      await site.close();
    }
  });

  it('bắt được đích sai, vòng lặp và chuỗi hai chặng', async () => {
    const site = await startFakeSite((path) => {
      if (path === '/loop-a') return { status: 301, location: '/loop-b' };
      if (path === '/loop-b') return { status: 301, location: '/loop-a' };
      if (path === '/chain-a') return { status: 301, location: '/chain-b' };
      if (path === '/chain-b') return { status: 301, location: '/san-pham' };
      return null;
    });
    try {
      const loop = await walk({ base: site.base, path: '/loop-a', timeout: 5000 });
      expect(classifyChain({ expected: { kind: 'none' }, steps: loop.steps, flags: loop.flags }).reason).toContain('vòng lặp');

      const chain = await walk({ base: site.base, path: '/chain-a', timeout: 5000 });
      expect(classifyChain({ expected: redirectTo('/chain-b'), steps: chain.steps, flags: chain.flags }).reason).toContain('chuỗi 2 chặng');

      const wrong = await walk({ base: site.base, path: '/shop/', timeout: 5000 });
      expect(classifyChain({ expected: redirectTo('/san-pham?q=khac'), steps: wrong.steps, flags: wrong.flags }).reason).toContain('sai đích');
    } finally {
      await site.close();
    }
  });

  it('chuyển sang origin khác bị gắn cờ external; máy chủ không nghe trả status 0', async () => {
    const site = await startFakeSite((path) => (path === '/ra-ngoai' ? { status: 301, location: 'https://tubutree.com/san-pham' } : null));
    try {
      const out = await walk({ base: site.base, path: '/ra-ngoai', timeout: 5000 });
      expect(out.flags.external).toBe(true);
      expect(classifyChain({ expected: { kind: 'none' }, steps: out.steps, flags: out.flags }).verdict).toBe('FAIL');
    } finally {
      await site.close();
    }
    const dead = await walk({ base: site.base, path: '/', timeout: 1000 });
    expect(dead.steps[0]?.status).toBe(0);
  });
});
