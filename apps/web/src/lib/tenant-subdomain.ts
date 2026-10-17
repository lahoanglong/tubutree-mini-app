/** Subdomain hệ thống, không phải gian hàng. */
const SYSTEM_SUBDOMAINS = ['www', 'admin', 'api', 'app', 'mail'];

/**
 * Tên gian hàng khi khách vào bằng subdomain (`<slug>.tubutree.com`, `<slug>.localhost`), null nếu là host thường hoặc subdomain
 * hệ thống. Dùng chung cho middleware.ts (rewrite trang chủ subdomain sang `/s/<slug>`) và entry-source.ts (nhận ra khách vào
 * gian hàng CTV: trình duyệt vẫn thấy đường dẫn `/` vì rewrite chỉ xảy ra phía máy chủ). `host` có thể kèm cổng.
 */
export function tenantSubdomain(host: string): string | null {
  const hostname = host.split(':')[0]!.toLowerCase();
  const parts = hostname.split('.');

  let subdomain: string | null = null;
  if (hostname.endsWith('.localhost') && parts.length === 2) {
    subdomain = parts[0]!;
  } else if (parts.length >= 3 && !hostname.endsWith('.localhost')) {
    subdomain = parts[0]!;
  }

  if (subdomain && SYSTEM_SUBDOMAINS.includes(subdomain)) return null;
  return subdomain;
}
