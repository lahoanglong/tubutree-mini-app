import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { HUB, isHubQuery } from './lib/browse-hub-route';
import { HOME_HINT_COOKIE, SESSION_COOKIE, parseHintSlug } from './lib/home-restore-hint';
import { isLegalSlug } from './lib/legal';
import { carryLegacyParams, resolveLegacyWpPath, type LegacyResolution } from './lib/legacy-wp-redirects';
import { tenantSubdomain } from './lib/tenant-subdomain';

// Trang ISR theo [slug] được Next ghi file cache theo từng đường dẫn lạ, kể cả 404 (~53 KB mỗi đường dẫn, không bao giờ xoá).
// Chỉ cho vào những đường dẫn có thể là slug thật; còn lại 404 ngay ở middleware, không chạm cache.
// Trần lấy theo slug dài nhất API sinh ra: tên SP đối tác tối đa 200 ký tự + '-' + Date.now().toString(36); slug Pancake và brand không có trần nên chừa dư.
const SLUG_CHARS = /^[A-Za-z0-9_-]+$/;
const SLUG_ROUTE = /^\/(san-pham|brand|chinh-sach|s|chien-dich)\/([^/]+)\/?$/;
const SLUG_MAX: Record<string, number> = { 'san-pham': 256, brand: 256, s: 256, 'chien-dich': 80, 'chinh-sach': 80 };

function isPlausibleSlug(route: string, slug: string): boolean {
  if (slug.length > (SLUG_MAX[route] ?? 0) || !SLUG_CHARS.test(slug)) return false;
  return route !== 'chinh-sach' || isLegalSlug(slug);
}

// Cache ngắn (1 giờ trình duyệt, 1 ngày CDN) để còn sửa được bảng chuyển hướng sau cutover mà không mắc kẹt trong cache của khách.
const LEGACY_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400';

/**
 * Chuyển hướng của middleware dựng bằng `NextResponse.redirect` trên URL của chính request, KHÔNG tự đặt header Location: Next 15 từ chối Location tương đối do
 * middleware tự viết (adapter gọi `new URL(location)` không có gốc, trả 500), còn khi Location là URL tuyệt đối cùng host với request thì Next đổi nó thành Location
 * tương đối (`/san-pham`) trước khi gửi, nên không phụ thuộc host nội bộ sau reverse proxy và không phải tin header Host. Đã chạy `next dev` thật để kiểm.
 */
function redirectTo(request: NextRequest, status: 301 | 308, pathAndQuery: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.redirect(new URL(pathAndQuery, request.url), { status, headers });
}

function legacyResponse(request: NextRequest, legacy: LegacyResolution): NextResponse {
  if (legacy.kind === 'gone') {
    return new NextResponse('410 Gone', {
      status: legacy.status,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': LEGACY_CACHE_CONTROL, 'x-robots-tag': 'noindex' },
    });
  }
  return redirectTo(request, legacy.status, carryLegacyParams(legacy.location, request.nextUrl.search), { 'cache-control': LEGACY_CACHE_CONTROL });
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const url = request.nextUrl;
  const pathname = url.pathname;
  const subdomain = tenantSubdomain(host);

  if (pathname.startsWith('/_next')) return NextResponse.next();

  // URL WordPress cũ của tubutree.com (sản phẩm, trang chính sách, giỏ hàng, /sitemap_index.xml, trang demo của theme): 301 sang trang tương ứng hoặc 410.
  // Đứng trước luật bỏ dấu `/` cuối và luật bỏ qua đường dẫn có dấu chấm: next.config đặt skipTrailingSlashRedirect nên `/product/<slug>/` tới đây còn nguyên
  // dấu `/`, 301 thẳng một chặng (trước đó Next 308 bỏ dấu `/` rồi mới tới đây thành hai chặng); `/sitemap_index.xml` có dấu chấm. Không áp cho host gian hàng CTV.
  if (!subdomain) {
    const legacy = resolveLegacyWpPath(pathname);
    if (legacy) return legacyResponse(request, legacy);
  }

  // Thay luật bỏ dấu `/` cuối mặc định của Next (đã tắt ở next.config): đường dẫn nào cũng về dạng không có `/` cuối bằng 308 như trước.
  if (pathname.length > 1 && pathname.endsWith('/')) {
    // `//evil.com/` sau khi bỏ `/` cuối vẫn mở đầu bằng `//` và `new URL` hiểu là URL cùng giao thức tới host khác: gộp mọi `/` đầu về một.
    return redirectTo(request, 308, `${pathname.replace(/\/+$/, '').replace(/^\/+/, '/') || '/'}${url.search}`);
  }

  // Skip static assets, internal routes or files
  if (pathname.startsWith('/api') || pathname.startsWith('/static') || pathname.includes('.')) {
    return NextResponse.next();
  }

  // Bản tĩnh của hub chỉ đi qua rewrite bên dưới; vào thẳng thì về đường dẫn thật để không có hai URL cho một trang.
  if (pathname === HUB) {
    const target = new URL('/san-pham', request.url);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 308);
  }

  const slugRoute = SLUG_ROUTE.exec(pathname);
  if (slugRoute && !isPlausibleSlug(slugRoute[1] ?? '', slugRoute[2] ?? '')) {
    // Đường dẫn không tồn tại nên Next dựng not-found.tsx của site với mã 404.
    return NextResponse.rewrite(new URL('/_slug-not-found', request.url), { status: 404, headers: { 'cache-control': 'no-store' } });
  }

  if (subdomain) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-tenant-subdomain', subdomain);

    // Rewrite từ trang chủ subdomain sang storefront tương ứng
    if (pathname === '/') {
      const rewriteUrl = new URL(`/s/${subdomain}`, request.url);
      return NextResponse.rewrite(rewriteUrl, {
        request: {
          headers: requestHeaders,
        },
      });
    }

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  }

  // Hub /san-pham giống nhau cho mọi khách: phục vụ bản ISR (app/hub-san-pham) thay vì dựng lại mỗi lượt; URL trình duyệt không đổi.
  if (pathname === '/san-pham' && isHubQuery(url.searchParams)) return NextResponse.rewrite(new URL(HUB, request.url));

  // Khách đã có cookie phiên: Trang chủ dựng sẵn khung chờ đúng loại khách (xem app/khoi-phuc/[hint]/page.tsx), URL vẫn là "/".
  // Hai bản khác nhau theo cookie; Next không giữ Vary trên "/", nên cache chung phía trước phải bỏ qua khi có cookie (xem runbook 0.3).
  if (pathname === '/') {
    const restoring = request.cookies.get(SESSION_COOKIE)?.value === '1';
    const response = restoring
      ? NextResponse.rewrite(new URL(`/khoi-phuc/${parseHintSlug(request.cookies.get(HOME_HINT_COOKIE)?.value)}`, request.url))
      : NextResponse.next();
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
