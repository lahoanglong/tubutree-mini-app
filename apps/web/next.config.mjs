import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Chỉ bật standalone khi build Docker (NEXT_STANDALONE=1) — Next standalone dùng
// symlink, fail EPERM trên Windows local `next build`. Docker (Linux) đặt env này.
const standalone = process.env.NEXT_STANDALONE === '1';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
// Chỉ lấy origin của API cho connect-src (bỏ path /api).
const apiOrigin = (() => {
  try {
    return new URL(apiBaseUrl).origin;
  } catch {
    return '';
  }
})();

/**
 * CSP ở chế độ BÁO CÁO trước, chưa chặn.
 *
 * Refresh token của web nằm trong localStorage (xem lib/client-api.ts), nên một lỗ XSS là mất
 * tài khoản vĩnh viễn — mà trang này lại render nhiều URL do người dùng khác nhập (logo nhãn
 * hàng, ảnh bìa gian hàng, video trong Content Kit). CSP là lớp phòng thủ thứ hai cho tới khi
 * chuyển refresh token sang cookie httpOnly.
 *
 * Đặt Report-Only vì chính sách này chưa được kiểm chứng trên trình duyệt thật: bật chặn ngay
 * mà thiếu một host nào đó là trang trắng cho khách. Sau khi soi báo cáo trên môi trường thật
 * thì đổi key sang 'Content-Security-Policy'.
 *
 * `'unsafe-inline'` cho script là điều Next cần khi chưa dựng nonce qua middleware — nó vẫn
 * chặn được script từ host lạ, tức chặn đường nhúng mã bên ngoài.
 */
const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // ẩn header X-Powered-By: Next.js (info-disclosure nhỏ, không cần thiết)
  experimental: {
    webpackBuildWorker: false,
    ...(standalone ? { outputFileTracingRoot: path.join(dirname, '../../') } : {}),
  },
  ...(standalone ? { output: 'standalone' } : {}),
  transpilePackages: ['@tubutree/shared-types'],
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api',
  },
  // API đã có `helmet()` (apps/api/src/main.ts) nhưng web (trang khách hàng/admin thấy
  // trực tiếp) trước giờ không có header bảo mật nào — Caddy chỉ reverse-proxy thuần,
  // không thêm header. Áp cho mọi route.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
        ],
      },
    ];
  },
};

export default nextConfig;
