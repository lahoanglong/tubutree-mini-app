import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig để jsx "preserve" cho Next.js — test component (.spec.tsx) cần esbuild tự biên dịch JSX.
  esbuild: { jsx: 'automatic' },
  // Alias "@/..." như tsconfig paths — component import '@/lib/...'.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    // Also picks up tailwind.config.spec.ts at the package root (outside src/) — a narrow,
    // explicit entry rather than a broad root-level glob, to avoid sweeping in other workspaces.
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx', 'tailwind.config.spec.ts'],
  },
});
