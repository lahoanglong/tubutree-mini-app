import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import zaloMiniApp from 'zmp-vite-plugin';
import { dropOverriddenRootVarsPlugin } from './src/build-css-root-vars';
import { dropDemoStoryPresetsPlugin } from './src/build-demo-story-presets';
import { assertMiniappBuildEnv } from './src/build-env';
import { unaliasModuleNamesPlugin } from './src/build-import-names';
import { preloadTrim } from './src/build-preload-trim';
import { pruneUnusedZauiCssPlugin } from './src/build-zaui-prune';

/**
 * Mở sẵn kết nối tới API trong lúc JS còn tải: lệnh gọi đầu (cấu hình công khai, Trang chủ) không phải chờ DNS + TLS. Hai thẻ vì `fetch` của Mini App không gửi
 * cookie (nhóm kết nối ẩn danh, cần `crossorigin`), còn ảnh sản phẩm (`<img>` qua `/api/img` cùng máy chủ) dùng nhóm kết nối thường.
 */
function apiPreconnect(apiBase: string | undefined): Plugin {
  return {
    name: 'tubu-api-preconnect',
    apply: 'build',
    transformIndexHtml() {
      let origin: string;
      try {
        origin = new URL(apiBase ?? '').origin;
      } catch {
        return [];
      }
      return [
        { tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head-prepend' },
        { tag: 'link', attrs: { rel: 'preconnect', href: origin }, injectTo: 'head-prepend' },
      ];
    },
  };
}

// Các mô-đun shared-types chỉ màn lười dùng nhưng dựng bảng bằng lời gọi hàm ở cấp cao nhất: Rollup không chứng minh được chúng không có tác dụng phụ nên giữ
// chúng ở chỗ barrel `index.ts` được nạp (entry), dù entry không dùng export nào. Khai báo không tác dụng phụ để chúng chỉ nằm ở chunk thật sự dùng chúng.
// Chỉ thêm tệp mà cấp cao nhất chỉ khai báo hằng/bảng (không ghi biến toàn cục, không đăng ký gì).
const PURE_LAZY_MODULES = /\/packages\/shared-types\/src\/product-copy-fallback\.ts$/;

// Cấu hình Vite cho Zalo Mini App.
// Layout chuẩn zmp: index.html ở gốc project (zmp-cli/extension yêu cầu), entry src/app.tsx.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_');
  // Chỉ chặn lúc build: dev vẫn dùng mặc định localhost của services/api.ts.
  if (command === 'build') {
    assertMiniappBuildEnv(mode, env);
  }
  const trim = preloadTrim();
  return {
    root: '.',
    base: '',
    // Hai bước cuối chỉ đổi byte đã nén, không đổi hành vi: bỏ ` as x` ở chỗ nối giữa các chunk (build-import-names.ts, ~24 KB) và bỏ khai báo
    // `:root` bị ghi đè trong cùng tệp CSS (build-css-root-vars.ts, ~3 KB).
    plugins: [
      zaloMiniApp(),
      react(),
      pruneUnusedZauiCssPlugin(),
      dropDemoStoryPresetsPlugin(),
      trim.plugin,
      apiPreconnect(env.VITE_API_BASE_URL),
      unaliasModuleNamesPlugin(),
      dropOverriddenRootVarsPlugin(),
    ],
    // Hai bản React trong một bundle làm hook null; web dùng React 19 nên ép một bản duy nhất.
    // shared-types phát hành CJS (dist); Vite gói sẵn CJS nên tên export qua `export *` không thấy được ("Importing binding name ... is not found")
    // khi Mini App lấy giá trị chạy thật (không chỉ kiểu). Trỏ thẳng vào mã nguồn TS như jest của API.
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@tubutree/shared-types': fileURLToPath(new URL('../../packages/shared-types/src/index.ts', import.meta.url)),
        'resize-observer-polyfill': fileURLToPath(new URL('./src/build-resize-observer.ts', import.meta.url)),
      },
    },
    esbuild: {
      legalComments: 'none',
    },
    build: {
      target: ['es2020', 'safari13.1'],
      // Zalo cân tổng dung lượng thô của bản build. terser (đã có trong lockfile qua peer của vite) nén JS gọn hơn esbuild ~16 KB;
      // `module: true` vì mọi chunk là ES module nên đổi tên được cả biến cấp cao nhất.
      // Bản đồ preload không ghi lại chunk khởi động (đã chạy xong trước mọi import động): xem build-preload-trim.ts.
      // Không chèn polyfill modulepreload (703 byte trong entry): chunk khởi động là import tĩnh nên polyfill không giúp lúc mở app, và trình duyệt
      // không hỗ trợ modulepreload (WebKit trước iOS 17) thì hàm preload của Vite tự dùng rel="preload" as="script", phụ thuộc vẫn tải song song.
      modulePreload: { polyfill: false, resolveDependencies: trim.resolveDependencies },
      minify: 'terser',
      terserOptions: { ecma: 2020, module: true, compress: { passes: 3 }, format: { comments: false } },
      rollupOptions: {
        treeshake: { moduleSideEffects: (id) => !PURE_LAZY_MODULES.test(id) },
        output: {
          // Tổng bản build là cái Zalo cân, và mỗi chunk nhỏ mang theo import/export + một mục trong bản đồ preload. Gộp chunk dưới 2 KB (hook, api, icon lucide):
          // 2478 → 2464 KB, 244 → 183 tệp, gói khởi động đổi +0.4 KB gzip. KHÔNG nâng ngưỡng: từ 4 KB Rollup nhét cả mô-đun chỉ-lazy
          // (waste-copy, brand-origins…) vào entry, gói khởi động phình +4,6 KB gzip ở 4 KB và +38 KB raw ở 20 KB.
          experimentalMinChunkSize: 2_000,
          // Rollup mặc định chèn `import"./x.js"` rỗng cho mọi phụ thuộc bắc cầu của từng chunk lười chỉ để trình duyệt tải sớm; bản đồ preload của Vite
          // (`__vite__mapDeps`) đã liệt kê đủ các phụ thuộc đó cho mỗi import động, nên 345 import rỗng ấy chỉ thêm byte (−15 KB tổng, thứ tự chạy mô-đun không đổi).
          hoistTransitiveImports: false,
          // Giữ mẫu tên của zmp-vite-plugin (đuôi `.module.js`), chỉ rút mã băm từ 8 xuống 7 ký tự base64url (42 bit, vẫn hơn 8 ký tự hex = 32 bit):
          // tên chunk lặp lại ở mọi lệnh import và bản đồ preload (~1 600 lần), mỗi lần ngắn 1 byte.
          entryFileNames: 'assets/[name].[hash:7].module.js',
          chunkFileNames: 'assets/[name].[hash:7].module.js',
          assetFileNames: 'assets/[name]-[hash:7][extname]',
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

