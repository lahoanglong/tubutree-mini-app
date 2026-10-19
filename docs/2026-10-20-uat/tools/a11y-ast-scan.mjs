// Quét a11y tĩnh bằng AST (TypeScript compiler API). Chỉ đọc mã, ghi docs/2026-10-20-uat/static/a11y-ast.json.
//   node docs/2026-10-20-uat/tools/a11y-ast-scan.mjs
// Kiểm: nút chỉ icon thiếu tên, ảnh thiếu alt, ô nhập thiếu nhãn, phần tử bấm được không phải control thật,
// vùng chạm khai báo < 44px.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const ts = createRequire(path.join(ROOT, 'apps/miniapp/package.json'))('typescript');

const SCOPES = [
  { zone: 'miniapp', dir: 'apps/miniapp/src' },
  { zone: 'web-admin-app', dir: 'apps/web/src/app/admin' },
  { zone: 'web-admin-components', dir: 'apps/web/src/components/admin' },
];

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const isSpec = (p) => /\.(spec|test)\.(ts|tsx)$/.test(p) || /\/test-utils\//.test(p);

const findings = [];
const add = (kind, zone, file, node, sf, extra = {}) => {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  findings.push({ kind, zone, file: path.relative(ROOT, file), line: line + 1, ...extra });
};

const nameOf = (tag) => (ts.isIdentifier(tag) ? tag.text : ts.isPropertyAccessExpression(tag) ? `${nameOf(tag.expression)}.${tag.name.text}` : tag.getText());
const attrsOf = (open) => {
  const m = new Map();
  let spread = false;
  for (const a of open.attributes.properties) {
    if (ts.isJsxSpreadAttribute(a)) spread = true;
    else m.set(a.name.getText(), a.initializer ?? null);
  }
  return { m, spread };
};
const strOf = (init) => {
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  }
  return undefined; // có giá trị nhưng động
};
const SYMBOL_ONLY = /^[\s✕✖×✗✘←→↑↓‹›«»❤♥♡☰⋮⋯…+\-−–—*•·✓✔★☆▲▼▾▸◂▶◀✎✏⚙☎✆\u{1F300}-\u{1FAFF}☀-➿]+$/u;

function childKinds(el, lucide) {
  const kinds = { text: 0, dynamic: 0, icon: 0, symbol: 0, other: 0 };
  const visit = (c) => {
    if (ts.isJsxText(c)) {
      const t = c.text.trim();
      if (!t) return;
      if (SYMBOL_ONLY.test(t)) kinds.symbol++;
      else if (/[\p{L}\p{N}]/u.test(t)) kinds.text++;
      else kinds.symbol++;
    } else if (ts.isJsxExpression(c)) {
      const e = c.expression;
      if (!e) return;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
        SYMBOL_ONLY.test(e.text.trim()) ? kinds.symbol++ : kinds.text++;
      } else if (ts.isTemplateExpression(e)) {
        kinds.text++;
      } else if (ts.isConditionalExpression(e) || (ts.isBinaryExpression(e) && /&&|\|\||\?\?/.test(e.operatorToken.getText()))) {
        const parts = ts.isConditionalExpression(e) ? [e.whenTrue, e.whenFalse] : [e.right];
        for (const p of parts) {
          if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxFragment(p)) visit(p);
          else if (ts.isStringLiteral(p)) SYMBOL_ONLY.test(p.text.trim()) ? kinds.symbol++ : kinds.text++;
          else kinds.dynamic++;
        }
      } else if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e)) {
        visit(e);
      } else kinds.dynamic++;
    } else if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) {
      const open = ts.isJsxElement(c) ? c.openingElement : c;
      const n = nameOf(open.tagName);
      if (/Icon$/.test(n) || n === 'svg' || n === 'img' || n === 'Image' || lucide.has(n) || n === 'Icon' || n === 'ProductThumb') kinds.icon++;
      else if (ts.isJsxElement(c)) {
        const sub = childKinds(c, lucide);
        for (const k of Object.keys(kinds)) kinds[k] += sub[k];
        if (n === 'span' || n === 'Text' || n === 'Box') {
          /* đã cộng từ sub */
        }
      } else {
        // phần tử tự đóng lạ (Spinner, Badge...): coi là other
        kinds.other++;
      }
    } else if (ts.isJsxFragment(c)) {
      const sub = childKinds(c, lucide);
      for (const k of Object.keys(kinds)) kinds[k] += sub[k];
    }
  };
  for (const c of el.children) visit(c);
  return kinds;
}

const styleNum = (init, key) => {
  if (!init || !ts.isJsxExpression(init) || !init.expression || !ts.isObjectLiteralExpression(init.expression)) return undefined;
  for (const p of init.expression.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === key) {
      const v = p.initializer;
      if (ts.isNumericLiteral(v)) return Number(v.text);
      if (ts.isStringLiteral(v) && /^\d+(\.\d+)?px$/.test(v.text)) return parseFloat(v.text);
      return null; // động / đơn vị khác
    }
  }
  return undefined;
};
const styleStr = (init, key) => {
  if (!init || !ts.isJsxExpression(init) || !init.expression || !ts.isObjectLiteralExpression(init.expression)) return undefined;
  for (const p of init.expression.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === key && ts.isStringLiteral(p.initializer)) return p.initializer.text;
  }
  return undefined;
};

const INTERACTIVE_TAGS = new Set(['button', 'a', 'Link', 'Button', 'Chip', 'IconButton']);
const FIELD_TAGS = new Set(['input', 'textarea', 'select', 'Input', 'Input.TextArea', 'Input.Password', 'Input.Search', 'TextArea', 'Select', 'Picker', 'DatePicker', 'Textarea']);
const NONSEMANTIC = new Set(['div', 'span', 'li', 'p', 'Text', 'Box', 'section', 'article', 'td', 'tr', 'Card', 'h1', 'h2', 'h3', 'h4', 'label', 'img']);
const IMG_TAGS = new Set(['img', 'Image', 'Avatar', 'ProductThumb']);

function scanFile(file, zone) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (!file.endsWith('.tsx')) return;
  const lucide = new Set();
  const labelFor = new Set();
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.moduleSpecifier.text === 'lucide-react' && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const el of st.importClause.namedBindings.elements) lucide.add(el.name.text);
    }
  }
  const walkNode = (node, ancestors) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const open = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = nameOf(open.tagName);
      const { m, spread } = attrsOf(open);
      const has = (k) => m.has(k);
      const ancestorTags = ancestors.map((a) => (ts.isJsxElement(a) ? nameOf(a.openingElement.tagName) : ''));
      const info = { tag };

      // 1) control bấm được không có tên khi chỉ có icon
      if ((INTERACTIVE_TAGS.has(tag) || (NONSEMANTIC.has(tag) && has('onClick') && m.get('role') && strOf(m.get('role')) === 'button')) && tag !== 'IconButton') {
        const named = has('aria-label') || has('aria-labelledby') || has('title') || has('ariaLabel') || has('label');
        if (!named && ts.isJsxElement(node)) {
          const k = childKinds(node, lucide);
          if (k.text === 0 && k.dynamic === 0 && (k.icon > 0 || k.symbol > 0)) {
            add('icon-only-no-name', zone, file, node, sf, { ...info, kids: k, spread });
          } else if (k.text === 0 && k.dynamic === 0 && k.other === 0 && !spread) {
            add('empty-control', zone, file, node, sf, { ...info, kids: k });
          }
        } else if (!named && ts.isJsxSelfClosingElement(node) && (tag === 'button' || tag === 'a') && !spread) {
          add('empty-control', zone, file, node, sf, info);
        }
      }

      // 2) ảnh thiếu alt
      if (IMG_TAGS.has(tag) && (tag === 'img' || tag === 'Image' || tag === 'ProductThumb' || tag === 'Avatar')) {
        if (!has('alt') && !spread && !(tag === 'Avatar' && !has('src'))) {
          add('img-no-alt', zone, file, node, sf, info);
        } else if (has('alt')) {
          const a = strOf(m.get('alt'));
          if (typeof a === 'string' && a.trim() !== '' && /^(image|img|photo|picture|ảnh|hình|hinh|anh|logo|banner|thumbnail)$/i.test(a.trim())) add('img-alt-generic', zone, file, node, sf, { ...info, alt: a });
        }
      }

      // 3) ô nhập thiếu nhãn
      if (FIELD_TAGS.has(tag)) {
        const type = strOf(m.get('type'));
        if (type === 'hidden' || type === 'file') {
          /* ô ẩn / file input: bỏ qua nếu ẩn */
        } else {
          const named = has('aria-label') || has('aria-labelledby') || has('label') || has('title');
          const inLabel = ancestorTags.includes('label') || ancestorTags.includes('Field') || ancestorTags.includes('Form.Item');
          const hasId = has('id');
          if (!named && !inLabel && !spread) {
            add(hasId ? 'field-id-only' : has('placeholder') ? 'field-placeholder-only' : 'field-no-label', zone, file, node, sf, { ...info, type, placeholder: has('placeholder') ? strOf(m.get('placeholder')) : undefined });
          }
        }
      }
      if (tag === 'label' && has('htmlFor')) labelFor.add(strOf(m.get('htmlFor')) ?? '(dynamic)');

      // 4) phần tử bấm được không phải control thật
      if (NONSEMANTIC.has(tag) && has('onClick') && !has('role') && !has('tabIndex') && !has('onKeyDown') && !has('onKeyUp') && !spread && tag !== 'img') {
        const insideInteractive = ancestorTags.some((t) => t === 'button' || t === 'a' || t === 'Link' || t === 'Button');
        add('click-nonsemantic', zone, file, node, sf, { ...info, insideInteractive });
      }
      if (has('onClick') && has('role') && /^(button|link|tab|radio|checkbox|switch)$/.test(strOf(m.get('role')) ?? '') && !has('tabIndex') && !has('onKeyDown') && !spread && !INTERACTIVE_TAGS.has(tag)) {
        add('role-no-keyboard', zone, file, node, sf, { ...info, role: strOf(m.get('role')) });
      }

      // 5) vùng chạm khai báo < 44px (chỉ cho phần tử bấm được)
      const clickable = INTERACTIVE_TAGS.has(tag) || has('onClick') || has('onPress');
      if (clickable && has('style')) {
        const cls = strOf(m.get('className')) ?? '';
        const hit44 = /tubu-hit-44|touch-target/.test(cls);
        const st = m.get('style');
        const h = styleNum(st, 'height');
        const mh = styleNum(st, 'minHeight');
        const w = styleNum(st, 'width');
        const mw = styleNum(st, 'minWidth');
        const vals = { h, mh, w, mw };
        const eff = (a, b) => Math.max(a ?? 0, b ?? 0);
        const hasDeclared = [h, mh, w, mw].some((v) => typeof v === 'number');
        if (hasDeclared && !hit44) {
          const height = eff(h, mh);
          const width = eff(w, mw);
          const smallH = (typeof h === 'number' || typeof mh === 'number') && height > 0 && height < 44;
          const smallW = tag !== 'Button' && (typeof w === 'number' || typeof mw === 'number') && width > 0 && width < 44;
          // chỉ báo khi chiều khai báo < 44 và phần tử nhìn như control độc lập (không phải thanh/dải full-width)
          if (smallH || smallW) add('touch-small', zone, file, node, sf, { ...info, ...vals, hit44, text: childKinds(ts.isJsxElement(node) ? node : { children: [] }, lucide).text > 0 });
        }
      }
    }
    ts.forEachChild(node, (c) => walkNode(c, ts.isJsxElement(node) ? [...ancestors, node] : ancestors));
  };
  walkNode(sf, []);
}

for (const sc of SCOPES) {
  for (const f of walk(path.join(ROOT, sc.dir))) {
    if (!/\.tsx$/.test(f) || isSpec(f)) continue;
    scanFile(f, sc.zone);
  }
}

const out = path.join(ROOT, 'docs/2026-10-20-uat/static/a11y-ast.json');
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), findings }, null, 1));
const byKind = {};
for (const f of findings) byKind[`${f.zone}:${f.kind}`] = (byKind[`${f.zone}:${f.kind}`] ?? 0) + 1;
console.log(byKind);
