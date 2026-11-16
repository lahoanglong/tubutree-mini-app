import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRUNED_ZMP_UI_COMPONENTS, deadZauiClasses, pruneZauiCss, zauiClassToken } from './build-zaui-prune';

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
    if (files.has(f)) continue;
    files.add(f);
    const rel = path.relative(path.join(ESM, 'components'), f);
    if (!rel.startsWith('..')) components.add(rel.split(path.sep)[0] ?? rel);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^;]*?from\s*"(\.[^"]+)"|import\s*"(\.[^"]+)"/g)) {
      const next = resolve(f, m[1] ?? m[2] ?? '');
      if (next && !/\.stories\./.test(next) && !next.includes(`${path.sep}.storybook${path.sep}`)) queue.push(next);
    }
  }
  return { components, files };
}

describe('pruneZauiCss — chỉ bỏ luật của thành phần zmp-ui không có trong bản build', () => {
  it('bỏ luật nhắm vào thành phần bị cắt, giữ luật của thành phần đang dùng và luật chung', () => {
    const css = ':root{--zaui-x:1}.zaui-calendar-panel{color:red}.zaui-sheet{color:blue}.zaui-btn.zaui-btn-primary{color:green}';
    const { css: out, removedSelectors } = pruneZauiCss(css);
    expect(removedSelectors).toEqual(['.zaui-calendar-panel']);
    expect(out).toContain(':root{--zaui-x:1}');
    expect(out).toContain('.zaui-sheet{color:blue}');
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
    for (const keep of [':root', '.zaui-sheet', '.zaui-btn', '.zaui-input', '.zaui-page', '.zaui-mask', '.zaui-avatar', '.zaui-checkbox']) {
      expect(pruned, keep).toContain(keep);
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
