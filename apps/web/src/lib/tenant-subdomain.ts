/** Subdomain hệ thống, không phải gian hàng. */
export const SYSTEM_SUBDOMAINS = ['www', 'admin', 'api', 'app', 'mail'];

/**
 * Tên miền gốc mà `<tên>.<gốc>` mới là gian hàng. Khoá cứng theo tên miền (không đoán từ số nhãn của host) để host của nơi
 * triển khai như `*.vercel.app` hay `*.nip.io` không bị coi là gian hàng CTV. Đọc từ biến build (middleware chạy ở Edge,
 * không gọi được API mỗi lượt truy cập); môi trường khác tên miền gốc (staging) đặt `NEXT_PUBLIC_TENANT_ROOT_DOMAIN`.
 */
export const TENANT_ROOT_DOMAIN = (process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '') || 'tubutree.com';

/**
 * Tên gian hàng khi khách vào bằng subdomain đúng một nhãn dưới tên miền gốc (`<slug>.tubutree.com`, hoặc `<slug>.localhost` khi
 * chạy máy dev), null nếu là host khác, host gốc hoặc subdomain hệ thống. Dùng chung cho middleware.ts (rewrite trang chủ
 * subdomain sang `/s/<slug>`) và entry-source.ts (nhận ra khách vào gian hàng CTV: trình duyệt vẫn thấy đường dẫn `/` vì rewrite
 * chỉ xảy ra phía máy chủ). `host` có thể kèm cổng.
 */
export function tenantSubdomain(host: string, rootDomain: string = TENANT_ROOT_DOMAIN): string | null {
  const hostname = host.split(':')[0]!.toLowerCase();

  let subdomain: string | null = null;
  for (const root of ['localhost', rootDomain]) {
    const suffix = `.${root}`;
    if (hostname.length > suffix.length && hostname.endsWith(suffix)) {
      const label = hostname.slice(0, -suffix.length);
      if (!label.includes('.')) subdomain = label;
      break;
    }
  }

  if (subdomain && SYSTEM_SUBDOMAINS.includes(subdomain)) return null;
  return subdomain;
}
