import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import zmp from "zmp-vite-plugin";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    zmp(),
    react(),
    tsconfigPaths(),
  ],
  build: {
    // Tăng cảnh báo lên 350KB — chunks lớn nhất giờ ~280KB (react + zmp-ui vendor)
    chunkSizeWarningLimit: 350,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            // 3 vendor chunks chính (ít split hơn = tránh circular dep)
            if (id.includes("zmp-ui") || id.includes("zmp-sdk")) return "vendor-zmp";
            if (id.includes("swiper")) return "vendor-swiper";
            // Tất cả còn lại (react + router + recoil + axios + misc) gộp vào vendor
            return "vendor";
          }
          // Pages lazy theo persona — kết hợp React.lazy
          if (id.includes("/pages/admin")) return "page-admin";
          if (id.includes("/pages/affiliate-hub") || id.includes("/pages/agent-hub") ||
              id.includes("/pages/wallet-payout") || id.includes("/pages/become-affiliate") ||
              id.includes("/pages/become-agent") || id.includes("/pages/my-capabilities") ||
              id.includes("/pages/points") || id.includes("/pages/vouchers")) {
            return "page-account";
          }
          return undefined;
        },
      },
    },
  },
});
