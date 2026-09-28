import { defineConfig } from 'vitest/config';

// ESLint's RuleTester (dùng trong rules/*.spec.js) tự phát hiện Mocha-style global
// describe/it; bật `globals: true` để vitest cấp các global đó, nếu không RuleTester
// rơi về default handler nội bộ và không đăng ký test case nào với vitest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['rules/**/*.spec.js'],
    globals: true,
  },
});
