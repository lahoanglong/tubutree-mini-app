import postcss from 'postcss';
import type { Plugin } from 'vite';

/**
 * `zmp-ui/zaui.css` là một tệp nguyên khối (~120 KB) mang kiểu cho cả bộ thành phần, kể cả cái app không bao giờ dựng.
 * zmp-ui tạo tên lớp lúc chạy bằng `getPrefixCls('<thành-phần>')`, nên một luật CSS chỉ khớp được khi mã của đúng thành phần đó
 * có trong bản build. Các thư mục dưới đây không nằm trong đồ thị module của bản build (đo bằng renderedModules của Rollup)
 * và `build-zaui-prune.spec.ts` canh để chúng không lọt vào phần bao đóng import của thành phần app đang dùng.
 */
export const PRUNED_ZMP_UI_COMPONENTS = [
  'bottom-navigation',
  'calendar',
  'center',
  'cluster',
  'date-picker',
  'grid',
  'header',
  'image-viewer',
  'list',
  'modal',
  'picker',
  'select',
  'slider',
  'stack',
  'swiper',
  'tabs',
  'zbox',
] as const;

/**
 * Lớp mang token của thành phần bị cắt nhưng do hạ tầng dùng chung sinh ra: `common/modal-wrapper` (Sheet dựng nó) đặt tên `zaui-modal-wrapper`.
 * Giữ nguyên; spec đối chiếu danh sách này với `getPrefixCls(...)` của thành phần app dùng nên thiếu mục ở đây sẽ đỏ.
 */
export const PRUNE_EXEMPT_CLASSES = ['zaui-modal-wrapper'] as const;

/** Token đầu của lớp CSS (`.zaui-<token>-...`) tương ứng thư mục thành phần: `image-viewer` → `image`, `date-picker` → `date`. */
export function zauiClassToken(component: string): string {
  return component.split('-')[0] ?? component;
}

const CLASS_RE = /\.(zaui-([a-z0-9]+)[a-z0-9-]*)/g;

function isExempt(className: string): boolean {
  return PRUNE_EXEMPT_CLASSES.some((c) => className === c || className.startsWith(`${c}-`));
}

/** Các lớp `.zaui-*` trong một vế selector mà thành phần bị cắt sở hữu (token thuộc danh sách cắt và không được miễn). */
export function deadZauiClasses(selector: string, deadTokens: ReadonlySet<string>): string[] {
  return [...selector.matchAll(CLASS_RE)].filter((m) => deadTokens.has(m[2] ?? '') && !isExempt(m[1] ?? '')).map((m) => m[1] ?? '');
}

/** Bỏ mọi luật mà MỌI vế của danh sách selector đều nhắm vào lớp của thành phần bị cắt; luật chung (`:root`, biến, lớp dùng chung) giữ nguyên. */
export function pruneZauiCss(css: string, components: readonly string[] = PRUNED_ZMP_UI_COMPONENTS): { css: string; removedSelectors: string[] } {
  const dead = new Set(components.map(zauiClassToken));
  const root = postcss.parse(css);
  const removedSelectors: string[] = [];
  const animationNames = (decl: postcss.Declaration): string[] => decl.value.split(/[\s,]+/).filter(Boolean);
  // Chỉ động tới @keyframes mà MỖI luật bị bỏ từng nhắc tới; keyframes mồ côi từ đầu (có thể CSS của app dùng theo tên) giữ nguyên.
  const orphanCandidates = new Set<string>();

  root.walkRules((rule) => {
    const parts = rule.selector.split(',').map((s) => s.trim());
    const allDead = parts.every((part) => deadZauiClasses(part, dead).length > 0);
    if (!allDead) return;
    removedSelectors.push(rule.selector);
    rule.walkDecls(/^(-webkit-)?animation(-name)?$/i, (decl) => animationNames(decl).forEach((n) => orphanCandidates.add(n)));
    rule.remove();
  });

  // Khung @media/@supports rỗng sau khi bỏ luật.
  root.walkAtRules((at) => {
    if (at.nodes && at.nodes.length === 0 && /^(media|supports|layer)$/i.test(at.name)) at.remove();
  });

  const stillReferenced = new Set<string>();
  root.walkDecls(/^(-webkit-)?animation(-name)?$/i, (decl) => animationNames(decl).forEach((n) => stillReferenced.add(n)));
  root.walkAtRules(/keyframes$/i, (at) => {
    const name = at.params.trim();
    if (orphanCandidates.has(name) && !stillReferenced.has(name)) at.remove();
  });

  return { css: root.toString(), removedSelectors };
}

/** Chỉ đổi `zmp-ui/zaui.css`; CSS khác của app đi nguyên. Chạy trước vite:css nên tác dụng cả dev lẫn build. */
export function pruneUnusedZauiCssPlugin(): Plugin {
  return {
    name: 'tubu:prune-unused-zaui-css',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]zmp-ui[\\/]zaui\.css$/.test((id.split('?')[0] ?? id))) return null;
      return { code: pruneZauiCss(code).css, map: null };
    },
  };
}
