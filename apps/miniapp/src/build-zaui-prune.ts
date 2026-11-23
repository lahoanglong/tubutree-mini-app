import postcss from 'postcss';
import type { Plugin } from 'vite';

/**
 * `zmp-ui/zaui.css` là một tệp nguyên khối (~120 KB) mang kiểu cho cả bộ thành phần, kể cả cái app không bao giờ dựng.
 * zmp-ui tạo tên lớp lúc chạy bằng `getPrefixCls('<thành-phần>')`, nên một luật CSS chỉ khớp được khi mã của đúng thành phần đó
 * có trong bản build. Các thư mục dưới đây không nằm trong đồ thị module của bản build (đo bằng renderedModules của Rollup)
 * và `build-zaui-prune.spec.ts` canh để chúng không lọt vào phần bao đóng import của thành phần app đang dùng.
 */
export const PRUNED_ZMP_UI_COMPONENTS = [
  'avatar',
  'bottom-navigation',
  'box',
  'calendar',
  'center',
  'checkbox',
  'cluster',
  'date-picker',
  'grid',
  'header',
  'icon',
  'image-viewer',
  'input',
  'list',
  'modal',
  'picker',
  'progress',
  'radio',
  'select',
  'slider',
  'snackbar-provider',
  'spinner',
  'stack',
  'swiper',
  'switch',
  'tabs',
  'text',
  'zbox',
] as const;

/**
 * Thư mục zmp-ui mà bản build thay cả mã bằng shim (`build-vendor-shims.ts`): app vẫn nhập `SnackbarProvider`/`useSnackbar` từ 'zmp-ui' nhưng
 * Rollup nạp `build-snackbar-shim.ts`, nên bao đóng import trong `build-zaui-prune.spec.ts` dừng ở đây (Icon, Progress chỉ thư mục này kéo theo).
 */
export const SHIMMED_ZMP_UI_COMPONENTS = ['snackbar-provider'] as const;

/**
 * Lớp mang token của thành phần bị cắt nhưng do hạ tầng dùng chung sinh ra: `common/modal-wrapper` (Sheet dựng nó) đặt tên `zaui-modal-wrapper`.
 * Giữ nguyên; spec đối chiếu danh sách này với `getPrefixCls(...)` của thành phần app dùng nên thiếu mục ở đây sẽ đỏ.
 */
export const PRUNE_EXEMPT_CLASSES = ['zaui-modal-wrapper'] as const;

/**
 * Lớp bổ nghĩa của Button (thành phần vẫn dùng) mà không đường dựng nào của Mini sinh ra. zmp-ui Button chỉ thêm chúng theo prop `type`
 * (highlight/danger), `size` (small/medium/large) và `suffixIcon`: nút của app (`ui/button.tsx`, `ui/empty-state.tsx`) không truyền các prop đó,
 * `Input` của zmp-ui (nơi `Input.Search` dựng nút kính lúp) app không còn dùng, còn `Sheet.Actions` app không dùng.
 * `build-zaui-prune.spec.ts` canh cả ba điều kiện.
 */
export const PRUNED_ZAUI_CLASSES = ['zaui-btn-highlight', 'zaui-btn-danger', 'zaui-btn-small', 'zaui-btn-medium', 'zaui-btn-large', 'zaui-btn-suffix-icon'] as const;

/**
 * Họ lớp (`tiền-tố` và `tiền-tố-*`) của thành phần con mà bản build bỏ cả mã (`ZMP_UI_UNUSED_STATICS` trong build-vendor-shims.ts:
 * `Input.OTP`, `Input.Password`, `Sheet.Actions`), cùng các lớp `zaui-sheet-content-action(s)`/`-main` mà `sheet/content.js` (nơi duy nhất sinh
 * lớp `zaui-sheet-content*`) không sinh. `build-zaui-prune.spec.ts` canh: không tệp nào còn trong bản build sinh ra các lớp này.
 */
export const PRUNED_ZAUI_CLASS_FAMILIES = [
  'zaui-action-sheet',
  'zaui-input-otp',
  'zaui-input-password',
  'zaui-sheet-content-action',
  'zaui-sheet-content-actions',
  'zaui-sheet-content-main',
] as const;

function inPrunedFamily(className: string, families: readonly string[]): boolean {
  return families.some((f) => className === f || className.startsWith(`${f}-`));
}

/** Token đầu của lớp CSS (`.zaui-<token>-...`) tương ứng thư mục thành phần: `image-viewer` → `image`, `date-picker` → `date`. */
export function zauiClassToken(component: string): string {
  return component.split('-')[0] ?? component;
}

const CLASS_RE = /\.(zaui-([a-z0-9]+)[a-z0-9-]*)/g;

function isExempt(className: string): boolean {
  return PRUNE_EXEMPT_CLASSES.some((c) => className === c || className.startsWith(`${c}-`));
}

/** Các lớp `.zaui-*` trong một vế selector không bao giờ khớp: của thành phần bị cắt (token thuộc danh sách cắt, không được miễn), lớp bổ nghĩa bị cắt, hoặc thuộc họ lớp bị cắt. */
export function deadZauiClasses(
  selector: string,
  deadTokens: ReadonlySet<string>,
  deadClasses: ReadonlySet<string> = new Set(),
  deadFamilies: readonly string[] = [],
): string[] {
  return [...selector.matchAll(CLASS_RE)]
    .filter((m) => (deadTokens.has(m[2] ?? '') || deadClasses.has(m[1] ?? '') || inPrunedFamily(m[1] ?? '', deadFamilies)) && !isExempt(m[1] ?? ''))
    .map((m) => m[1] ?? '');
}

/**
 * `<App>` của zmp-ui đặt `body[zaui-theme]` theo prop `theme` (mặc định light) và chỉ đổi khi app gọi `useTheme()`.
 * Mini không làm cả hai (`build-zaui-prune.spec.ts` canh), nên luật chỉ dành cho chủ đề tối (~16 KB) không bao giờ khớp.
 */
const DARK_THEME_RE = /\[zaui-theme=["']?dark["']?\]/;

export function isDarkThemeOnly(selector: string): boolean {
  return selector.split(',').every((part) => DARK_THEME_RE.test(part));
}

/** Bỏ mọi luật mà MỌI vế của danh sách selector đều nhắm vào lớp của thành phần bị cắt, lớp bổ nghĩa bị cắt, họ lớp bị cắt hoặc chỉ khớp chủ đề tối; luật chung (`:root`, biến, lớp dùng chung) giữ nguyên. */
export function pruneZauiCss(
  css: string,
  components: readonly string[] = PRUNED_ZMP_UI_COMPONENTS,
  classes: readonly string[] = PRUNED_ZAUI_CLASSES,
  families: readonly string[] = PRUNED_ZAUI_CLASS_FAMILIES,
): { css: string; removedSelectors: string[] } {
  const dead = new Set(components.map(zauiClassToken));
  const deadClasses = new Set(classes);
  const root = postcss.parse(css);
  const removedSelectors: string[] = [];
  const animationNames = (decl: postcss.Declaration): string[] => decl.value.split(/[\s,]+/).filter(Boolean);
  // Chỉ động tới @keyframes mà MỖI luật bị bỏ từng nhắc tới; keyframes mồ côi từ đầu (có thể CSS của app dùng theo tên) giữ nguyên.
  const orphanCandidates = new Set<string>();

  root.walkRules((rule) => {
    const parts = rule.selector.split(',').map((s) => s.trim());
    const allDead = parts.every((part) => deadZauiClasses(part, dead, deadClasses, families).length > 0 || DARK_THEME_RE.test(part));
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

  pruneUnusedZauiVars(root);
  return { css: root.toString(), removedSelectors };
}

/** Biến `--zaui-*` mà JS của zmp-ui đặt hay đọc theo tên (style inline); `build-zaui-prune.spec.ts` đối chiếu với mã zmp-ui. */
export const ZAUI_JS_VARS = ['--zaui-tabbar-width', '--zaui-avatar-size'] as const;

const ZAUI_VAR_REF = /var\(\s*(--zaui-[A-Za-z0-9_-]+)/g;

/**
 * Bỏ khai báo `--zaui-*` không còn ai đọc qua `var()` sau khi cắt luật (biến của thành phần bị cắt và của chủ đề tối, ~11 KB).
 * Lặp tới khi ổn định vì biến này hay chỉ tới biến kia. Mã app không đọc biến `--zaui-*` nào (spec canh); `zaui-bridge.css` chỉ ghi đè giá trị.
 */
export function pruneUnusedZauiVars(root: postcss.Root): string[] {
  const removed: string[] = [];
  for (;;) {
    const used = new Set<string>(ZAUI_JS_VARS);
    root.walkDecls((decl) => {
      for (const m of decl.value.matchAll(ZAUI_VAR_REF)) used.add(m[1] ?? '');
    });
    let changed = false;
    root.walkDecls(/^--zaui-/, (decl) => {
      if (used.has(decl.prop)) return;
      removed.push(decl.prop);
      decl.remove();
      changed = true;
    });
    if (!changed) break;
  }
  root.walkRules((rule) => {
    if (rule.nodes.length === 0) rule.remove();
  });
  return removed;
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
