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

const TW_VAR_REF = /var\(\s*(--tw-[A-Za-z0-9_-]+)/g;
const TW_VAR_NAME = /--tw-[A-Za-z0-9_-]+/g;
/** Selector chuẩn hoá để so: bỏ khoảng trắng, `::before` → `:before`, các vế xếp theo thứ tự (`*, ::before, ::after` = `*,:after,:before`). */
const normalizeSelector = (s: string) => s.replace(/\s+/g, '').replace(/::(before|after)/g, ':$1').split(',').sort().join(',');

/** Biến `--tw-*` mà CSS đọc qua `var()` hoặc JS nhắc tên, gom trên MỌI tệp của bản build (tiện ích Tailwind có thể nằm ở tệp CSS tải lười qua `@apply`). */
export function tailwindVarUsage(cssFiles: readonly string[], jsFiles: readonly string[]): { used: Set<string>; backdropRules: boolean } {
  const used = new Set<string>();
  for (const css of cssFiles) for (const m of css.matchAll(TW_VAR_REF)) used.add(m[1] ?? '');
  for (const js of jsFiles) for (const m of js.matchAll(TW_VAR_NAME)) used.add(m[0]);
  let backdropRules = false;
  for (const css of cssFiles) {
    postcss.parse(css).walkRules((rule) => {
      if (rule.selector.includes('::backdrop') && normalizeSelector(rule.selector) !== '::backdrop') backdropRules = true;
    });
  }
  return { used, backdropRules };
}

/**
 * Tailwind 3 luôn chép giá trị gốc của MỌI biến tiện ích vào `*, ::before, ::after` và `::backdrop`, kể cả biến của tiện ích app không dùng
 * (pan/pinch-zoom, backdrop-*, contain-*…). Biến không ai đọc qua `var()` không có tác dụng gì nên bỏ; khối `::backdrop` chỉ phục vụ biến thể
 * `backdrop:` nên khi không luật nào nhắm `::backdrop` thì bỏ cả khối. Hành vi hiển thị không đổi, nên bản cũ cùng tên tệp còn trong bộ đệm
 * (tên băm trước bước này) vẫn đúng.
 */
export function dropUnusedTailwindDefaults(css: string, usage: { used: ReadonlySet<string>; backdropRules: boolean }): { css: string; removed: number } {
  const root = postcss.parse(css);
  let removed = 0;
  root.walkRules((rule) => {
    const sel = normalizeSelector(rule.selector);
    const isUniversal = sel === normalizeSelector('*, ::before, ::after');
    const isBackdrop = sel === '::backdrop';
    if (!isUniversal && !isBackdrop) return;
    rule.each((n) => {
      if (n.type !== 'decl' || !n.prop.startsWith('--tw-')) return;
      if (isBackdrop ? usage.backdropRules && usage.used.has(n.prop) : usage.used.has(n.prop)) return;
      n.remove();
      removed++;
    });
    if (rule.nodes.length === 0) rule.remove();
  });
  return removed === 0 ? { css, removed } : { css: root.toString(), removed };
}

const ZAUI_VAR_REF = /var\(\s*(--zaui-[A-Za-z0-9_-]+)/g;
const ZAUI_VAR_NAME = /--zaui-[A-Za-z0-9_-]+/g;

/** Biến `--zaui-*` mà CSS đọc qua `var()` hoặc JS nhắc tên (style inline của zmp-ui như `--zaui-tabbar-width`), gom trên MỌI tệp của bản build. */
export function zauiVarUsage(cssFiles: readonly string[], jsFiles: readonly string[]): Set<string> {
  const used = new Set<string>();
  for (const css of cssFiles) for (const m of css.matchAll(ZAUI_VAR_REF)) used.add(m[1] ?? '');
  for (const js of jsFiles) for (const m of js.matchAll(ZAUI_VAR_NAME)) used.add(m[0]);
  return used;
}

/**
 * `pruneUnusedZauiVars` (build-zaui-prune.ts) chỉ thấy `zaui.css`, nên giá trị `zaui-bridge.css` ghi đè cho biến mà luật đọc nó đã bị cắt
 * (vd biến nút cỡ medium/large, biến tông neutral) vẫn sống trong CSS cuối. Ở đây đối chiếu với CSS + JS cuối cùng của cả bản build: khai báo
 * `--zaui-*` không ai đọc thì bỏ, lặp tới khi ổn định vì giá trị của biến này hay chỉ tới biến kia. Không đụng biến nào khác.
 */
export function dropUnusedZauiVars(css: string, usedElsewhere: ReadonlySet<string>): { css: string; removed: number } {
  const root = postcss.parse(css);
  let removed = 0;
  for (;;) {
    const used = new Set(usedElsewhere);
    root.walkDecls((decl) => {
      for (const m of decl.value.matchAll(ZAUI_VAR_REF)) used.add(m[1] ?? '');
    });
    let changed = false;
    root.walkDecls(/^--zaui-/, (decl) => {
      if (used.has(decl.prop)) return;
      decl.remove();
      removed++;
      changed = true;
    });
    if (!changed) break;
  }
  root.walkRules((rule) => {
    if (rule.nodes.length === 0) rule.remove();
  });
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
        const items = Object.values(bundle);
        const css = items.filter((i): i is typeof i & { type: 'asset'; source: string } => i.type === 'asset' && i.fileName.endsWith('.css') && typeof i.source === 'string');
        const js = items.flatMap((i) => (i.type === 'chunk' ? [i.code] : []));
        const usage = tailwindVarUsage(css.map((i) => i.source), js);
        for (const item of css) item.source = dropUnusedTailwindDefaults(dropOverriddenRootVars(item.source).css, usage).css;
        // Mỗi tệp tự lặp trên `var()` của chính nó; từ bên ngoài chỉ tính tệp CSS khác và JS (tính cả tệp này thì biến chỉ khai báo chết đọc sẽ sống mãi).
        for (const item of css) {
          const others = css.filter((o) => o !== item).map((o) => o.source);
          item.source = dropUnusedZauiVars(item.source, zauiVarUsage(others, js)).css;
        }
      },
    },
  };
}
