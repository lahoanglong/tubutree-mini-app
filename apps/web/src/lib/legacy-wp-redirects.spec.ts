// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import routeMap from '@tubutree/app-core/route-map.json';
import { PROD_CATALOG_2026_11_12 } from '@tubutree/app-core/commerce/prod-catalog-full.fixture';
import { classifyChain, expectedFor, parseArgs, parseSitemapLocs, toPathAndSearch, walk, type ChainStep } from '../../../../scripts/ops/check-cutover-redirects.mjs';
import { LEGAL_SLUGS } from '@/lib/legal';
import { middleware } from '../middleware';
import { buildMiniappRedirects } from './miniapp-redirects.mjs';
import {
  LEGACY_GONE_EXACT,
  LEGACY_GONE_PREFIXES,
  LEGACY_PAGE_REDIRECTS,
  LEGACY_PRODUCT_REDIRECTS,
  carryLegacyParams,
  isWpBlogPath,
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

// Trang WordPress không cần dòng ở bảng: trùng đúng đường dẫn web mới (Next tự bỏ dấu / cuối), hoặc đã có chủ khác chạy trước middleware.
const IDENTITY_PAGES = ['/', '/gio-hang', '/thanh-toan', '/tai-khoan'];
const OWNED_BY_NEXT_CONFIG = ['/refill'];

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

describe('chuyển hướng trang WordPress', () => {
  it('40 trang thật của sitemap: hoặc có luật, hoặc nằm trong danh sách trùng đường dẫn/đã có chủ', () => {
    expect(new Set(WP_PAGE_PATHS).size).toBe(40);
    for (const path of WP_PAGE_PATHS) {
      const known = resolveLegacyWpPath(`${path}/`) !== null || IDENTITY_PAGES.includes(path) || OWNED_BY_NEXT_CONFIG.includes(path);
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
    for (const to of [...Object.values(LEGACY_PAGE_REDIRECTS), ...Object.values(LEGACY_PRODUCT_REDIRECTS)]) {
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
    for (const path of OWNED_BY_NEXT_CONFIG) expect(MINIAPP_REDIRECT_SOURCES.has(path), path).toBe(true);
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

  it('bài blog, danh mục bài và ảnh WordPress không bị chuyển hướng (giai đoạn 1 để reverse proxy)', () => {
    for (const path of ['/2021/10/16/nuoc-rua-chen-organic/', '/blog/', '/wp-content/uploads/2021/10/a.jpg', ...WP_CATEGORY_PATHS]) {
      expect(resolveLegacyWpPath(path), path).toBeNull();
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

describe('isWpBlogPath', () => {
  it('nhận bài viết theo ngày, /blog, danh mục bài, ảnh và API của WordPress', () => {
    for (const path of ['/2021/10/16/nuoc-rua-chen-organic/', '/2026/03/01/bai-moi', '/blog', '/blog/trang-2/', '/tag/eco/', '/author/admin/', '/wp-content/uploads/a.jpg', '/wp-includes/js/x.js', '/wp-json/wp/v2/posts', '/feed/', '/comments/feed/', ...WP_CATEGORY_PATHS]) {
      expect(isWpBlogPath(path), path).toBe(true);
    }
  });

  it('không nhận đường dẫn của web mới hay của bảng chuyển hướng', () => {
    for (const path of ['/', '/san-pham', '/product/nap-diem/', '/shop/', '/cau-chuyen', '/2021', '/2021/10/16', '/categories', '/feedback', '/blogger']) {
      expect(isWpBlogPath(path), path).toBe(false);
    }
  });
});

describe('middleware: URL WordPress cũ', () => {
  const visit = (host: string, path: string) => middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));

  it('301 sang trang mới trên apex, www, app và localhost, Location tương đối', () => {
    for (const host of ['tubutree.com', 'www.tubutree.com', 'app.tubutree.com', 'localhost:3000']) {
      const res = visit(host, '/product/xit-tram-cho-be-pineboo-150ml/');
      expect(res.status, host).toBe(301);
      expect(res.headers.get('location'), host).toBe('/san-pham/xit-tram-cho-be-pineboo-150ml-b70d1d');
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
    expect(res.headers.get('location')).toBe('/san-pham?utm_source=fb&ref=CTV1');
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

  it('vhost apex: HTTPS có HSTS không includeSubDomains/preload, www và http về apex, khối proxy blog nằm trước `ProxyPass /`', () => {
    const vhost = read('ops/vietnix-vhost-apex.conf.cutover');
    expect(vhost).toContain('ServerName tubutree.com');
    expect(vhost).toContain('ServerName www.tubutree.com');
    expect(vhost).toContain('RewriteRule ^(.*)$ https://tubutree.com$1 [L,R=301]');
    expect(vhost).toContain('Strict-Transport-Security "max-age=31536000"');
    const activeLines = vhost.split('\n').filter((line) => !line.trimStart().startsWith('#'));
    expect(activeLines.some((line) => /includeSubDomains|preload/.test(line))).toBe(false);
    expect(vhost).toContain('ProxyPass / http://127.0.0.1:14000/ ttl=30');
    const blogAt = vhost.indexOf('ProxyPassMatch "^/([0-9]{4}/[0-9]{2}/[0-9]{2}/');
    expect(blogAt).toBeGreaterThan(-1);
    expect(blogAt).toBeLessThan(vhost.indexOf('ProxyPass / http://127.0.0.1:14000/'));
  });

  it('vhost apex: khối proxy tuỳ chọn phủ đúng nhóm đường dẫn mà isWpBlogPath coi là blog, và đang tắt (comment) theo mặc định', () => {
    const vhost = read('ops/vietnix-vhost-apex.conf.cutover');
    for (const prefix of ['blog', 'category', 'tag', 'author', 'wp-content', 'wp-includes', 'wp-json', 'feed']) {
      expect(vhost, prefix).toMatch(new RegExp(`\\(\\?:[a-z|\\-/]*\\b${prefix}\\b`));
    }
    const active = vhost.split('\n').filter((line) => !line.trimStart().startsWith('#'));
    expect(active.some((line) => /ProxyPassMatch|SSLProxyEngine/.test(line))).toBe(false);
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

  it('301 một chặng tới đúng đích và đích 200: PASS (chặng bỏ dấu / chỉ ghi chú)', () => {
    const steps = [step(308, '/shop/', { path: '/shop' }), step(301, '/shop', { path: '/san-pham' }), step(200, '/san-pham', null)];
    expect(classifyChain({ expected: redirectTo('/san-pham'), steps })).toEqual({ verdict: 'PASS', reason: '301', notes: ['1 chặng bỏ dấu /'] });
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
  // Máy chủ giả: Next bỏ dấu / cuối bằng 308 trước middleware, rồi middleware của web trả lời; trang không bị chặn trả 200.
  function startFakeSite(extra?: (path: string) => { status: number; location?: string } | null): Promise<{ base: string; close: () => Promise<void> }> {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://app.tubutree.com');
      const special = extra?.(url.pathname);
      if (special) {
        res.writeHead(special.status, special.location ? { location: special.location } : {});
        res.end();
        return;
      }
      if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
        res.writeHead(308, { location: url.pathname.replace(/\/+$/, '') + url.search });
        res.end();
        return;
      }
      const out = middleware(new NextRequest(`http://app.tubutree.com${url.pathname}${url.search}`, { headers: { host: 'app.tubutree.com' } }));
      const location = out.headers.get('location');
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

  it('91 URL sản phẩm và mọi trang trong bảng, kèm dấu / cuối như WordPress: PASS hết, chỉ một chặng nội dung', async () => {
    const site = await startFakeSite();
    try {
      const paths = [...Object.keys(LEGACY_PAGE_REDIRECTS), ...WP_PRODUCT_SLUGS.map((s) => `/product/${s}`), '/elements/hotspot', '/demos/x', '/gio-hang', '/product-category/fuwa3e'].map((p) => `${p}/`);
      expect(paths.length).toBeGreaterThan(120);
      const failures: string[] = [];
      for (const path of paths) {
        const expected = expectedFor(resolveLegacyWpPath(path));
        const { steps, flags } = await walk({ base: site.base, path, timeout: 5000 });
        const verdict = classifyChain({ expected, steps, flags });
        if (verdict.verdict !== 'PASS') failures.push(`${path}: ${verdict.verdict} ${verdict.reason}`);
      }
      expect(failures).toEqual([]);
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
