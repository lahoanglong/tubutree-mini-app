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

// Các khối Trang chủ dưới màn đầu (home-below) được nạp bằng import() động, nên trình duyệt chỉ biết tên chunk và các chunk nó cần sau khi entry chạy:
// mỗi tầng phụ thuộc là một vòng RTT nối tiếp, làm thẻ sản phẩm đầu trễ hơn hẳn lúc các khối này còn nằm trong entry. Khai báo modulepreload ngay trong
// index.html để chúng tải song song với entry.
export function preloadHomeBelow(): Plugin {
  return {
    name: 'tubu-preload-home-below',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        return homeBelowPreloadFiles(ctx.bundle as unknown as Record<string, Item>).map((f) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: '', href: `./${f}` },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}
