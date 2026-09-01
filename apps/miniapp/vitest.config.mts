import { defineConfig } from 'vitest/config';

// Config riêng cho unit test (tách khỏi vite.config.mts để không kéo zmp-vite-plugin,
// vốn chỉ cần cho build/dev thật). Test hiện tại là logic thuần (rules/store), không
// cần render DOM → environment 'node' là đủ, tránh phụ thuộc jsdom.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
