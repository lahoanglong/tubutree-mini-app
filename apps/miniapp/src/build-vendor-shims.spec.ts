import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import zodShim, * as zodShimNamed from './build-zod-passthrough';
import {
  LUCIDE_ICON_FILE,
  REPLACED_VENDOR_FILE,
  ZMP_UI_UNUSED_STATICS,
  dropLucideNodeKeys,
  dropUnusedZmpUiStatics,
  leakedReplacedVendors,
  resolveVendorShim,
} from './build-vendor-shims';

const here = path.dirname(fileURLToPath(import.meta.url));
const real = (pkg: string) => fs.realpathSync(path.resolve(here, '../node_modules', pkg));
const ZMP_UI_ESM = path.join(real('zmp-ui'), 'esm');
const SDK_APIS = path.join(real('zmp-sdk'), 'apis');
const SHEET_CONTENT = path.join(ZMP_UI_ESM, 'components', 'sheet', 'content.js');
const ZOD_IMPORT = './../external/zod/lib/index.mjs.js';

function walk(dir: string, keep: (p: string) => boolean, skipDir: (p: string) => boolean = () => false, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skipDir(p)) walk(p, keep, skipDir, out);
    } else if (keep(p)) out.push(p);
  }
  return out;
}

describe('resolveVendorShim', () => {
  it('chỉ thay react-spring/use-gesture cho sheet/content.js của zmp-ui', () => {
    expect(resolveVendorShim('@react-spring/web', SHEET_CONTENT)).toBe(path.join(here, 'build-sheet-spring.ts'));
    expect(resolveVendorShim('@use-gesture/react', `${SHEET_CONTENT}?v=1`)).toBe(path.join(here, 'build-sheet-drag.ts'));
    // Swiper/ImageViewer vẫn giải về gói thật để Rollup kiểm tên export (`useSprings` không có trong shim).
    expect(resolveVendorShim('@react-spring/web', path.join(ZMP_UI_ESM, 'components', 'swiper', 'index.js'))).toBeNull();
    expect(resolveVendorShim('@use-gesture/react', path.join(ZMP_UI_ESM, 'components', 'image-viewer', 'index.js'))).toBeNull();
    expect(resolveVendorShim('@react-spring/web', path.join(here, 'app.tsx'))).toBeNull();
    expect(resolveVendorShim('@react-spring/web', undefined)).toBeNull();
  });

  it('chỉ thay zod nhúng khi bên nhập nằm trong zmp-sdk/apis', () => {
    const setStorage = path.join(SDK_APIS, 'apis', 'setStorage.js');
    const shim = path.join(here, 'build-zod-passthrough.ts');
    expect(resolveVendorShim(ZOD_IMPORT, setStorage)).toBe(shim);
    expect(resolveVendorShim('./../../external/zod/lib/index.mjs.js', path.join(SDK_APIS, 'apis', 'trackingManager', 'logEvent.js'))).toBe(shim);
    expect(resolveVendorShim('zod', setStorage)).toBeNull();
    expect(resolveVendorShim(ZOD_IMPORT, path.join(here, 'app.tsx'))).toBeNull();
  });

  it('trỏ react/jsx-runtime về shim cho mọi bên nhập trừ chính shim (không thì shim tự nhập mình)', () => {
    const shim = path.join(here, 'build-jsx-runtime.ts');
    expect(resolveVendorShim('react/jsx-runtime', path.join(here, 'app.tsx'))).toBe(shim);
    expect(resolveVendorShim('react/jsx-runtime', `${SHEET_CONTENT}?v=1`)).toBe(shim);
    expect(resolveVendorShim('react/jsx-runtime', shim)).toBeNull();
    expect(resolveVendorShim('react/jsx-runtime', `${shim}?v=1`)).toBeNull();
    expect(resolveVendorShim('react/jsx-dev-runtime', path.join(here, 'app.tsx'))).toBeNull();
  });

  it('shim JSX xuất đúng ba hàm của runtime thật', async () => {
    const runtime = await import('react/jsx-runtime');
    const shim = await import('./build-jsx-runtime');
    expect(Object.keys(shim).sort()).toEqual(['Fragment', 'jsx', 'jsxs']);
    expect(shim.jsx).toBe(runtime.jsx);
    expect(shim.jsxs).toBe(runtime.jsxs);
    expect(shim.Fragment).toBe(runtime.Fragment);
  });
});

describe('leakedReplacedVendors', () => {
  it('báo module của gói đã thay còn mã trong bản build, bỏ qua module bị tree-shake hết', () => {
    const rendered = new Map<string, number>([
      ['/x/node_modules/.pnpm/@react-spring+core@9.5.5/node_modules/@react-spring/core/dist/index.mjs', 0],
      ['/x/node_modules/.pnpm/@use-gesture+core@10/node_modules/@use-gesture/core/dist/index.mjs', 120],
      [`${SDK_APIS}/external/zod/lib/types.mjs.js`, 5],
      [SHEET_CONTENT, 900],
      [path.join(here, 'build-sheet-spring.ts'), 400],
    ]);
    expect(leakedReplacedVendors(rendered)).toEqual([
      '/x/node_modules/.pnpm/@use-gesture+core@10/node_modules/@use-gesture/core/dist/index.mjs',
      `${SDK_APIS}/external/zod/lib/types.mjs.js`,
    ]);
    expect(REPLACED_VENDOR_FILE.test(path.join(here, 'build-zod-passthrough.ts'))).toBe(false);
  });
});

describe('dropUnusedZmpUiStatics trên zmp-ui thật', () => {
  it('bỏ import và lệnh gắn Input.OTP/Input.Password/Sheet.Actions, phần còn lại giữ nguyên', () => {
    for (const [dir, entry] of [
      ['input', ZMP_UI_UNUSED_STATICS[0]],
      ['sheet', ZMP_UI_UNUSED_STATICS[1]],
    ] as const) {
      const file = path.join(ZMP_UI_ESM, 'components', dir, 'index.js');
      expect(entry?.file.test(file)).toBe(true);
      const src = fs.readFileSync(file, 'utf8');
      const out = dropUnusedZmpUiStatics(src, file) ?? '';
      for (const text of entry?.remove ?? []) expect(out).not.toContain(text);
      expect(src.length - out.length).toBe((entry?.remove ?? []).reduce((n, t) => n + t.length, 0));
      expect(out).toMatch(/export default (Input|Sheet);/);
    }
    expect(dropUnusedZmpUiStatics('Input.OTP = OTP;', path.join(ZMP_UI_ESM, 'components', 'button', 'index.js'))).toBeNull();
  });

  it('zmp-ui đổi mã thì ném lỗi (build dừng) thay vì lặng lẽ giữ nguyên', () => {
    const file = path.join(ZMP_UI_ESM, 'components', 'input', 'index.js');
    expect(() => dropUnusedZmpUiStatics('import Input from "./input";\nexport default Input;', file)).toThrow(/zmp-ui đã đổi/);
  });

  it('mã app không dùng Input.OTP, Input.Password, Sheet.Actions', () => {
    const appFiles = walk(here, (p) => /\.tsx?$/.test(p) && !/\.spec\.tsx?$/.test(p) && !path.basename(p).startsWith('build-'));
    expect(appFiles.length).toBeGreaterThan(100);
    const offenders = appFiles.filter((f) => /\.(OTP|Password|Actions)\b|ActionSheet/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(here, f))).toEqual([]);
  });
});

describe('dropLucideNodeKeys', () => {
  it('bỏ key của nét icon lucide thật, giữ nguyên thuộc tính vẽ', () => {
    const file = path.join(real('lucide-react'), 'dist', 'esm', 'icons', 'x.mjs');
    const src = fs.readFileSync(file, 'utf8');
    const out = dropLucideNodeKeys(src, file) ?? '';
    expect(out).not.toMatch(/key:/);
    expect(out).toContain('["path", { d: "M18 6 6 18" }]');
    expect(out).toContain('["path", { d: "m6 6 12 12" }]');
    expect(LUCIDE_ICON_FILE.test(file)).toBe(true);
    expect(dropLucideNodeKeys(src, path.join(real('lucide-react'), 'dist', 'esm', 'Icon.mjs'))).toBeNull();
  });

  it('Icon của lucide dựng nét bằng createElement(tag, attrs): key chỉ là gợi ý cho React, không ra DOM', () => {
    const icon = fs.readFileSync(path.join(real('lucide-react'), 'dist', 'esm', 'Icon.mjs'), 'utf8');
    expect(icon).toContain('...iconNode.map(([tag, attrs]) => createElement(tag, attrs))');
  });
});

describe('zod nhúng của zmp-sdk thay bằng passthrough', () => {
  const sdkFiles = walk(SDK_APIS, (p) => p.endsWith('.js'), (p) => path.basename(p) === 'external');
  const zodUsers = sdkFiles.filter((f) => /external\/zod\/lib\/index\.mjs\.js/.test(fs.readFileSync(f, 'utf8')));

  it('shim nhận mọi giá trị và trả lại đúng đối tượng đó', () => {
    type Parser = { safeParse(v: unknown): { success: boolean; data: unknown }; parse(v: unknown): unknown };
    const chain = zodShimNamed.object({ a: zodShimNamed.string() }) as unknown as Record<string, (...a: unknown[]) => Parser & Record<string, (...a: unknown[]) => Parser>>;
    const s = chain.catchall?.(zodShim)?.optional?.() as Parser;
    const arg = { a: 'không phải url', extra: 1 };
    expect(s.safeParse(arg)).toEqual({ success: true, data: arg });
    expect(s.safeParse(arg).data).toBe(arg);
    expect(s.parse(arg)).toBe(arg);
    const z = zodShim as unknown as Record<string, (...a: unknown[]) => Parser> & { then?: unknown };
    expect(z.union?.([])?.safeParse(undefined).success).toBe(true);
    expect(z.then).toBeUndefined();
  });

  it('zmp-sdk chỉ nhập từ zod những tên shim có', () => {
    const named = new Set<string>();
    for (const f of zodUsers) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/import\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["'][^"']*external\/zod\/lib\/index\.mjs\.js["']/g)) {
        for (const part of (m[1] ?? '').split(',')) named.add(part.trim().split(/\s+as\s+/)[0] ?? '');
      }
    }
    expect(zodUsers.length).toBeGreaterThan(50);
    expect([...named].filter((n) => !(n in zodShimNamed))).toEqual([]);
  });

  it('kết quả parse của zod không đi vào lời gọi nào: decorator chỉ dùng safeParse, handler đọc đối số gốc', () => {
    // decorator.js: h là chính mảng đối số gốc m; data đã parse chỉ được đẩy vào CUỐI mảng.
    const decorator = fs.readFileSync(path.join(SDK_APIS, 'utils', 'decorator.js'), 'utf8');
    expect(decorator).toContain('var h=m;l.length>0&&l.forEach((function(r,o){var s=r.safeParse(m[o]);');
    expect(decorator).toContain('h.push(s.data)}));var p=u.apply(void 0,r(h))');
    for (const f of zodUsers) expect(fs.readFileSync(f, 'utf8'), path.relative(SDK_APIS, f)).not.toMatch(/safeParse|[\w$)]\.parse\(/);

    // Handler khai báo không quá số đối số gốc nên không bao giờ đọc tới phần data đã parse ở cuối mảng.
    const unmatched: string[] = [];
    const readsParsed: string[] = [];
    for (const f of zodUsers) {
      const src = fs.readFileSync(f, 'utf8');
      const handler = src.match(/functionHandler as ([\w$]+)\}from/)?.[1];
      const id = handler?.replace(/\$/g, '\\$');
      const call = new RegExp(
        `(?<![\\w$.])${id}\\((?:"\\w+"|[\\w$]+),(?:[\\w$]+|\\[[^\\]]*\\]),\\[([^\\]]*)\\],\\(?(?:[\\w$]+=)?(?:[\\w$]+\\(\\()?function\\(([^)]*)\\)`,
        'g',
      );
      const calls = handler ? [...src.matchAll(call)] : [];
      if (calls.length === 0) unmatched.push(path.relative(SDK_APIS, f));
      for (const m of calls) {
        const args = (m[1] ?? '').split(',').filter(Boolean).length;
        const params = (m[2] ?? '').split(',').filter(Boolean).length;
        if (params > args) readsParsed.push(`${path.relative(SDK_APIS, f)}: ${args} đối số, handler ${params} tham số`);
      }
    }
    expect(unmatched).toEqual([]);
    expect(readsParsed).toEqual([]);
  });
});

describe('sheet/content.js của zmp-ui chỉ dùng phần API shim có', () => {
  const src = fs.readFileSync(SHEET_CONTENT, 'utf8');
  const unique = (xs: (string | undefined)[]) => [...new Set(xs)].sort();

  it('nhập đúng animated, config, to, useSpring và useDrag', () => {
    expect(src).toContain('import { useDrag } from "@use-gesture/react";');
    expect(src).toContain('import { animated, config, to, useSpring } from "@react-spring/web";');
    expect(src.match(/from "@(react-spring|use-gesture)\//g)).toHaveLength(2);
  });

  it('useSpring dạng hàm (config chỉ đọc lúc dựng), api chỉ start/set, useDrag với filterTaps, animated chỉ div', () => {
    expect(src).toContain('var _useSpring = useSpring(function () {');
    expect(unique([...src.matchAll(/\bapi\.(\w+)\(/g)].map((m) => m[1]))).toEqual(['set', 'start']);
    expect(src).toMatch(/useDrag\(handlerDrag, \{\s*filterTaps: true\s*\}\)/);
    expect(unique([...src.matchAll(/\banimated\.(\w+)/g)].map((m) => m[1]))).toEqual(['div']);
    expect(unique([...src.matchAll(/\bconfig\.(\w+)/g)].map((m) => m[1]))).toEqual(['stiff']);
    const start = src.indexOf('var handlerDrag = function handlerDrag(_ref2)');
    const head = src.slice(start, src.indexOf('set({', start));
    expect(unique([...head.matchAll(/_ref2\.(\w+)/g)].map((m) => m[1]))).toEqual(['down', 'event', 'first', 'memo', 'movement', 'velocity']);
  });

  it('duration lúc dựng là ANIMATION_DURATION 200ms khi không có snapPoints', () => {
    const constants = fs.readFileSync(path.join(ZMP_UI_ESM, 'components', 'sheet', 'utils', 'constants.js'), 'utf8');
    expect(constants).toMatch(/ANIMATION_DURATION = 200\b/);
    expect(src).toContain('return !isVisible || !points || currentPoint === points.length - 1 ? ANIMATION_DURATION : undefined;');
  });
});

describe('vite.config.mts', () => {
  it('đăng ký plugin shim cho bản build', () => {
    const cfg = fs.readFileSync(path.resolve(here, '../vite.config.mts'), 'utf8');
    expect(cfg).toContain("import { vendorShimsPlugin } from './src/build-vendor-shims';");
    expect(cfg).toMatch(/vendorShimsPlugin\(\),/);
  });
});
