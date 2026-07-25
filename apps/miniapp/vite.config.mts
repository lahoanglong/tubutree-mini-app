import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import zaloMiniApp from 'zmp-vite-plugin';

// Cấu hình Vite cho Zalo Mini App.
// Layout chuẩn zmp: index.html ở gốc project (zmp-cli/extension yêu cầu), entry src/app.tsx.
export default defineConfig({
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
});

