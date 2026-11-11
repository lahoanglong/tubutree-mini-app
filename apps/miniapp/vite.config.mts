import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import zaloMiniApp from 'zmp-vite-plugin';
import { assertMiniappBuildEnv } from './src/build-env';

// Cấu hình Vite cho Zalo Mini App.
// Layout chuẩn zmp: index.html ở gốc project (zmp-cli/extension yêu cầu), entry src/app.tsx.
export default defineConfig(({ command, mode }) => {
  // Chỉ chặn lúc build: dev vẫn dùng mặc định localhost của services/api.ts.
  if (command === 'build') {
    assertMiniappBuildEnv(mode, loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_'));
  }
  return {
    root: '.',
    base: '',
    plugins: [zaloMiniApp(), react()],
    // Hai bản React trong một bundle làm hook null; web dùng React 19 nên ép một bản duy nhất.
    // shared-types phát hành CJS (dist); Vite gói sẵn CJS nên tên export qua `export *` không thấy được ("Importing binding name ... is not found")
    // khi Mini App lấy giá trị chạy thật (không chỉ kiểu). Trỏ thẳng vào mã nguồn TS như jest của API.
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: { '@tubutree/shared-types': fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url)) },
    },
    esbuild: {
      legalComments: 'none',
    },
    build: {
      target: ['es2020', 'safari13.1'],
      rollupOptions: {
        output: {
          // Tách thư viện nền (React + Router, ZMP SDK, React Query + Zustand) khỏi entry để gói khởi động gọn dưới trần 450 KB/700 KB;
          // KHÔNG gộp zmp-ui hay lucide-react vào vendor chung để giữ nguyên các chunk lazy (Sheet, icon trang quản trị).
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) {
              return 'vendor-react';
            }
            if (id.includes('/node_modules/zmp-sdk/')) {
              return 'vendor-zmp-sdk';
            }
            if (id.includes('/node_modules/@tanstack/') || id.includes('/node_modules/zustand/')) {
              return 'vendor-state';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      port: 3113,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: process.env.VITE_API_TARGET || 'https://api.tubutree.com',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});

