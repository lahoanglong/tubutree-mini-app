import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // bundle server tối giản cho Docker (Next output tracing)
  // Trace từ root monorepo để standalone gom đúng workspace packages (pnpm).
  experimental: { outputFileTracingRoot: path.join(dirname, '../../') },
  transpilePackages: ['@tubutree/shared-types'],
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api',
  },
};

export default nextConfig;
