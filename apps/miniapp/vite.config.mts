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

