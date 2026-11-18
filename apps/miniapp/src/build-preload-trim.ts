import type { Plugin } from 'vite';

/**
 * Bản đồ preload của Vite (`__vite__mapDeps`) ghi, cho mỗi import động, mọi chunk JS nó cần, kể cả chunk khởi động: entry và bao đóng import
 * tĩnh của nó (vendor-react, vendor-state, vendor-zmp-sdk). Các chunk này đã chạy xong trước khi bất kỳ import động nào được gọi, nên preload
 * lại chúng không làm gì; nhưng tên tệp của chúng lặp ~45 lần trong bản build mà Zalo cân theo byte thô. CSS giữ nguyên (Vite tách CSS ra trước
 * khi gọi `resolveDependencies`).
 */

type BundleEntry = { type: 'chunk'; fileName: string; isEntry: boolean; imports: string[] } | { type: 'asset'; fileName: string };

/** Entry và bao đóng import tĩnh của nó. */
export function startupChunks(bundle: Record<string, BundleEntry>): Set<string> {
  const out = new Set<string>();
  const queue = Object.values(bundle).flatMap((c) => (c.type === 'chunk' && c.isEntry ? [c.fileName] : []));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (out.has(file)) continue;
    out.add(file);
    const c = bundle[file];
    if (c?.type === 'chunk') queue.push(...c.imports);
  }
  return out;
}

/**
 * Plugin ghi lại tập chunk khởi động ở `generateBundle` (thứ tự `pre`, trước `vite:build-import-analysis` dựng bản đồ preload) và hàm cho
 * `build.modulePreload.resolveDependencies` bỏ các chunk đó. Chưa ghi được tập (thứ tự hook đổi) thì giữ nguyên danh sách: chỉ mất phần tiết kiệm.
 */
export function preloadTrim(): { plugin: Plugin; resolveDependencies: (file: string, deps: string[], ctx: { hostType: 'html' | 'js' }) => string[] } {
  let startup = new Set<string>();
  return {
    plugin: {
      name: 'tubu-preload-trim',
      apply: 'build',
      generateBundle: {
        order: 'pre',
        handler(_options, bundle) {
          startup = startupChunks(bundle as unknown as Record<string, BundleEntry>);
        },
      },
    },
    resolveDependencies: (_file, deps, ctx) => (ctx.hostType === 'js' ? deps.filter((d) => !startup.has(d)) : deps),
  };
}
