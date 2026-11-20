import postcss from 'postcss';
import type { Plugin } from 'vite';

/**
 * Bảng CSS chính gộp token của zmp-ui (`zaui.css`), của Tailwind và của app thành nhiều luật `:root` đứng nối nhau; token app định nghĩa lại
 * cùng tên biến nên ~60 khai báo đầu (~3 KB) không bao giờ thắng. Trong một tệp, các luật `:root` ở cấp ngoài cùng cùng độ ưu tiên, nên khai báo
 * sau cùng của mỗi biến thắng; khai báo trước nó chỉ còn ý nghĩa khi có `!important` mà khai báo sau thì không. Luật lồng trong `@media`,
 * `@supports`, `@layer` hay selector khác không bị động tới, và vì khai báo thắng vẫn nằm nguyên chỗ, chúng vẫn so với đúng đối thủ như trước.
 */
export function dropOverriddenRootVars(css: string): { css: string; removed: number } {
  const root = postcss.parse(css);
  const rules = root.nodes.filter((n): n is postcss.Rule => n.type === 'rule' && n.selector.trim() === ':root');
  const winner = new Map<string, postcss.Declaration>();
  for (const rule of rules) rule.each((n) => void (n.type === 'decl' && n.prop.startsWith('--') && winner.set(n.prop, n)));
  let removed = 0;
  for (const rule of rules) {
    rule.each((n) => {
      if (n.type !== 'decl' || !n.prop.startsWith('--')) return;
      const last = winner.get(n.prop);
      if (!last || last === n || (n.important && !last.important)) return;
      n.remove();
      removed++;
    });
    if (rule.nodes.length === 0) rule.remove();
  }
  return removed === 0 ? { css, removed } : { css: root.toString(), removed };
}

/**
 * Chạy trên CSS đã nén cuối cùng (`generateBundle` `order: 'post'`), từng tệp riêng: thứ tự giữa các tệp tải lười không đoán được lúc build.
 * Tên tệp CSS băm từ nội dung TRƯỚC bước này: đổi luật ở đây làm khác đầu ra thì phải đổi cả mẫu `assetFileNames`, không thì bản cũ còn trong
 * bộ đệm mang cùng tên với bản mới.
 */
export function dropOverriddenRootVarsPlugin(): Plugin {
  return {
    name: 'tubu:css-root-vars',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const item of Object.values(bundle)) {
          if (item.type !== 'asset' || !item.fileName.endsWith('.css') || typeof item.source !== 'string') continue;
          item.source = dropOverriddenRootVars(item.source).css;
        }
      },
    },
  };
}
