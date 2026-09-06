import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

  const hostname = host.split(':')[0]!.toLowerCase();
  const parts = hostname.split('.');

  let subdomain: string | null = null;
  if (hostname.endsWith('.localhost') && parts.length === 2) {
    subdomain = parts[0]!;
  } else if (parts.length >= 3 && !hostname.endsWith('.localhost')) {
    subdomain = parts[0]!;
  }

  // Bỏ qua các subdomain hệ thống
  if (subdomain && ['www', 'admin', 'api', 'app', 'mail'].includes(subdomain)) {
    subdomain = null;
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

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
