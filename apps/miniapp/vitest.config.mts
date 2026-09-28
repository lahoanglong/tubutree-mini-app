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
    // tailwind.config.spec.ts sống ở root (cạnh tailwind.config.ts nó test) chứ không phải
    // dưới src/ — thêm riêng lẻ thay vì nới include thành '**/*.spec.ts' để không vô tình
    // quét test trong node_modules của các package workspace khác.
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx', 'tailwind.config.spec.ts'],
    globals: true,
    // Nạp jest-dom cho mọi test (kể cả environment 'node') — module chỉ extend `expect`,
    // không đụng DOM lúc import nên an toàn với test logic thuần.
    setupFiles: ['./src/vitest-setup.ts'],
  },
});
