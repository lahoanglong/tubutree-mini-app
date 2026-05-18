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
});
