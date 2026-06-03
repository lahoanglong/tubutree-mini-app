import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import zaloMiniApp from 'zmp-vite-plugin';

// Cấu hình Vite cho Zalo Mini App (zmp-cli wrap quanh vite này).
export default defineConfig({
  root: './src',
  base: '',
  plugins: [zaloMiniApp(), react()],
});
