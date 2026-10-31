import { readFileSync, writeFileSync } from 'node:fs';
import type { Plugin } from 'vite';

type Item = { type: 'chunk'; fileName: string; imports: string[]; isEntry: boolean; isDynamicEntry: boolean; facadeModuleId: string | null } | { type: 'asset'; fileName: string };

/** Chunk `home-below` và mọi chunk nó cần (không tính entry, đã nạp bằng thẻ script). */
export function homeBelowPreloadFiles(bundle: Record<string, Item>): string[] {
  const root = Object.values(bundle).find((c) => c.type === 'chunk' && c.isDynamicEntry && c.facadeModuleId?.endsWith('/components/home/home-below.tsx'));
  if (!root) return [];
  const seen = new Set<string>();
  const walk = (file: string) => {
    const c = bundle[file];
    if (seen.has(file) || c?.type !== 'chunk' || c.isEntry) return;
    seen.add(file);
    c.imports.forEach(walk);
  };
  walk(root.fileName);
  return [...seen];
}

/** Thêm tên chunk vào `listAsyncJS` của app-config.json (không đổi gì khác). */
export function appConfigWithAsyncJs<T extends { listAsyncJS?: string[] }>(config: T, files: string[]): T {
  if (!files.length) return config;
  return { ...config, listAsyncJS: [...new Set([...(config.listAsyncJS ?? []), ...files])] };
}

/** Tên chunk các thẻ modulepreload `./assets/...` trong index.html (đầu ra của build). */
export function modulePreloadFilesFromHtml(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*>/g)]
    .map((m) => /\bhref="\.\/([^"]+)"/.exec(m[0])?.[1])
    .filter((f): f is string => !!f);
}

/** Bước sau `zmp sync-config www/index.html`: lệnh đó chỉ đọc thẻ script/style/stylesheet nên làm rơi thẻ modulepreload. */
export function addPreloadsToAppConfig(wwwDir: string): string[] {
  const files = modulePreloadFilesFromHtml(readFileSync(`${wwwDir}/index.html`, 'utf8'));
  const path = `${wwwDir}/app-config.json`;
  writeFileSync(path, JSON.stringify(appConfigWithAsyncJs(JSON.parse(readFileSync(path, 'utf8')), files)));
  return files;
}

// Các khối Trang chủ dưới màn đầu (home-below) được nạp bằng import() động, nên trình duyệt chỉ biết tên chunk và các chunk nó cần sau khi entry chạy:
// mỗi tầng phụ thuộc là một vòng RTT nối tiếp, làm thẻ sản phẩm đầu trễ hơn hẳn lúc các khối này còn nằm trong entry. Khai báo modulepreload ngay trong
// index.html để chúng tải song song với entry.
// Mini App trên Zalo không nạp index.html mà dựng trang từ app-config.json (zmp-vite-plugin ghi lúc build), nên cũng đưa chunk vào listAsyncJS ở đó.
export function preloadHomeBelow(): Plugin {
  let files: string[] = [];
  return {
    name: 'tubu-preload-home-below',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        files = homeBelowPreloadFiles(ctx.bundle as unknown as Record<string, Item>);
        return files.map((f) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: '', href: `./${f}` },
          injectTo: 'head' as const,
        }));
      },
    },
    closeBundle: {
      order: 'post',
      handler() {
        if (files.length) addPreloadsToAppConfig('www');
      },
    },
  };
}
