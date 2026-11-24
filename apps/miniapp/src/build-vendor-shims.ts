import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Bản build Mini thay các thư viện nặng mà app chỉ dùng một góc nhỏ bằng shim cùng API (Zalo cân tổng dung lượng gói):
 *   - zod nhúng trong `zmp-sdk/apis/external/zod` → `build-zod-passthrough.ts` (SDK chỉ dùng zod để kiểm tham số, xem tệp đó).
 *   - `@react-spring/web` và `@use-gesture/react` → `build-sheet-spring.ts`, `build-sheet-drag.ts`, chỉ làm đủ API cho `zmp-ui` Sheet
 *     (`sheet/content.js`). Module khác nhập hai gói này (Swiper, ImageViewer qua barrel của zmp-ui) vẫn giải về gói thật để Rollup kiểm tên
 *     export; app không dùng chúng nên tree-shake bỏ hết. Còn byte nào của gói thật trong bản build (tức là có thành phần mới dùng chúng)
 *     thì build dừng: thêm thành phần đó thì phải kiểm lại shim, hoặc trả gói thật cho cả Sheet.
 *   - `zmp-ui/esm/components/snackbar-provider` (SnackbarProvider + useSnackbar, kéo theo Icon và Progress của zmp-ui) → `build-snackbar-shim.ts`,
 *     hộp thông báo cùng API mà app dùng. Hai lối vào của zmp-ui (barrel `esm/index.js` và `esm/hooks/useSnackbar`) đều nhập thư mục này.
 *   - `react/jsx-runtime` → `build-jsx-runtime.ts`: cùng ba hàm của runtime thật, xuất thành binding ES module để chỗ gọi JSX không phải đọc thuộc tính
 *     của object CommonJS (`j.jsx(…)` thành `a(…)`).
 * Chỉ áp cho build: dev gói sẵn zmp-ui/zmp-sdk bằng esbuild (optimizeDeps) nên vẫn chạy thư viện gốc; e2e chạy trên bản build thật.
 */
export const SHEET_CONTENT_FILE = /[\\/]zmp-ui[\\/]esm[\\/]components[\\/]sheet[\\/]content\.js$/;
export const ZMP_SDK_FILE = /[\\/]zmp-sdk[\\/]apis[\\/]/;
export const ZMP_SDK_ZOD_IMPORT = /(^|\/)external\/zod\/lib\/index\.mjs\.js$/;
/** Tệp của zmp-ui (bản esm) nhập thư mục Snackbar: barrel và hook `useSnackbar`. */
export const ZMP_UI_ESM_FILE = /[\\/]zmp-ui[\\/]esm[\\/]/;
export const SNACKBAR_PROVIDER_IMPORT = /(^|\/)components\/snackbar-provider(\/index(\.js)?)?$/;
/** Mã của gói thật đã được thay; không được còn trong bản build. zod nhúng của zmp-sdk và Snackbar của zmp-ui cũng vậy. */
export const REPLACED_VENDOR_FILE =
  /[\\/]node_modules[\\/](@react-spring|@use-gesture)[\\/]|[\\/]zmp-sdk[\\/]apis[\\/]external[\\/]zod[\\/]|[\\/]zmp-ui[\\/]esm[\\/]components[\\/]snackbar-provider[\\/]/;

export const SHEET_SHIMS: Readonly<Record<string, string>> = {
  '@react-spring/web': 'build-sheet-spring.ts',
  '@use-gesture/react': 'build-sheet-drag.ts',
};

const shimPath = (file: string) => fileURLToPath(new URL(`./${file}`, import.meta.url));

/** `react/jsx-runtime` xuất lại thành binding ES module (build-jsx-runtime.ts); chính tệp shim vẫn nhập runtime thật. */
export const JSX_RUNTIME_SHIM_FILE = /[\\/]src[\\/]build-jsx-runtime\.ts$/;

/** Đường dẫn shim cho một lệnh import, `null` nếu không thay. */
export function resolveVendorShim(source: string, importer: string | undefined): string | null {
  const from = (importer ?? '').split('?')[0] ?? '';
  if (source === 'react/jsx-runtime' && from && !JSX_RUNTIME_SHIM_FILE.test(from)) return shimPath('build-jsx-runtime.ts');
  const sheetShim = SHEET_SHIMS[source];
  if (sheetShim && SHEET_CONTENT_FILE.test(from)) return shimPath(sheetShim);
  if (ZMP_SDK_ZOD_IMPORT.test(source) && ZMP_SDK_FILE.test(from)) return shimPath('build-zod-passthrough.ts');
  if (SNACKBAR_PROVIDER_IMPORT.test(source) && ZMP_UI_ESM_FILE.test(from)) return shimPath('build-snackbar-shim.ts');
  return null;
}

/**
 * Thành phần con zmp-ui gắn làm thuộc tính tĩnh (`Input.OTP = OTP`) nên Rollup luôn giữ cả module dù app không dùng. Bản build bỏ lệnh import
 * và lệnh gắn của các thành phần Mini không dựng; `build-vendor-shims.spec.ts` canh để mã app không gọi tới chúng.
 * Mỗi chuỗi phải có mặt đúng như trong zmp-ui 1.11.14: thiếu là zmp-ui đã đổi, build dừng thay vì lặng lẽ giữ nguyên.
 */
export const ZMP_UI_UNUSED_STATICS: readonly { file: RegExp; remove: readonly string[] }[] = [
  {
    file: /[\\/]zmp-ui[\\/]esm[\\/]components[\\/]input[\\/]index\.js$/,
    remove: ['import Password from "./Password";', 'import OTP from "./OTP";', 'Input.Password = Password;', 'Input.OTP = OTP;'],
  },
  {
    file: /[\\/]zmp-ui[\\/]esm[\\/]components[\\/]sheet[\\/]index\.js$/,
    remove: ['import ActionSheet from "./action-sheet";', 'Sheet.Actions = ActionSheet;'],
  },
];

export function dropUnusedZmpUiStatics(code: string, id: string): string | null {
  const entry = ZMP_UI_UNUSED_STATICS.find((e) => e.file.test(id));
  if (!entry) return null;
  let out = code;
  for (const text of entry.remove) {
    if (!out.includes(text)) throw new Error(`zmp-ui đã đổi: không thấy "${text}" trong ${id}; kiểm lại ZMP_UI_UNUSED_STATICS.`);
    out = out.split(text).join('');
  }
  return out;
}

/**
 * Icon lucide-react là mảng nét tĩnh `["path", { d: "…", key: "60hf96" }]` mà `Icon` dựng thành mảng con của `<svg>`. `key` chỉ để React bản dev
 * khỏi cảnh báo; bản production so con theo thứ tự, mà mảng nét của một icon không bao giờ đổi, nên bỏ key không đổi DOM (~13 byte × mỗi nét).
 */
export const LUCIDE_ICON_FILE = /[\\/]lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/][^\\/]+\.mjs$/;
const LUCIDE_NODE_KEY = /,\s*key:\s*"[^"]*"/g;

export function dropLucideNodeKeys(code: string, id: string): string | null {
  return LUCIDE_ICON_FILE.test(id) ? code.replace(LUCIDE_NODE_KEY, '') : null;
}

/** Module của gói đã thay mà vẫn có mã trong bản build (`renderedLength > 0`). */
export function leakedReplacedVendors(rendered: ReadonlyMap<string, number>): string[] {
  return [...rendered].filter(([id, len]) => len > 0 && REPLACED_VENDOR_FILE.test(id)).map(([id]) => id);
}

export function vendorShimsPlugin(): Plugin {
  return {
    name: 'tubu:vendor-shims',
    apply: 'build',
    enforce: 'pre',
    resolveId(source, importer) {
      return resolveVendorShim(source, importer);
    },
    transform(code, rawId) {
      const id = rawId.split('?')[0] ?? rawId;
      try {
        const out = dropUnusedZmpUiStatics(code, id) ?? dropLucideNodeKeys(code, id);
        return out === null ? null : { code: out, map: null };
      } catch (e) {
        return this.error((e as Error).message);
      }
    },
    generateBundle(_options, bundle) {
      const rendered = new Map<string, number>();
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        for (const [id, m] of Object.entries(out.modules)) rendered.set(id, m.renderedLength);
      }
      const leaked = leakedReplacedVendors(rendered);
      if (leaked.length > 0) {
        this.error(`Bản build còn mã của gói đã thay bằng shim (build-vendor-shims.ts): ${leaked.join(', ')}. Thành phần mới dùng chúng thì phải kiểm lại API của shim.`);
      }
    },
  };
}
