import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import ts from 'typescript';
import { dropUnusedZmpUiStatics } from './build-vendor-shims';
import {
  PRUNED_ZAUI_CLASS_FAMILIES,
  PRUNED_ZAUI_CLASSES,
  PRUNED_ZMP_UI_COMPONENTS,
  SHIMMED_ZMP_UI_COMPONENTS,
  ZAUI_JS_VARS,
  deadZauiClasses,
  isDarkThemeOnly,
  pruneUnusedZauiVars,
  pruneZauiCss,
  zauiClassToken,
} from './build-zaui-prune';

const here = path.dirname(fileURLToPath(import.meta.url));
const ZMP_UI = fs.realpathSync(path.resolve(here, '../node_modules/zmp-ui'));
const ESM = path.join(ZMP_UI, 'esm');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Tên import có tên từ 'zmp-ui' trong mã app (bỏ spec): `import { Page, type X, Button as ZButton } from 'zmp-ui'`. */
function appZmpUiImports(): { names: Set<string>; unsupported: string[] } {
  const names = new Set<string>();
  const unsupported: string[] = [];
  for (const file of walk(here).filter((f) => /\.tsx?$/.test(f) && !/\.spec\.tsx?$/.test(f))) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s+(?:type\s+)?([^;'"]*?)\s*from\s*'zmp-ui(\/[^']*)?'/g)) {
      const rel = path.relative(here, file);
      if (m[2]) {
        unsupported.push(`${rel}: ${m[0]}`);
        continue;
      }
      const braces = (m[1] ?? '').match(/^\{([^}]*)\}$/);
      if (!braces) {
        unsupported.push(`${rel}: ${m[0]}`);
        continue;
      }
      for (const part of (braces[1] ?? '').split(',')) {
        const name = (part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '').trim();
        if (name) names.add(name);
      }
    }
  }
  return { names, unsupported };
}

/** Mã zmp-ui như bản build thấy: đã bỏ thành phần con không dùng (`ZMP_UI_UNUSED_STATICS` của build-vendor-shims.ts). */
const builtSource = (file: string): string => {
  const src = fs.readFileSync(file, 'utf8');
  return dropUnusedZmpUiStatics(src, file) ?? src;
};

/** Thư mục zmp-ui mà bản build thay bằng shim: Rollup không nạp mã của nó nên bao đóng không đi vào. */
const isShimmed = (file: string): boolean =>
  (SHIMMED_ZMP_UI_COMPONENTS as readonly string[]).some((dir) => file.startsWith(path.join(ESM, 'components', dir) + path.sep));

/** Bao đóng import tương đối trong esm của zmp-ui, bắt đầu từ các export app đang dùng; trả về tập thư mục `components/<tên>` và mọi tệp chạm tới. */
function zmpUiClosure(exportNames: Set<string>): { components: Set<string>; files: Set<string> } {
  const indexSrc = fs.readFileSync(path.join(ESM, 'index.js'), 'utf8');
  const entryByName = new Map<string, string>();
  for (const m of indexSrc.matchAll(/export\s*\{([^}]*)\}\s*from\s*"(\.[^"]+)"/g)) {
    for (const part of (m[1] ?? '').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (name && m[2]) entryByName.set(name, m[2]);
    }
  }
  const resolve = (from: string, spec: string): string | null => {
    const base = path.resolve(path.dirname(from), spec);
    for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    return null;
  };
  const queue: string[] = [];
  for (const name of exportNames) {
    const spec = entryByName.get(name);
    if (!spec) continue; // re-export từ react-router-dom hoặc kiểu
    const start = resolve(path.join(ESM, 'index.js'), spec);
    if (start) queue.push(start);
  }
  const files = new Set<string>();
  const components = new Set<string>();
  while (queue.length) {
    const f = queue.pop()!;
    if (files.has(f) || isShimmed(f)) continue;
    files.add(f);
    const rel = path.relative(path.join(ESM, 'components'), f);
    if (!rel.startsWith('..')) components.add(rel.split(path.sep)[0] ?? rel);
    const src = builtSource(f);
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s*"(\.[^"]+)"|import\s*"(\.[^"]+)"/g)) {
      const next = resolve(f, m[1] ?? m[2] ?? '');
      if (next && !/\.stories\./.test(next) && !next.includes(`${path.sep}.storybook${path.sep}`)) queue.push(next);
    }
  }
  return { components, files };
}

describe('pruneZauiCss — chỉ bỏ luật của thành phần zmp-ui không có trong bản build', () => {
  it('bỏ luật nhắm vào thành phần bị cắt, giữ luật của thành phần đang dùng và luật chung', () => {
    const css = ':root{--zaui-x:1}.zaui-calendar-panel{color:red}.zaui-sheet{color:blue;border-color:var(--zaui-x)}.zaui-btn.zaui-btn-primary{color:green}';
    const { css: out, removedSelectors } = pruneZauiCss(css);
    expect(removedSelectors).toEqual(['.zaui-calendar-panel']);
    expect(out).toContain(':root{--zaui-x:1}');
    expect(out).toContain('.zaui-sheet{color:blue;border-color:var(--zaui-x)}');
    expect(out).toContain('.zaui-btn.zaui-btn-primary{color:green}');
    expect(out).not.toContain('calendar');
  });

  it('danh sách selector trộn: còn một vế của thành phần đang dùng thì giữ cả luật', () => {
    const css = '.zaui-calendar-day,.zaui-sheet-content{color:red}.zaui-tabs-bar,.zaui-modal-content{color:blue}';
    const { css: out, removedSelectors } = pruneZauiCss(css);
    expect(out).toContain('.zaui-calendar-day,.zaui-sheet-content{color:red}');
    expect(removedSelectors).toEqual(['.zaui-tabs-bar,.zaui-modal-content']);
  });

  it('selector lồng (vd .zaui-sheet .zaui-list-item) không thể khớp khi List không có trong bản build → bỏ', () => {
    const { removedSelectors } = pruneZauiCss('.zaui-sheet .zaui-list-item{color:red}');
    expect(removedSelectors).toEqual(['.zaui-sheet .zaui-list-item']);
  });

  it('@media rỗng sau khi bỏ luật bị dọn, @media còn luật giữ nguyên', () => {
    const css = '@media (max-width:1px){.zaui-calendar-x{color:red}}@media (max-width:2px){.zaui-calendar-y{color:red}.zaui-sheet{color:blue}}';
    const out = pruneZauiCss(css).css;
    expect(out).not.toContain('max-width:1px');
    expect(out).toContain('max-width:2px');
    expect(out).toContain('.zaui-sheet{color:blue}');
  });

  it('@keyframes: bỏ khi chỉ luật bị bỏ nhắc tới, giữ khi luật còn lại dùng hoặc vốn không ai nhắc (CSS app có thể dùng theo tên)', () => {
    const css = [
      '@keyframes only-dead{from{opacity:0}to{opacity:1}}',
      '@keyframes shared{from{opacity:0}to{opacity:1}}',
      '@keyframes orphan{from{opacity:0}to{opacity:1}}',
      '.zaui-calendar-x{animation:only-dead 1s,shared 1s}',
      '.zaui-sheet{animation:shared 1s}',
    ].join('');
    const out = pruneZauiCss(css).css;
    expect(out).not.toContain('@keyframes only-dead');
    expect(out).toContain('@keyframes shared');
    expect(out).toContain('@keyframes orphan');
  });

  it('lớp do hạ tầng dùng chung sinh ra (zaui-modal-wrapper của Sheet) được miễn dù mang token modal', () => {
    const css = '.zaui-modal-wrapper{display:flex}.zaui-modal-content{color:red}';
    const { css: out, removedSelectors } = pruneZauiCss(css);
    expect(out).toContain('.zaui-modal-wrapper{display:flex}');
    expect(removedSelectors).toEqual(['.zaui-modal-content']);
  });

  it('luật chỉ cho chủ đề tối của zaui bị bỏ; danh sách trộn còn một vế chủ đề sáng thì giữ', () => {
    const css = 'body[zaui-theme=dark] .zaui-btn{color:#fff}body[zaui-theme="dark"] .zaui-input,body[zaui-theme=dark] .zaui-sheet{color:#000}body[zaui-theme=dark] .zaui-btn,.zaui-btn{color:red}.zaui-btn{color:blue}';
    const { css: out, removedSelectors } = pruneZauiCss(css);
    expect(removedSelectors).toEqual(['body[zaui-theme=dark] .zaui-btn', 'body[zaui-theme="dark"] .zaui-input,body[zaui-theme=dark] .zaui-sheet']);
    expect(out).toContain('body[zaui-theme=dark] .zaui-btn,.zaui-btn{color:red}');
    expect(out).toContain('.zaui-btn{color:blue}');
    expect(isDarkThemeOnly('body[zaui-theme=light] .zaui-btn')).toBe(false);
  });

  it('biến --zaui-* không còn ai đọc bị bỏ, kể cả chuỗi biến chỉ trỏ tới nhau; biến JS zmp-ui đọc và biến còn dùng giữ nguyên', () => {
    const root = postcss.parse(
      ':root{--zaui-a:red;--zaui-b:var(--zaui-a);--zaui-c:blue;--zaui-d:var(--zaui-c);--zaui-tabbar-width:1px;--color-x:1px}.zaui-btn{color:var(--zaui-c)}.zaui-calendar-x{color:var(--zaui-b)}',
    );
    root.walkRules((r) => {
      if (r.selector === '.zaui-calendar-x') r.remove();
    });
    const removed = pruneUnusedZauiVars(root);
    expect(removed.sort()).toEqual(['--zaui-a', '--zaui-b', '--zaui-d']);
    const out = root.toString();
    expect(out).toContain('--zaui-c:blue');
    expect(out).toContain('--zaui-tabbar-width:1px');
    expect(out).toContain('--color-x:1px');
  });

  it('lớp bổ nghĩa bị cắt: bỏ luật mà mọi vế đều cần nó (khớp cả tên lớp, không khớp lớp dài hơn), giữ lớp gốc và biến thể còn dùng', () => {
    const css = '.zaui-btn{color:blue}.zaui-btn-small{height:32px}.zaui-btn-icon-only.zaui-btn-small{width:32px}.zaui-btn-small-x{color:red}.zaui-btn-small,.zaui-btn-tertiary{color:green}';
    const { css: out, removedSelectors } = pruneZauiCss(css, [], ['zaui-btn-small']);
    expect(removedSelectors).toEqual(['.zaui-btn-small', '.zaui-btn-icon-only.zaui-btn-small']);
    expect(out).toContain('.zaui-btn{color:blue}');
    expect(out).toContain('.zaui-btn-small-x{color:red}');
    expect(out).toContain('.zaui-btn-small,.zaui-btn-tertiary{color:green}');
  });

  it('token lớp của thư mục nhiều từ lấy từ đầu: image-viewer → image, date-picker → date', () => {
    expect(zauiClassToken('image-viewer')).toBe('image');
    expect(zauiClassToken('date-picker')).toBe('date');
    expect(zauiClassToken('calendar')).toBe('calendar');
  });
});

describe('zaui.css thật — cắt không đụng thành phần app đang dùng', () => {
  const raw = fs.readFileSync(path.join(ZMP_UI, 'zaui.css'), 'utf8');
  const { css: pruned, removedSelectors } = pruneZauiCss(raw);
  const used = appZmpUiImports();
  const closure = zmpUiClosure(used.names);

  it('mọi import zmp-ui trong mã app là dạng có tên, nên bao đóng tính được', () => {
    expect(used.unsupported).toEqual([]);
    expect(used.names.size).toBeGreaterThan(5);
  });

  it('thật sự cắt được một phần đáng kể (>10 KB) và vẫn giữ biến :root cùng lớp của thành phần đang dùng', () => {
    expect(raw.length - pruned.length).toBeGreaterThan(10_000);
    expect(removedSelectors.length).toBeGreaterThan(50);
    for (const keep of [':root', '.zaui-sheet', '.zaui-btn', '.zaui-page', '.zaui-mask', '.zaui-text']) {
      expect(pruned, keep).toContain(keep);
    }
    // Ô nhập, ô chọn, công tắc, vòng chờ và Snackbar (kèm Icon, Progress) đã thay bằng thành phần DS / shim của bản build (w19-02).
    for (const gone of ['.zaui-avatar', '.zaui-box', '.zaui-input', '.zaui-checkbox', '.zaui-radio', '.zaui-switch', '.zaui-spinner', '.zaui-snackbar', '.zaui-icon', '.zaui-progress']) {
      expect(pruned, gone).not.toContain(gone);
    }
  });

  it('thành phần app dùng (kể cả gián tiếp qua import của zmp-ui) không nằm trong danh sách bị cắt', () => {
    const cut = new Set<string>(PRUNED_ZMP_UI_COMPONENTS);
    const hit = [...closure.components].filter((c) => cut.has(c));
    expect(hit, `Đang dùng thành phần zmp-ui đã bị cắt CSS: ${hit.join(', ')}. Bỏ nó khỏi PRUNED_ZMP_UI_COMPONENTS trong build-zaui-prune.ts`).toEqual([]);
    expect(closure.components.size).toBeGreaterThan(5);
  });

  it('không lớp của thành phần bị cắt nào bị bỏ lại là lớp mà mã đang dùng sinh ra qua getPrefixCls(...)', () => {
    const generated = new Set<string>();
    for (const f of closure.files) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/getPrefixCls\(\s*"([a-z0-9-]+)"/g)) generated.add(m[1] ?? '');
    }
    expect(generated.size).toBeGreaterThan(5);
    const deadTokens = new Set((PRUNED_ZMP_UI_COMPONENTS as readonly string[]).map(zauiClassToken));
    const collisions: string[] = [];
    for (const sel of removedSelectors) {
      for (const part of sel.split(',')) {
        for (const cls of deadZauiClasses(part.trim(), deadTokens)) {
          for (const g of generated) {
            if (cls === `zaui-${g}` || cls.startsWith(`zaui-${g}-`)) collisions.push(`${cls} ← getPrefixCls("${g}")`);
          }
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it('Mini không bao giờ bật chủ đề tối của zaui (không useTheme, <App> không nhận prop theme), nên cắt luật tối là an toàn', () => {
    expect(used.names.has('useTheme')).toBe(false);
    const offenders: string[] = [];
    for (const file of walk(here).filter((f) => /\.tsx?$/.test(f) && !/\.spec\.tsx?$/.test(f) && path.basename(f) !== 'build-zaui-prune.ts')) {
      const src = fs.readFileSync(file, 'utf8');
      if (/<App\b[^>]*\btheme\s*=/.test(src) || /zaui-theme/.test(src)) offenders.push(path.relative(here, file));
    }
    expect(offenders).toEqual([]);
    const darkLeft = [...pruned.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => (m[1] ?? '').trim()).filter((sel) => sel && isDarkThemeOnly(sel));
    expect(darkLeft).toEqual([]);
  });

  it('JS của zmp-ui chỉ nhắc tên biến --zaui-* có trong ZAUI_JS_VARS; mã app không đọc var(--zaui-*) nào', () => {
    const inJs = new Set<string>();
    for (const f of walk(ESM).filter((x) => x.endsWith('.js'))) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/--zaui-[a-z0-9-]+/g)) inJs.add(m[0]);
    }
    expect([...inJs].sort()).toEqual([...ZAUI_JS_VARS].sort());
    const readers: string[] = [];
    for (const file of walk(here).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.spec\.tsx?$/.test(f) && path.basename(f) !== 'build-zaui-prune.ts')) {
      const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/var\(\s*--zaui-/.test(code)) readers.push(path.relative(here, file));
    }
    expect(readers).toEqual([]);
    expect(pruned).toContain('--zaui-light-color-primary');
  });

  it('lớp bổ nghĩa Button bị cắt không đường dựng nào sinh ra: nút app không truyền type/size/suffixIcon, không dùng Sheet.Actions', () => {
    const buttonUsers: string[] = [];
    const offenders: string[] = [];
    const spreads: string[] = [];
    for (const file of walk(here).filter((f) => /\.tsx?$/.test(f) && !/\.spec\.tsx?$/.test(f))) {
      const rel = path.relative(here, file);
      const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const aliases = new Set<string>();
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'zmp-ui') {
          const named = node.importClause?.namedBindings;
          if (named && ts.isNamedImports(named)) for (const el of named.elements) if ((el.propertyName ?? el.name).text === 'Button') aliases.add(el.name.text);
        }
        if (ts.isPropertyAccessExpression(node) && node.getText(sf) === 'Sheet.Actions') offenders.push(`${rel}: Sheet.Actions`);
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(sf);
          const watched = aliases.has(tag) ? ['type', 'size', 'suffixIcon'] : [];
          if (watched.length) {
            for (const attr of node.attributes.properties) {
              if (ts.isJsxSpreadAttribute(attr)) spreads.push(`${rel}: <${tag} {...${attr.expression.getText(sf)}}>`);
              else if (watched.includes(attr.name.getText(sf))) offenders.push(`${rel}: <${tag} ${attr.name.getText(sf)}>`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
      if (aliases.size) buttonUsers.push(rel);
    }
    expect(buttonUsers.sort()).toEqual([path.join('components', 'ui', 'button.tsx'), path.join('components', 'ui', 'empty-state.tsx')]);
    expect(offenders).toEqual([]);
    // `aria` là phần còn lại sau khi tách mọi prop đã biết của ButtonProps, kiểu AriaAttributes, nên không mang type/size/suffixIcon.
    expect(spreads).toEqual([`${path.join('components', 'ui', 'button.tsx')}: <ZButton {...aria}>`]);

    // `sheet/action-sheet.js` cũng dựng Button nhưng bản build bỏ hẳn (`Sheet.Actions`, build-vendor-shims.ts) nên không còn trong bao đóng;
    // `input/Search.js` (nút kính lúp) cũng ra khỏi bao đóng từ khi app thôi dùng `Input` của zmp-ui. Không tệp zmp-ui nào còn lại tự dựng Button.
    const renderers = [...closure.files].filter((f) => /from "\.\.\/button"/.test(builtSource(f))).map((f) => path.relative(path.join(ESM, 'components'), f));
    expect(renderers).toEqual([]);

    // Luật trộn (`.zaui-btn-primary, .zaui-btn-primary.zaui-btn-highlight`) còn vế sống nên giữ nguyên; chỉ luật mà mọi vế đều cần lớp bị cắt mới phải biến mất.
    const needsDead = (part: string) => PRUNED_ZAUI_CLASSES.some((cls) => new RegExp(`\\.${cls}(?![a-z0-9-])`).test(part));
    const leftovers: string[] = [];
    postcss.parse(pruned).walkRules((rule) => {
      if (rule.selectors.every(needsDead)) leftovers.push(rule.selector);
    });
    expect(leftovers).toEqual([]);
    for (const cls of ['zaui-btn-danger', 'zaui-btn-small', 'zaui-btn-large', 'zaui-btn-suffix-icon']) expect(removedSelectors.some((sel) => sel.includes(cls)), cls).toBe(true);
    for (const keep of ['.zaui-btn-primary', '.zaui-btn-secondary', '.zaui-btn-tertiary', '.zaui-btn-neutral', '.zaui-btn-icon-only', '.zaui-btn-loading', '.zaui-btn-prefix-icon', '.zaui-btn-full-width', '.zaui-btn-disabled']) {
      expect(pruned, keep).toContain(keep);
    }
  });

  it('họ lớp bị cắt (OTP, Password, ActionSheet, sheet-content-action(s)/main) không còn tệp nào trong bao đóng sinh ra, và vẫn có thật trong zaui.css', () => {
    const inFamily = (cls: string) => PRUNED_ZAUI_CLASS_FAMILIES.some((f) => cls === f || cls.startsWith(`${f}-`));
    const offenders: string[] = [];
    for (const f of closure.files) {
      const src = builtSource(f);
      const prefixes = [...src.matchAll(/getPrefixCls\("([a-z0-9-]+)"\)/g)].map((m) => `zaui-${m[1]}`);
      const suffixes = [...src.matchAll(/\+ "(-[a-z0-9-]+)"|\$\{[A-Za-z]+\}(-[a-z0-9-]+)/g)].map((m) => m[1] ?? m[2] ?? '');
      for (const p of prefixes) for (const cls of [p, ...suffixes.map((s) => `${p}${s}`)]) if (inFamily(cls)) offenders.push(`${path.relative(ESM, f)}: ${cls}`);
    }
    expect(offenders).toEqual([]);
    // Danh sách không cũ: mỗi họ đều có luật trong zaui.css gốc, và không còn luật nào cần một lớp của họ đó sau khi cắt.
    for (const fam of PRUNED_ZAUI_CLASS_FAMILIES) expect(raw, fam).toMatch(new RegExp(`\\.${fam}(?![a-z0-9])`));
    const leftovers: string[] = [];
    postcss.parse(pruned).walkRules((rule) => {
      if (rule.selectors.every((part) => [...part.matchAll(/\.(zaui-[a-z0-9-]+)/g)].some((m) => inFamily(m[1] ?? '')))) leftovers.push(rule.selector);
    });
    expect(leftovers).toEqual([]);
  });

  it('mã app không tự viết lớp zaui-* của thành phần bị cắt', () => {
    const dead = new Set((PRUNED_ZMP_UI_COMPONENTS as readonly string[]).map(zauiClassToken));
    const offenders: string[] = [];
    for (const file of walk(here).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.spec\.tsx?$/.test(f) && path.basename(f) !== 'build-zaui-prune.ts')) {
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/zaui-([a-z0-9]+)/g)) {
        if (dead.has(m[1] ?? '')) offenders.push(`${path.relative(here, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
