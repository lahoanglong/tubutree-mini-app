import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { HOME_HINT_COOKIE, SESSION_COOKIE, parseHintSlug } from './lib/home-restore-hint';
import { tenantSubdomain } from './lib/tenant-subdomain';

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

  // Khách đã có cookie phiên: Trang chủ dựng sẵn khung chờ đúng loại khách (xem app/khoi-phuc/[hint]/page.tsx), URL vẫn là "/".
  // Hai bản khác nhau theo cookie nên báo Vary cho bộ nhớ đệm phía trước.
  if (pathname === '/') {
    const restoring = request.cookies.get(SESSION_COOKIE)?.value === '1';
    const response = restoring
      ? NextResponse.rewrite(new URL(`/khoi-phuc/${parseHintSlug(request.cookies.get(HOME_HINT_COOKIE)?.value)}`, request.url))
      : NextResponse.next();
    response.headers.append('Vary', 'Cookie');
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
