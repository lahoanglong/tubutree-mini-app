import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Chỉ bật standalone khi build Docker (NEXT_STANDALONE=1) — Next standalone dùng
// symlink, fail EPERM trên Windows local `next build`. Docker (Linux) đặt env này.
const standalone = process.env.NEXT_STANDALONE === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // ẩn header X-Powered-By: Next.js (info-disclosure nhỏ, không cần thiết)
  ...(standalone
    ? { output: 'standalone', experimental: { outputFileTracingRoot: path.join(dirname, '../../') } }
    : {}),
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
        ],
      },
    ];
  },
};

export default nextConfig;
