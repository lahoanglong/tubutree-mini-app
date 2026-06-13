import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Chỉ bật standalone khi build Docker (NEXT_STANDALONE=1) — Next standalone dùng
// symlink, fail EPERM trên Windows local `next build`. Docker (Linux) đặt env này.
const standalone = process.env.NEXT_STANDALONE === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(standalone
    ? { output: 'standalone', experimental: { outputFileTracingRoot: path.join(dirname, '../../') } }
    : {}),
  transpilePackages: ['@tubutree/shared-types'],
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api',
  },
};

export default nextConfig;
