/**
 * Bảng chuyển hướng từ URL WordPress/WooCommerce cũ của tubutree.com sang web mới (giai đoạn chuẩn bị cutover, chưa đổi DNS).
 *
 * Nguồn số liệu: sitemap Rank Math công khai đo ngày 13/11/2026: 91 sản phẩm `/product/<slug>/`, 40 trang thật, 67 trang demo của theme
 * (`/elements/*`, `/demos/*`), cộng `/blocks/*` và `/featured_item/*` cũng là nội dung mẫu của theme. 200 bài blog `/YYYY/MM/DD/<slug>/` và ảnh
 * `/wp-content/*` KHÔNG nằm ở đây: web mới không có blog, phương án giai đoạn 1 là reverse proxy các đường dẫn đó về origin WordPress
 * (ops/vietnix-vhost-apex.conf.cutover); `isWpBlogPath` chỉ để script kiểm và spec biết nhóm này không phải chuyển hướng.
 *
 * Quy ước:
 * - Không bao giờ để một URL sản phẩm WordPress rơi vào 404: slug khớp rõ thì sang `/san-pham/<slug mới>`, không khớp rõ thì sang
 *   `/san-pham?q=<từ khoá>` (tìm không dấu của API), sản phẩm đã ngừng hẳn thì sang `/san-pham`.
 * - Chỉ khớp slug khi cùng dòng sản phẩm, cùng thương hiệu và không mơ hồ về quy cách/mùi hương; còn lại để người duyệt tay (ma trận trong
 *   `legacy-wp-redirects.spec.ts` kiểm từng đích có thật trong ảnh chụp catalog 12/11/2026).
 * - Các trang trùng đúng đường dẫn web mới (`/gio-hang`, `/thanh-toan`, `/tai-khoan`) không có dòng ở đây: middleware bỏ dấu `/` cuối bằng 308.
 * - Dấu `/` cuối của URL WordPress KHÔNG tốn thêm một chặng: `next.config.mjs` đặt `skipTrailingSlashRedirect`, middleware thấy nguyên đường dẫn
 *   và 301 thẳng tới đích. `/cart`, `/checkout`, `/refill` còn có luật cùng đích ở next.config redirects của Mini App (chạy trước middleware, cũng 301).
 * - `/sitemap_index.xml` (Rank Math) có dòng trong `LEGACY_FILE_REDIRECTS` để Search Console không gặp 404 sau cutover; middleware phải xét nó
 *   TRƯỚC luật bỏ qua đường dẫn có dấu chấm.
 *
 * Tệp này cố ý không import gì và chỉ dùng cú pháp TypeScript xoá được, để `scripts/ops/check-cutover-redirects.mjs` nạp thẳng bằng Node.
 */

export type LegacyResolution = { kind: 'redirect'; status: 301; location: string } | { kind: 'gone'; status: 410 };

const q = (keywords: string): string => `/san-pham?q=${encodeURIComponent(keywords).replace(/%20/g, '+')}`;
const pdp = (slug: string): string => `/san-pham/${slug}`;
const ALL = '/san-pham';

/** Trang thật của WordPress (đường dẫn đã bỏ dấu `/` cuối, chữ thường) -> đích trên web mới. */
export const LEGACY_PAGE_REDIRECTS: Readonly<Record<string, string>> = {
  '/home': '/',
  '/dang-ky-thanh-cong': '/',
  '/shop': ALL,
  '/cua-hang': ALL,
  '/cart': '/gio-hang',
  '/checkout': '/thanh-toan',
  '/refill': '/doi-rac',
  '/my-account': '/tai-khoan',
  '/my-account/wishlist': '/tai-khoan/yeu-thich',
  '/my-account/orders': '/tai-khoan/don-hang',
  '/my-account/edit-address': '/tai-khoan/dia-chi',
  '/my-account/edit-account': '/tai-khoan/ho-so',
  '/track-order': '/tai-khoan/don-hang',
  '/chinh-sach-bao-mat': '/chinh-sach/bao-mat',
  '/doi-tra-hoan-tien': '/chinh-sach/doi-tra',
  '/phuong-thuc-van-chuyen': '/chinh-sach/van-chuyen',
  // Chưa có trang riêng cho các nội dung dưới đây; điều khoản là nơi gần nghĩa nhất cho tới khi chủ quyết giữ hay bỏ.
  '/phuong-thuc-thanh-toan': '/chinh-sach/dieu-khoan',
  '/chinh-sach-ban-hang': '/chinh-sach/dieu-khoan',
  '/huong-dan-mua-hang': '/gioi-thieu',
  // /dai-ly là cổng riêng tư của đại lý, không dùng làm đích cho khách vãng lai.
  '/chinh-sach-dai-ly': '/gioi-thieu',
  '/chinh-sach-ban-hang/danh-sach-dai-ly-toan-quoc': '/gioi-thieu',
  '/about-fuwa3e': '/gioi-thieu',
  '/ho-so-nang-luc': '/gioi-thieu',
  '/lich-su-hinh-thanh': '/gioi-thieu',
  '/kiem-dinh-chat-luong': '/gioi-thieu',
  '/cong-bo-tccs': '/gioi-thieu',
  '/hoat-dong-ban-hang': '/gioi-thieu',
  '/giai-thuong': '/gioi-thieu',
  '/lien-he': '/gioi-thieu',
  '/lien-he-2': '/gioi-thieu',
  '/cau-chuyen-fuwa-3e': '/cau-chuyen',
  '/qua-trinh-san-xuat-fuwa3e': '/cau-chuyen',
  '/eco-enzyme': '/cau-chuyen',
  '/eco-enzyme-fuwa3e': '/cau-chuyen',
  '/car-fresh': q('o to'),
  '/fuwa3e-x-fundiin': q('fuwa3e'),
  '/combo-qua-tet-2023': q('combo'),
};

/** Tệp WordPress có dấu chấm trong tên (đường dẫn đã bỏ dấu `/` cuối, chữ thường) -> đích. Rank Math nộp `sitemap_index.xml`, web mới chỉ có `sitemap.xml`. */
export const LEGACY_FILE_REDIRECTS: Readonly<Record<string, string>> = {
  '/sitemap_index.xml': '/sitemap.xml',
};

/** Tiền tố WordPress có đuôi tuỳ ý (đường dẫn con) -> đích chung, dùng khi đường dẫn đầy đủ không có dòng riêng ở bảng trên. */
const LEGACY_PREFIX_REDIRECTS: ReadonlyArray<readonly [prefix: string, destination: string]> = [
  ['/my-account', '/tai-khoan'],
  ['/checkout', '/thanh-toan'],
  ['/track-order', '/tai-khoan/don-hang'],
];

/** `/shop/page/2`, `/cua-hang/page/3`: phân trang cũ của kệ hàng WordPress. */
const SHOP_PAGINATION = /^\/(?:shop|cua-hang)\/page\/\d+$/;

/** Nội dung mẫu/nháp của theme và trang thử: trả 410 để Google gỡ nhanh khỏi chỉ mục. */
export const LEGACY_GONE_PREFIXES: readonly string[] = ['/elements', '/demos', '/blocks', '/featured_item'];
export const LEGACY_GONE_EXACT: readonly string[] = ['/draf-main-page', '/test'];

/** Slug sản phẩm WordPress (đủ 91 trong sitemap 13/11/2026) -> đích. Thêm dòng mới ở đây, `legacy-wp-redirects.spec.ts` kiểm đích còn sống. */
export const LEGACY_PRODUCT_REDIRECTS: Readonly<Record<string, string>> = {
  // Bé Pineboo
  'bot-rua-binh-sua-cho-be-pineboo-500ml': pdp('bot-rua-binh-sua-cho-be-pineboo-500ml-91e8c5'),
  'bot-rua-tay-pineboo-cho-be': pdp('bot-rua-tay-cho-be-pineboo-300ml-de31c8'),
  'bot-tam-goi-cho-be-pineboo-500ml': pdp('bot-tam-goi-cho-be-pineboo-500ml-47e6e4'),
  'nuoc-giat-huu-co-cho-be-pineboo-500ml': pdp('nuoc-giat-cho-be-pineboo-500ml-3952e8'),
  'xit-tram-cho-be-pineboo-150ml': pdp('xit-tram-cho-be-pineboo-150ml-b70d1d'),
  'xit-lau-do-choi-pineboo-cho-be-500ml': q('pineboo'),
  'dung-dich-rua-binh-sua-cho-be-fuwa3e': q('binh sua'),
  'dung-dich-sat-khuan-do-choi-tre-em-fuwa3e': q('fuwa3e'),

  // Fuwa3e
  'gel-rua-chen-cho-may': pdp('gel-rua-chen-cho-may-fuwa3e-500ml-f9915e'),
  'gel-rua-chen-cho-may-fuwa3e-10l': pdp('refill-gel-rua-chen-cho-may-fuwa3e-10l-13467d'),
  'muoi-rua-chen-cho-may': pdp('muoi-rua-chen-cho-may-fuwa3e-2kg-484ca1'),
  'lau-da-nang-fuwa3e-500ml': pdp('nuoc-lau-da-nang-fuwa3e-500ml-cbb309'),
  'nuoc-lau-da-nang-huu-co-fuwa3e-10l-2': pdp('refill-lau-da-nang-fuwa3e-10l-a08433'),
  'nuoc-lam-bong-chen-bat-fuwa3e': pdp('nuoc-ho-tro-xa-lam-bong-fuwa3e-500ml-fb40eb'),
  'nuoc-ngam-rua-thuc-pham-fuwa3e-10l': pdp('refill-nuoc-ngam-rua-thuc-pham-fuwa3e-10l-fbbea5'),
  'nuoc-ngam-rua-thuc-pham-fuwa3e-big-size': pdp('nuoc-ngam-rua-thuc-pham-fuwa3e-3-8l-7ececb'),
  'nuoc-ngam-rua-thuc-pham-fuwa3e-size-nho': q('nuoc ngam rua thuc pham'),
  'nuoc-rua-chen-fuwa3e-10l': pdp('refill-nuoc-rua-chen-fuwa3e-10l-69f244'),
  'nuoc-rua-chen-fuwa3e-sinh-hoc': pdp('nuoc-rua-chen-fuwa3e-500ml-185d77'),
  'nuoc-rua-chen-fuwa3e-size-nho': q('nuoc rua chen fuwa3e'),
  'nuoc-rua-tay-fuwa3e-big-size': q('nuoc rua tay fuwa3e'),
  'nuoc-giat-fuwa3e-10l': q('refill nuoc giat'),
  'nuoc-giat-fuwa3e-500ml-100ml': q('nuoc giat fuwa3e'),
  'nuoc-giat-huu-co-fuwa3e': q('nuoc giat fuwa3e'),
  'nuoc-lau-san-fuwa3e': q('nuoc lau san fuwa3e'),
  'nuoc-lau-san-fuwa3e-10l': q('refill nuoc lau san'),
  'nuoc-tay-bon-cau-huu-co-fuwa3e': q('bon cau'),
  'tay-bon-cau-size-lon-10l': pdp('refill-ve-sinh-bon-cau-fuwa3e-10l-9a032c'),
  'tinh-dau-treo-xe-o-to-thien-nhienfuwa3e': q('o to'),
  'xit-ve-sinh-noi-that': q('noi that'),

  // PƠ LANG
  'dau-goi-dau-thao-duoc-tu-trai-bo-po-lang': pdp('dau-goi-dau-xa-qua-bo-po-lang-300g-bef378'),
  'dau-qua-bo-ep-lanh-po-lang': pdp('dau-bo-tuoi-po-lang-30ml-10ml-40349e'),
  'dau-tay-trang-rua-mat-polang': pdp('dau-rua-mat-po-lang-100ml-55ml-8478ee'),
  'dau-u-toc-bo-po-lang-50ml': pdp('dau-u-toc-po-lang-50ml-867391'),
  'mat-na-bo-tuoi-po-lang': pdp('mat-na-bo-tuoi-po-lang-e3ccce'),
  'mat-na-ngu-po-lang': pdp('mat-na-ngu-po-lang-30g-7a51db'),
  'nuoc-tay-trang-po-lang': pdp('nuoc-tay-trang-po-lang-300ml-97f185'),
  'son-duong-moi-co-mau-bo-tuoi-po-lang': pdp('son-duong-co-mau-po-lang-a01-a03-a04-a05-ef066b'),
  'son-duong-moi-gac-tuoi-po-lang': pdp('son-duong-gac-tuoi-a07-1c1b67'),
  'son-duong-moi-khong-mau-bo-tuoi-po-lang': pdp('son-duong-bo-tuoi-po-lang-a08-b6ae3f'),
  'sua-rua-mat-tao-bot-rau-ma-po-lang': pdp('sua-rua-mat-tao-bot-po-lang-150ml-f15f0c'),
  'combo-dau-goi-bo-bac-ha-gel-tam': q('po lang'),
  'dau-gac-nguyen-chat-po-lang-30ml': q('po lang'),
  'gel-tam-thao-duoc-po-lang-300ml': q('po lang'),
  'muoi-tam-po-lang-tinh-chat-bo-ca-phe': q('po lang'),
  'phan-lanh-khu-mui-po-lang-huong-thao': q('po lang'),

  // Visante
  'dau-goi-thao-duoc-sam-visante-tri-gau': pdp('dau-goi-thao-duoc-sam-visante-tri-gau-giam-bet-dau-500ml-cho-toc-gau-bet-dau-chiet-xuat-sam-29bafc'),
  'dau-xa-thao-duoc-chiet-xuat-sam-visante': pdp('dau-xa-thao-duoc-visante-chiet-xuat-sam-duong-toc-mem-muot-500ml-1314dc'),
  'nuoc-tay-trang-thien-nhien-tu-sam-visante': pdp('nuoc-tay-trang-visante-chiet-xuat-sam-thien-nhien-diu-nhe-250ml-97377b'),
  'sua-rua-mat-tao-bot-tu-sam-visante': pdp('sua-rua-mat-tao-bot-visante-chiet-xuat-sam-lam-sach-diu-nhe-150ml-af8c13'),
  'tay-te-bao-chet-da-dau-thao-duoc-visante': pdp('tay-te-bao-chet-da-dau-thao-duoc-visante-lam-sach-nhe-nhang-150g-4500ef'),
  'xit-duong-toc-thao-duoc-visante': pdp('xit-duong-toc-visante-thao-duoc-chiet-xuat-sam-ngan-rung-toc-100ml-010849'),
  'dau-goi-thao-duoc-chiet-xuat-sam-visante': q('visante'),
  'sua-tam-goi-ngua-rom-say-cho-be-sam-visante': q('visante'),
  'sua-tam-ngua-mun-tu-sam-visante': q('visante'),
  'tam-goi-3in1-cho-nam-tu-sam-visante': q('visante'),

  // Hector, Anbinest
  'dong-trung-ha-thao-hector-lite': pdp('nuoc-dong-trung-ha-thao-hector-lite-thanh-loc-co-the-70ml-x-10-chai-dieu-hoa-duong-huyet-db096e'),
  'hector-collagen-dong-trung-ha-thao': pdp('nuoc-nam-dong-trung-ha-thao-hector-collagen-50ml-x-10-bo-sung-collagen-ho-tro-dep-da-93445f'),
  'nuoc-dong-trung-ha-thao-hector-sam': pdp('nuoc-dong-trung-ha-thao-hector-sam-tang-cuong-suc-khoe-70ml-x-10-chai-192b87'),
  'nuoc-nam-dong-trung-ha-thao-hector-basic': pdp('nuoc-nam-dong-trung-ha-thao-hector-basic-dang-tui-25ml-x-10-goi-34b72c'),
  'nuoc-uong-dong-trung-ha-thao-hector-thao-moc': pdp('nuoc-uong-dong-trung-ha-thao-hector-thao-moc-25ml-x-10-goi-boi-bo-co-the-tang-suc-de-khang-ea3d0e'),
  'nuoc-uong-sang-da-hector-white': pdp('nuoc-uong-sang-da-hector-white-collagen-dong-trung-ha-thao-50ml-x-10-lo-22ada5'),
  'nuoc-nam-dong-trung-ha-thao': q('dong trung ha thao'),
  'to-yen-anbinest-diet-nhung-huou': ALL,
  'to-yen-nhung-huou-anbinest-gold': ALL,
  'to-yen-nhung-huou-anbinest-queen': ALL,
  'yen-nhung-huou-anbinest-kids': ALL,
  'yen-nhung-huou-anbinest-king': ALL,

  // Sokfarm
  'duong-hoa-dua-organic-sokfarm': pdp('duong-hoa-dua-sokfarm-d6c685'),
  'duong-hoa-dua-organic-sokfarm-5kg': pdp('duong-hoa-dua-sokfarm-d6c685'),
  'mat-hoa-dua-co-dac-organic-sokfarm': pdp('mat-hoa-dua-co-dac-sokfarm-b0d1de'),
  'mat-hoa-dua-co-dac-organic-sokfarm-7kg': pdp('mat-hoa-dua-co-dac-sokfarm-b0d1de'),
  'mat-hoa-dua-tuoi-organic-sokfarm': pdp('nuoc-uong-mat-hoa-dua-tuoi-sokfarm-330ml-b68b8c'),
  'nuoc-tuong-mat-hoa-dua-organic-sokfarm': q('nuoc tuong mat hoa dua'),
  'nuoc-tuong-mat-hoa-dua-organic-sokfarm-1l': q('nuoc tuong mat hoa dua'),
  'nuoc-tuong-mat-hoa-dua-organic-sokfarm-5l': q('nuoc tuong mat hoa dua'),
  'giam-mat-hoa-dua-huu-co-sokfarm-256ml': q('sokfarm'),

  // BH.NONG
  'granola-mix-trai-cay-say-bh-nong': pdp('granola-mix-trai-cay-say-bh-nong-lon-450g-1f07d6'),
  'granola-sieu-hat-bh-nong': pdp('granola-mix-nuts-tui-tien-loi-bh-nong-3b8792'),
  'sua-hat-gao-lut-nay-mam-bh-nong': pdp('sua-hat-gao-lut-nay-mam-bh-nong-lon-400g-e0cafb'),
  'sua-hat-gao-lut-nay-mam-thuan-chay-bh-nong': pdp('sua-hat-gao-lut-nay-mam-bh-nong-khong-duong-400g-gom-18-loai-hat-thuan-chay-d149a9'),
  'thanh-gao-lut-rong-bien-an-vat-bh-nong-180g': pdp('thanh-gao-lut-rong-bien-bh-nong-180g-da009b'),
  'tra-gao-lut-ray-bh-nong': pdp('tra-gao-lut-ray-dau-den-bh-nong-500g-0d8278'),
  'banh-mam-gao-lut-bh-nong': q('banh mam'),
  'tra-gao-lut-dong-trung-bh-nong': q('tra gao lut'),

  // Cà phê, socola
  'ca-phe-muoi-csea': pdp('ca-phe-muoi-c-sea-dam-da-thom-beo-chuan-gu-hue-hop-16g-x-10-goi-a50737'),
  'ca-phe-sau-rieng-durica': pdp('ca-phe-sau-rieng-thom-beo-durica-le-plateau-hop-g-x-10-goi-2c9db2'),
  'ca-phe-sua-dua-kafedua': pdp('ca-phe-sua-dua-hoa-tan-kafedua-le-plateau-thom-beo-16g-x-10-goi-7aecb7'),
  'ca-phe-trung': pdp('ca-phe-trung-ahano-chuan-vi-ha-noi-thom-ngay-kho-cuong-4f0d97'),
  'socola-hoa-tan-uong-lien-choco-oke': pdp('socola-hoa-tan-uong-lien-choco-oke-4d912d'),

  // Sản phẩm không phải hàng hoá (nạp điểm)
  'nap-diem': ALL,
};

/** Từ khoá trong slug danh mục WordPress `/product-category/<slug>` -> từ khoá tìm; không khớp thì về cả kệ hàng. */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [needle: string, keywords: string]> = [
  ['pineboo', 'pineboo'],
  ['fuwa3e', 'fuwa3e'],
  ['fuwa', 'fuwa3e'],
  ['po-lang', 'po lang'],
  ['polang', 'po lang'],
  ['visante', 'visante'],
  ['hector', 'hector'],
  ['sokfarm', 'sokfarm'],
  ['bh-nong', 'bh nong'],
];

/** Chỉ dấu vết quảng cáo và mã giới thiệu CTV đi theo sang đích; mọi khoá khác của WordPress (s, orderby, attribute_*, add-to-cart...) bị bỏ để không làm lệch bộ lọc `/san-pham`. */
const CARRIED_PARAM = /^(?:utm_[a-z0-9_]+|gclid|fbclid|ref)$/i;

function normalizePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const flat = decoded.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return flat === '' ? '/' : flat;
}

const own = (table: Readonly<Record<string, string>>, key: string): string | undefined => (Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined);
const underPrefix = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

function categoryDestination(slugPath: string): string {
  const hit = CATEGORY_KEYWORDS.find(([needle]) => slugPath.includes(needle));
  return hit ? q(hit[1]) : ALL;
}

function redirect(location: string): LegacyResolution {
  return { kind: 'redirect', status: 301, location };
}

/**
 * Tra một đường dẫn (không kèm query) xem có phải URL WordPress cũ không. `null` = không phải: để các luật còn lại của web xử lý.
 * Dấu `/` cuối, chữ hoa và `//` thừa được bỏ trước khi so (WordPress luôn có `/` cuối).
 */
export function resolveLegacyWpPath(pathname: string): LegacyResolution | null {
  const path = normalizePath(pathname);
  if (path === null || path === '/') return null;

  const file = own(LEGACY_FILE_REDIRECTS, path);
  if (file) return redirect(file);

  if (LEGACY_GONE_EXACT.includes(path) || LEGACY_GONE_PREFIXES.some((prefix) => underPrefix(path, prefix))) return { kind: 'gone', status: 410 };

  const product = /^\/product\/([^/]+)$/.exec(path);
  if (product) {
    const target = own(LEGACY_PRODUCT_REDIRECTS, product[1] ?? '');
    // Slug lạ rơi xuống route /product/[slug] đã có (link CTV và Mini App dạng /product/<slug mới>).
    return target ? redirect(target) : null;
  }

  if (path === '/product-category' || path.startsWith('/product-category/')) return redirect(categoryDestination(path));
  if (path === '/product-tag' || path.startsWith('/product-tag/') || SHOP_PAGINATION.test(path)) return redirect(ALL);

  const page = own(LEGACY_PAGE_REDIRECTS, path);
  if (page) return redirect(page);

  const prefix = LEGACY_PREFIX_REDIRECTS.find(([p]) => underPrefix(path, p));
  return prefix ? redirect(prefix[1]) : null;
}

/** Ghép tham số theo dõi (utm_*, gclid, fbclid, ref) của URL gốc vào đích; tham số đã có sẵn trong đích được giữ nguyên. */
export function carryLegacyParams(location: string, search: string): string {
  if (!search || search === '?') return location;
  const [path = location, existing = ''] = location.split('?');
  const merged = new URLSearchParams(existing);
  for (const [key, value] of new URLSearchParams(search)) {
    if (CARRIED_PARAM.test(key) && !merged.has(key)) merged.append(key, value);
  }
  const query = merged.toString().replace(/%2B/g, '+');
  return query ? `${path}?${query}` : path;
}

/** Đường dẫn blog/ảnh/feed của WordPress mà giai đoạn 1 để reverse proxy về origin cũ (không phải chuyển hướng, web mới không có). */
const WP_BLOG_PATTERNS: readonly RegExp[] = [
  /^\/blog(?:\/|$)/,
  /^\/\d{4}\/\d{2}\/\d{2}\/[^/]+$/,
  /^\/category\/./,
  /^\/tag\/./,
  /^\/author\/./,
  /^\/wp-content\//,
  /^\/wp-includes\//,
  /^\/wp-json(?:\/|$)/,
  /^\/(?:comments\/)?feed(?:\/|$)/,
];

export function isWpBlogPath(pathname: string): boolean {
  const path = normalizePath(pathname);
  return path !== null && WP_BLOG_PATTERNS.some((re) => re.test(path));
}
