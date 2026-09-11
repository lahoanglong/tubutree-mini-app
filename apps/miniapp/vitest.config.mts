import { defineConfig } from 'vitest/config';

// Config riêng cho unit test (tách khỏi vite.config.mts để không kéo zmp-vite-plugin,
// vốn chỉ cần cho build/dev thật).
// - Test logic thuần (*.spec.ts) chạy environment 'node' cho nhanh, không cần DOM.
// - Test component (*.spec.tsx) cần DOM → jsdom, khai báo riêng qua environmentMatchGlobs
//   để không bắt toàn bộ test còn lại gánh chi phí dựng DOM.
export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['**/*.spec.tsx', 'jsdom']],
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    globals: true,
  },
});
