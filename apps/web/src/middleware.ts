import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { HUB, isHubQuery } from './lib/browse-hub-route';
import { HOME_HINT_COOKIE, SESSION_COOKIE, parseHintSlug } from './lib/home-restore-hint';
import { isLegalSlug } from './lib/legal';
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

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  const url = request.nextUrl;
  const pathname = url.pathname;

  // Skip static assets, internal routes or files
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/static') ||
    pathname.includes('.')
  ) {
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

  const subdomain = tenantSubdomain(host);

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
