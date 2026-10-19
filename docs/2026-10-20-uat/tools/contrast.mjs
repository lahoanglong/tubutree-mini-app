// Tính tương phản WCAG cho cặp chữ/nền. Chỉ đọc mã; ghi docs/2026-10-20-uat/static/contrast.json và contrast.md.
//   node docs/2026-10-20-uat/tools/contrast.mjs
// Phần A: ma trận token ngữ nghĩa (packages/design-tokens + css của miniapp).
// Phần B: cặp color/background thật trong style={{}} của miniapp + admin (cùng phần tử hoặc nền tổ tiên gần nhất).
// Phần C: cặp class Tailwind text-*/bg-* cùng một chuỗi trong admin web.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const req = createRequire(path.join(ROOT, 'apps/miniapp/package.json'));
const ts = req('typescript');
const OUT = path.join(ROOT, 'docs/2026-10-20-uat/static');
const rel = (p) => path.relative(ROOT, p);

// ───────────── màu ─────────────
function parseColor(s) {
  s = s.trim().toLowerCase();
  let m;
  if ((m = s.match(/^#([0-9a-f]{3,8})$/))) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  if ((m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/))) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
const lin = (v) => {
  v /= 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();

// ───────────── biến CSS ─────────────
const CSS_FILES = [
  'packages/design-tokens/src/tokens.css',
  'apps/miniapp/src/css/tokens.css',
  'apps/miniapp/src/css/brand-theme.css',
  'apps/miniapp/src/css/dealer-theme.css',
];
const VARS = new Map();
for (const f of CSS_FILES) {
  const txt = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // chỉ khối :root (bỏ [data-theme='dealer'])
  for (const blk of txt.matchAll(/(^|\})\s*(:root)\s*\{([^}]*)\}/g)) {
    for (const d of blk[3].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) VARS.set(d[1], d[2].trim());
  }
}
function resolveVar(expr, depth = 0) {
  if (depth > 12) return null;
  expr = expr.trim();
  const c = parseColor(expr);
  if (c) return c;
  const m = expr.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (m) {
    const v = VARS.get(m[1]);
    if (v !== undefined) return resolveVar(v, depth + 1);
    if (m[2]) return resolveVar(m[2], depth + 1);
    return null;
  }
  return null;
}
const tok = (name) => resolveVar(`var(${name})`);

// ───────────── Phần A: ma trận token ─────────────
const TEXT_TOKENS = [
  '--color-text-primary', '--color-text-secondary', '--color-text-tertiary', '--color-text-disabled', '--color-text-brand',
  '--color-text-link', '--color-text-price-compare', '--color-text-success', '--color-text-warning', '--color-text-danger',
  '--color-status-success-fg', '--color-status-warning-fg', '--color-status-danger-fg', '--color-status-info-fg', '--color-status-neutral-fg',
  '--color-promo-fg', '--color-flash-fg', '--color-rating', '--color-action-secondary-fg', '--color-action-ghost-fg', '--color-dealer-accent',
  '--color-action-primary-fg-disabled',
];
const BG_TOKENS = [
  '--color-bg-canvas', '--color-bg-surface', '--color-bg-subtle', '--stone-100', '--stone-200', '--forest-50', '--forest-100', '--sage-100',
  '--color-status-success-bg', '--color-status-warning-bg', '--color-status-danger-bg', '--color-status-info-bg', '--color-status-neutral-bg',
  '--color-promo-bg', '--color-action-primary-bg-disabled',
];
const INVERSE_PAIRS = [
  ['--color-action-primary-fg', '--color-action-primary-bg'],
  ['--color-action-primary-fg', '--color-action-primary-bg-pressed'],
  ['--color-action-danger-fg', '--color-action-danger-bg'],
  ['--color-promo-solid-fg', '--color-promo-solid-bg'],
  ['--color-flash-solid-fg', '--color-flash-solid-bg'],
  ['--color-text-inverse', '--color-bg-inverse'],
  ['--color-text-inverse', '--color-bg-scrim'],
  ['--color-action-secondary-fg', '--color-action-secondary-bg'],
  ['--color-action-secondary-fg', '--color-action-secondary-bg-pressed'],
  ['--color-text-inverse', '--color-dealer-ink'],
  ['--color-dealer-accent', '--color-dealer-ink'],
  ['--color-dealer-accent', '--color-dealer-ink-soft'],
  ['--forest-200', '--color-action-primary-bg'],
  ['--forest-100', '--color-action-primary-bg'],
  ['--color-action-primary-fg-disabled', '--color-action-primary-bg-disabled'],
];
const matrix = [];
const canvas = tok('--color-bg-canvas');
for (const t of TEXT_TOKENS) {
  const tc = tok(t);
  if (!tc) continue;
  for (const b of BG_TOKENS) {
    const bc = tok(b);
    if (!bc) continue;
    matrix.push({ fg: t, bg: b, fgHex: hex(tc), bgHex: hex(bc), ratio: +ratio(over(tc, bc), bc).toFixed(2) });
  }
}
const inverse = INVERSE_PAIRS.map(([f, b]) => {
  const fc = tok(f);
  let bc = tok(b);
  if (!fc || !bc) return { fg: f, bg: b, ratio: null };
  const bcc = over(bc, canvas); // scrim bán trong suốt: ước trên canvas
  const fcc = over(fc, bcc);
  return { fg: f, bg: b, fgHex: hex(fcc), bgHex: hex(bcc), ratio: +ratio(fcc, bcc).toFixed(2) };
});
// ranh giới control (WCAG 1.4.11, 3:1) trên nền trắng/canvas
const BORDERS = ['--color-border-subtle', '--color-border-default', '--color-border-strong', '--color-border-focus', '--stone-300', '--stone-400', '--stone-450'];
const borders = BORDERS.map((b) => {
  const c = tok(b);
  return { token: b, hex: hex(c), onSurface: +ratio(c, tok('--color-bg-surface')).toFixed(2), onCanvas: +ratio(c, canvas).toFixed(2) };
});

// ───────────── Phần B: style={{}} trong tsx ─────────────
const TYPE_PX = { 'body-lg': 16, 'body-md': 15, 'body-sm': 14, caption: 13, label: 12, 'price-xl': 24, 'price-lg': 20, 'price-md': 16, 'price-sm': 14, 'display-lg': 32, 'display-md': 28, 'title-lg': 22, 'title-md': 18, 'title-sm': 16 };
const TYPE_W = { 'price-xl': 700, 'price-lg': 700, 'price-md': 600, 'price-sm': 600, label: 600, 'display-lg': 600, 'display-md': 600, 'title-lg': 600, 'title-md': 600, 'title-sm': 600 };
const TONE = { primary: '--color-text-primary', secondary: '--color-text-secondary', tertiary: '--color-text-tertiary', disabled: '--color-text-disabled', inverse: '--color-text-inverse', brand: '--color-text-brand', success: '--color-text-success', warning: '--color-text-warning', danger: '--color-text-danger' };
const BADGE = {
  success: ['--color-status-success-fg', '--color-status-success-bg'], warning: ['--color-status-warning-fg', '--color-status-warning-bg'], danger: ['--color-status-danger-fg', '--color-status-danger-bg'],
  info: ['--color-status-info-fg', '--color-status-info-bg'], neutral: ['--color-status-neutral-fg', '--color-status-neutral-bg'], brand: ['--color-action-secondary-fg', '--color-action-secondary-bg'], promo: ['--color-promo-fg', '--color-promo-bg'],
};

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const isSpec = (p) => /\.(spec|test)\.(ts|tsx)$/.test(p) || /\/test-utils\//.test(p);

const pairs = [];
const unresolved = new Map();
const nameOf = (tag) => (ts.isIdentifier(tag) ? tag.text : ts.isPropertyAccessExpression(tag) ? `${nameOf(tag.expression)}.${tag.name.text}` : tag.getText());

// Giá trị literal của một biểu thức → danh sách {v, tags}; tags ghi điều kiện ternary để ghép đúng nhánh chữ/nền.
const L = (v, tags = {}) => ({ v, tags });
function litValues(e) {
  if (!e) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [L(e.text)];
  if (ts.isNumericLiteral(e)) return [L(Number(e.text))];
  if (ts.isParenthesizedExpression(e)) return litValues(e.expression);
  if (ts.isConditionalExpression(e)) {
    const a = litValues(e.whenTrue);
    const b = litValues(e.whenFalse);
    if (!a || !b) return null;
    const c = e.condition.getText();
    return [...a.map((x) => L(x.v, { ...x.tags, [c]: true })), ...b.map((x) => L(x.v, { ...x.tags, [c]: false }))];
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.getText() === '??') {
    const a = litValues(e.left);
    const b = litValues(e.right);
    return a && b ? [...a, ...b] : b;
  }
  return null;
}
const compat = (a, b) => Object.keys(a).every((k) => !(k in b) || a[k] === b[k]);
function styleProps(attrInit) {
  const o = {};
  if (!attrInit || !ts.isJsxExpression(attrInit) || !attrInit.expression || !ts.isObjectLiteralExpression(attrInit.expression)) return o;
  for (const p of attrInit.expression.properties) {
    if (ts.isPropertyAssignment(p)) o[p.name.getText().replace(/['"]/g, '')] = litValues(p.initializer);
    else if (ts.isShorthandPropertyAssignment(p)) o[p.name.text] = null;
    else o.__spread = true;
  }
  return o;
}
function sizeOf(v) {
  if (v == null) return null;
  const x = v[0].v;
  if (typeof x === 'number') return x;
  const m = String(x).match(/^(\d+(?:\.\d+)?)px$/);
  if (m) return +m[1];
  const t = String(x).match(/^var\(--type-([\w-]+)-size\)$/);
  if (t && TYPE_PX[t[1]]) return TYPE_PX[t[1]];
  return null;
}
function weightOf(v) {
  if (v == null) return 400;
  const x = v[0].v;
  if (typeof x === 'number') return x;
  if (x === 'bold') return 700;
  if (/^\d+$/.test(String(x))) return +x;
  const t = String(x).match(/^var\(--type-([\w-]+)-weight\)$/);
  if (t && TYPE_W[t[1]]) return TYPE_W[t[1]];
  return 400;
}
// "background" có thể là shorthand "var(--x) url(...)" hoặc gradient
function bgColors(vals) {
  if (!vals) return null;
  const out = [];
  for (const tv of vals) {
    const s = String(tv.v);
    if (/gradient/.test(s)) {
      const stops = [...s.matchAll(/var\(--[\w-]+\)|#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => resolveVar(m[0])).filter(Boolean);
      if (!stops.length) return null;
      out.push(...stops.map((c) => ({ c, grad: true, tags: tv.tags })));
    } else {
      const m = s.match(/^(var\(--[\w-]+(?:\s*,[^)]*)?\)|#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|transparent|white)$/);
      if (!m) return null;
      const c = resolveVar(m[1]) ?? parseColor(m[1]);
      if (!c) return null;
      out.push({ c, tags: tv.tags });
    }
  }
  return out;
}

const UNKNOWN = Symbol('unknown-bg');
const lightUnknown = [];
function scanTsx(file, zone) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node, bgStack) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = nameOf(open.tagName);
      const attrs = new Map();
      let hasSpread = false;
      for (const a of open.attributes.properties) {
        if (ts.isJsxAttribute(a)) attrs.set(a.name.getText(), a.initializer ?? null);
        else hasSpread = true;
      }
      const st = styleProps(attrs.get('style'));
      const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      const styleAttr = attrs.get('style');
      const styleDynamic = (styleAttr && !(ts.isJsxExpression(styleAttr) && styleAttr.expression && ts.isObjectLiteralExpression(styleAttr.expression))) || st.__spread;
      // nền của phần tử này
      let ownBg = null;
      for (const k of ['background', 'backgroundColor']) {
        if (st[k] !== undefined) ownBg = st[k] === null ? UNKNOWN : (bgColors(st[k]) ?? UNKNOWN);
      }
      if (ownBg === null && styleDynamic) ownBg = UNKNOWN;
      if (ownBg === null && (hasSpread || attrs.has('bg'))) ownBg = UNKNOWN;
      if (tag === 'Badge' || tag === 'StatusPill') {
        const t = attrs.get('tone');
        const tv = t && ts.isStringLiteral(t) ? t.text : 'neutral';
        if (BADGE[tv]) ownBg = [{ c: tok(BADGE[tv][1]), tags: {} }];
      }
      if (ownBg === null && ['Card', 'BottomSheet'].includes(tag)) ownBg = [{ c: tok('--color-bg-surface'), tags: {} }];
      // màu chữ của phần tử
      let fgs = null;
      let fgSrc = '';
      if (st.color !== undefined) {
        fgs = st.color;
        fgSrc = 'style.color';
      } else if ((tag === 'Text' || tag === 'Heading') && attrs.has('tone')) {
        const t = attrs.get('tone');
        if (t && ts.isStringLiteral(t) && TONE[t.text]) {
          fgs = [L(`var(${TONE[t.text]})`)];
          fgSrc = `tone=${t.text}`;
        }
      } else if (tag === 'Badge' || tag === 'StatusPill') {
        const t = attrs.get('tone');
        const tv = t && ts.isStringLiteral(t) ? t.text : 'neutral';
        if (BADGE[tv]) {
          fgs = [L(`var(${BADGE[tv][0]})`)];
          fgSrc = `Badge tone=${tv}`;
        }
      }
      const inherited = bgStack.length ? bgStack[bgStack.length - 1] : null;
      const bgNow = ownBg ?? inherited;
      if (fgs && Array.isArray(fgs)) {
        let size = sizeOf(st.fontSize);
        let weight = st.fontWeight ? weightOf(st.fontWeight) : null;
        const variant = attrs.get('variant');
        if (variant && ts.isStringLiteral(variant) && TYPE_PX[variant.text]) {
          size = size ?? TYPE_PX[variant.text];
          weight = weight ?? TYPE_W[variant.text] ?? 400;
        }
        if (tag === 'Badge') {
          const sz = attrs.get('size');
          size = size ?? (sz && ts.isStringLiteral(sz) && sz.text === 'sm' ? 11 : 12);
          weight = weight ?? 600;
        }
        size = size ?? 14;
        weight = weight ?? 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        const opacity = st.opacity && typeof st.opacity[0].v === 'number' ? st.opacity[0].v : 1;
        for (const fv of fgs) {
          const fc = typeof fv.v === 'string' ? resolveVar(fv.v) : null;
          if (!fc) {
            unresolved.set(String(fv.v), (unresolved.get(String(fv.v)) ?? 0) + 1);
            continue;
          }
          if (bgNow === UNKNOWN) {
            if (lum(fc) >= 0.4) lightUnknown.push({ zone, file: rel(file), line: lineOf(node), fg: String(fv.v), opacity });
            continue;
          }
          let bgList = bgNow;
          let guessed = false;
          if (!bgList) {
            if (lum(fc) >= 0.4) {
              lightUnknown.push({ zone, file: rel(file), line: lineOf(node), fg: String(fv.v), opacity, noAncestorBg: true });
              continue;
            }
            bgList = [{ c: tok('--color-bg-canvas'), tags: {}, guess: 'canvas' }, { c: tok('--color-bg-surface'), tags: {}, guess: 'surface' }];
            guessed = true;
          }
          for (const bgv of bgList) {
            if (!compat(fv.tags, bgv.tags ?? {})) continue;
            const bgc = over(bgv.c, tok('--color-bg-canvas'));
            const eff = opacity < 1 ? over({ ...fc, a: opacity * fc.a }, bgc) : over(fc, bgc);
            const r = ratio(eff, bgc);
            if (r < need) {
              pairs.push({
                zone, file: rel(file), line: lineOf(node), tag, fgSrc, fg: String(fv.v), fgHex: hex(eff), bgHex: hex(bgc),
                bgKnown: !guessed, bgGuess: bgv.guess ?? null, inherited: !ownBg && !!inherited, size, weight, large, opacity, ratio: +r.toFixed(2), need,
              });
            }
          }
        }
      }
      const nextStack = ownBg ? [...bgStack, ownBg] : bgStack;
      ts.forEachChild(node, (c) => visit(c, nextStack));
      return;
    }
    ts.forEachChild(node, (c) => visit(c, bgStack));
  };
  visit(sf, []);
}

const SCOPES = [
  { zone: 'miniapp', dir: 'apps/miniapp/src' },
  { zone: 'web-admin', dir: 'apps/web/src/app/admin' },
  { zone: 'web-admin', dir: 'apps/web/src/components/admin' },
];
for (const sc of SCOPES) for (const f of walk(path.join(ROOT, sc.dir))) if (/\.tsx$/.test(f) && !isSpec(f)) scanTsx(f, sc.zone);

// ───────────── Phần C: Tailwind (admin web) ─────────────
const stock = createRequire(path.join(ROOT, 'apps/web/package.json'))('tailwindcss/colors');
const TW = {
  forest: { 50: '#EEF4EF', 100: '#D6E6DA', 200: '#B1CFB9', 300: '#86B293', 400: '#5B9170', 500: '#3B7552', 600: '#245E3E', 700: '#1B4B31', 800: '#143A26', 900: '#0D291B' },
  sage: { 50: '#F2F5EC', 100: '#E3EBD8', 600: '#4A6135', 700: '#3E5129' },
  stone: { 0: '#FFFFFF', 25: '#FBFAF7', 50: '#F6F4EF', 100: '#EFEBE2', 200: '#E0DACB', 300: '#CBC5B8', 400: '#9E978A', 450: '#938B7E', 500: '#6E675B', 600: '#5A544A', 700: '#423D34', 800: '#2B2721', 900: '#1C1A16' },
  clay: { 50: '#FBF4ED', 100: '#F2DFD0', 200: '#EDD4BD', 500: '#C97B4A', 600: '#9C532C', 700: '#8C4F2A' },
  honey: { 500: '#B07A00', 600: '#96650A' },
  terracotta: { 50: '#FFF1E8', 600: '#C2410C' },
  orange: { 50: '#FDF1DE', 500: '#E38E1E', 800: '#7A4300' },
  'tubu-orange': '#E38E1E',
  primary: { 50: '#FDF3E3', 100: '#FBE4C4', 200: '#F4C98A', 400: '#EBA94A', 600: '#A35A0B', 700: '#8F4F08', 900: '#5C3505' },
  leaf: { 50: '#EEF7D9', 100: '#DCEFBE', 200: '#BBD98A', 400: '#95D222', 600: '#509018', 700: '#3C6D12', 900: '#1F3A09' },
  sun: { 300: '#FDD96E', 500: '#F4B400' },
  green: { 600: '#15803D', 700: '#166534' },
  neutral: { ...stock.neutral, 0: '#FFFFFF', 50: '#FAFAF8', 100: '#F2F2EF', 200: '#E5E5E0', 400: '#6B6B64', 600: '#5F5F58', 900: '#1A1A17' },
  promo: { fg: '#7A4300', bg: '#FDF1DE', solid: '#E38E1E' },
  danger: { fg: 'var(--color-status-danger-fg)', bg: 'var(--color-status-danger-bg)' },
  warning: { fg: 'var(--color-status-warning-fg)', bg: 'var(--color-status-warning-bg)' },
  success: { fg: 'var(--color-status-success-fg)', bg: 'var(--color-status-success-bg)' },
  info: { fg: 'var(--color-status-info-fg)', bg: 'var(--color-status-info-bg)' },
  white: '#FFFFFF',
  black: '#000000',
};
for (const f of ['red', 'amber', 'blue', 'yellow', 'orange', 'rose', 'emerald', 'sky', 'indigo', 'violet', 'purple', 'gray', 'slate', 'zinc']) if (!TW[f]) TW[f] = stock[f];
function twColor(name) {
  // name: "stone-500" | "danger-fg" | "white" | "stone-900/40"
  let a = 1;
  const m = name.match(/^(.*?)(?:\/(\d+))?$/);
  name = m[1];
  if (m[2]) a = +m[2] / 100;
  let v;
  if (TW[name] && typeof TW[name] === 'string') v = TW[name];
  else {
    const i = name.lastIndexOf('-');
    if (i < 0) return null;
    const fam = TW[name.slice(0, i)];
    v = fam?.[name.slice(i + 1)];
  }
  if (!v) return null;
  const c = resolveVar(v) ?? parseColor(v);
  return c ? { ...c, a: c.a * a } : null;
}
const TW_PX = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 };
const twPairs = [];
const twLoose = [];
function scanTw(file, zone) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    let s = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) s = node.text;
    else if (ts.isTemplateExpression(node)) s = node.head.text + node.templateSpans.map((x) => ' ' + x.literal.text).join('');
    if (s && /(^|\s)(?:[a-z-]+:)*(text|bg)-/.test(s)) {
      const toks = s.split(/\s+/).filter(Boolean);
      const bgBase = [];
      const byPrefix = new Map(); // prefix → {text, bg}
      let size = 14;
      let bold = false;
      for (const t of toks) {
        const parts = t.split(':');
        const cls = parts.pop();
        const pfx = parts.join(':');
        let mm;
        if ((mm = cls.match(/^text-(xs|sm|base|lg|xl|2xl|3xl)$/)) && !pfx) size = TW_PX[mm[1]];
        if (/^font-(bold|semibold|extrabold)$/.test(cls) && !pfx) bold = cls !== 'font-semibold' ? true : false;
        const e = byPrefix.get(pfx) ?? {};
        if ((mm = cls.match(/^text-(?!xs$|sm$|base$|lg$|xl$|2xl$|3xl$|left$|right$|center$|justify$|ellipsis$|clip$|wrap$|nowrap$|balance$|pretty$)(.+)$/))) e.text = mm[1];
        if ((mm = cls.match(/^bg-(?!none$|gradient|clip|no-repeat|cover|center|contain|fixed|local|scroll|repeat)(.+)$/))) e.bg = mm[1];
        if ((mm = cls.match(/^placeholder:text-(.+)$/))) e.ph = mm[1];
        byPrefix.set(pfx, e);
      }
      const base = byPrefix.get('') ?? {};
      for (const [pfx, e] of byPrefix) {
        if (!e.text || /^(sm|md|lg|xl|2xl)$/.test(pfx) && false) continue;
        const bgName = e.bg ?? (pfx === '' ? base.bg : base.bg);
        const fg = twColor(e.text);
        if (!fg) continue;
        const known = !!bgName;
        const bgs = bgName ? [twColor(bgName)] : [twColor('stone-0'), twColor('stone-50')];
        for (const bgc0 of bgs) {
          if (!bgc0) continue;
          const bgc = over(bgc0, tok('--color-bg-canvas'));
          const eff = over(fg, bgc);
          const r = ratio(eff, bgc);
          const large = size >= 24 || (size >= 18.66 && bold);
          const need = large ? 3 : 4.5;
          if (r < need) {
            const rec = { zone, file: rel(file), line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, prefix: pfx || '(base)', text: e.text, bg: bgName ?? '(không rõ: trắng/canvas)', ratio: +r.toFixed(2), need, size, snippet: s.length > 140 ? s.slice(0, 140) + '…' : s };
            (known ? twPairs : twLoose).push(rec);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
for (const d of ['apps/web/src/app/admin', 'apps/web/src/components/admin']) for (const f of walk(path.join(ROOT, d))) if (/\.tsx?$/.test(f) && !isSpec(f)) scanTw(f, 'web-admin');

// ───────────── ghi kết quả ─────────────
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'contrast.json'), JSON.stringify({ at: new Date().toISOString(), tokenMatrix: matrix, inverse, borders, stylePairs: pairs, lightUnknown, unresolved: [...unresolved], twPairs, twLoose }, null, 1));
const md = [];
md.push('# Tương phản WCAG — kết quả máy tính (tools/contrast.mjs)');
md.push('');
md.push('## A. Token ngữ nghĩa dưới 4,5:1 (chữ thường)');
md.push('| Chữ | Nền | Hex chữ | Hex nền | Tỉ lệ |');
md.push('|---|---|---|---|---|');
for (const r of matrix.filter((x) => x.ratio < 4.5).sort((a, b) => a.ratio - b.ratio)) md.push(`| ${r.fg} | ${r.bg} | ${r.fgHex} | ${r.bgHex} | ${r.ratio} |`);
md.push('');
md.push('## A2. Cặp chữ/nền đặc (nút, huy hiệu, nền tối)');
md.push('| Chữ | Nền | Hex chữ | Hex nền | Tỉ lệ |');
md.push('|---|---|---|---|---|');
for (const r of inverse) md.push(`| ${r.fg} | ${r.bg} | ${r.fgHex ?? ''} | ${r.bgHex ?? ''} | ${r.ratio} |`);
md.push('');
md.push('## A3. Đường viền control (cần 3:1 theo 1.4.11)');
md.push('| Token | Hex | Trên trắng | Trên canvas |');
md.push('|---|---|---|---|');
for (const r of borders) md.push(`| ${r.token} | ${r.hex} | ${r.onSurface} | ${r.onCanvas} |`);
md.push('');
md.push(`## B. style={{}} dưới ngưỡng (${pairs.length})`);
md.push('| File:dòng | Thẻ | Màu chữ | Nền | Cỡ/đậm | Tỉ lệ (cần) |');
md.push('|---|---|---|---|---|---|');
for (const r of pairs.sort((a, b) => a.ratio - b.ratio)) md.push(`| ${r.file}:${r.line} | ${r.tag} | ${r.fg} ${r.fgHex}${r.opacity < 1 ? ` (opacity ${r.opacity})` : ''} | ${r.bgKnown ? r.bgHex : `${r.bgHex} (đoán ${r.bgGuess ?? 'tổ tiên'})`} | ${r.size}px/${r.weight} | ${r.ratio} (${r.need}) |`);
md.push('');
md.push(`## C. Tailwind admin dưới ngưỡng (nền rõ: ${twPairs.length}; nền không rõ: ${twLoose.length})`);
md.push('| File:dòng | Tiền tố | Chữ | Nền | Tỉ lệ (cần) | Chuỗi |');
md.push('|---|---|---|---|---|---|');
for (const r of [...twPairs, ...twLoose].sort((a, b) => a.ratio - b.ratio)) md.push(`| ${r.file}:${r.line} | ${r.prefix} | ${r.text} | ${r.bg} | ${r.ratio} (${r.need}) | \`${r.snippet.replace(/\|/g, '\\|').replace(/\n/g, ' ')}\` |`);
md.push('');
md.push('## Giá trị màu không giải được (đếm)');
for (const [k, v] of [...unresolved].sort((a, b) => b[1] - a[1]).slice(0, 40)) md.push(`- ${k}: ${v}`);
fs.writeFileSync(path.join(OUT, 'contrast.md'), md.join('\n'));
console.log('token<4.5:', matrix.filter((x) => x.ratio < 4.5).length, 'inverse:', inverse.filter((x) => x.ratio < 4.5).map((x) => `${x.fg}/${x.bg}=${x.ratio}`));
console.log('style pairs fail:', pairs.length, 'tw known:', twPairs.length, 'tw loose:', twLoose.length, 'unresolved kinds:', unresolved.size);
