// Trích mọi chuỗi có thể hiện ra cho người dùng (JSX text, thuộc tính chữ, chuỗi trong vi.ts, toast, lỗi...)
// từ miniapp + admin web. Ghi docs/2026-10-20-uat/static/strings.tsv (zone, file, line, kind, text).
//   node docs/2026-10-20-uat/tools/extract-strings.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const ts = createRequire(path.join(ROOT, 'apps/miniapp/package.json'))('typescript');
const SCOPES = [
  { zone: 'miniapp', dir: 'apps/miniapp/src' },
  { zone: 'web-admin-app', dir: 'apps/web/src/app/admin' },
  { zone: 'web-admin-comp', dir: 'apps/web/src/components/admin' },
  { zone: 'web-admin-lib', dir: 'apps/web/src/lib', only: /admin/ },
  { zone: 'app-core', dir: 'packages/app-core/src', only: /./ },
];
const UI_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'helperText', 'message', 'description', 'subtitle', 'text', 'emptyText', 'okText', 'cancelText', 'hint', 'error', 'ariaLabel', 'caption', 'heading', 'body', 'cta', 'confirmLabel', 'cancelLabel']);
const walk = (d, out = []) => {
  if (!fs.existsSync(d)) return out;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(d, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const isSpec = (p) => /\.(spec|test)\.(ts|tsx)$/.test(p) || /\/test-utils\//.test(p) || /\.d\.ts$/.test(p);
const rows = [];
const clean = (s) => s.replace(/\s+/g, ' ').trim();

function scan(file, zone) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = path.relative(ROOT, file);
  const add = (node, kind, t) => {
    const raw = t;
    if (!raw || !/[\p{L}]/u.test(raw)) return;
    rows.push({ zone, file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, kind, text: clean(raw), rawHasNewline: /\n/.test(raw) });
  };
  const visit = (node, ctx) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxText(node)) {
      add(node, 'jsx', node.text);
    } else if (ts.isJsxAttribute(node)) {
      const n = node.name.getText();
      const init = node.initializer;
      if (UI_ATTRS.has(n) && init) {
        if (ts.isStringLiteral(init)) add(init, `attr:${n}`, init.text);
        else if (ts.isJsxExpression(init) && init.expression) {
          const e = init.expression;
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) add(e, `attr:${n}`, e.text);
          else if (ts.isTemplateExpression(e)) add(e, `attr:${n}`, e.head.text + e.templateSpans.map((s) => '${…}' + s.literal.text).join(''));
        }
        return;
      }
      if (n === 'className' || n === 'style' || n === 'key' || n === 'id' || n === 'data-testid' || n === 'type' || n === 'name' || n === 'href' || n === 'src' || n === 'role' || n === 'variant' || n === 'tone' || n === 'size' || n === 'as' || n === 'htmlFor' || n === 'autoComplete' || n === 'inputMode' || n === 'rel' || n === 'target' || n === 'method') return;
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      if (ts.isPropertyAssignment(p) && p.name === node) return; // khoá object
      if (ts.isJsxAttribute(p)) return;
      if (ts.isCallExpression(p) && /^(require|import)$/.test(p.expression.getText())) return;
      if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return;
      if (ts.isCaseClause(p) || ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText())) return;
      if (ts.isLiteralTypeNode(p) || ts.isTypeReferenceNode(p)) return;
      // chuỗi có ít nhất 1 chữ có dấu tiếng Việt, hoặc ≥2 từ Latin, hoặc 1 từ Latin hoa đầu
      const t = node.text;
      if (/[à-ỹÀ-Ỹđ]/u.test(t) || /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t) || /^[A-Z][a-z]{2,}$/.test(t)) add(node, 'str', t);
    } else if (ts.isTemplateExpression(node)) {
      const t = node.head.text + node.templateSpans.map((s) => '${…}' + s.literal.text).join('');
      if (!ts.isJsxAttribute(node.parent) && (/[à-ỹÀ-Ỹđ]/u.test(t) || /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(t))) add(node, 'tpl', t);
    }
    ts.forEachChild(node, (c) => visit(c, ctx));
  };
  visit(sf, {});
}
for (const sc of SCOPES) {
  for (const f of walk(path.join(ROOT, sc.dir))) {
    if (!/\.(tsx?)$/.test(f) || isSpec(f)) continue;
    if (sc.only && !sc.only.test(path.relative(ROOT, f))) continue;
    scan(f, sc.zone);
  }
}
const out = path.join(ROOT, 'docs/2026-10-20-uat/static/strings.tsv');
fs.writeFileSync(out, rows.map((r) => [r.zone, r.file, r.line, r.kind, r.text.replace(/\t/g, ' ')].join('\t')).join('\n'));
const byZone = {};
for (const r of rows) byZone[r.zone] = (byZone[r.zone] ?? 0) + 1;
console.log(rows.length, byZone);
