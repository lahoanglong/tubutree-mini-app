// Trích danh sách endpoint + kiểu phản hồi từ mã nguồn (TypeScript compiler API) để harness chụp
// màn hình dựng dữ liệu giả ĐÚNG shape mà không phải viết tay hàng trăm mock.
//
//   node docs/2026-10-20-uat/tools/uiux/extract-endpoints.mjs miniapp   -> tools/uiux/generated/miniapp-endpoints.json
//
// Bản chép từ scripts/uiux/extract-endpoints.mjs cho phiên UAT 2026-10-20: chỉ đổi gốc repo (5 cấp trên) và
// thư mục ghi (generated/ cạnh file này), để không ghi đè bảng endpoint đã commit.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');

const target = process.argv[2] ?? 'miniapp';
const appDir = path.join(root, 'apps', target);
const outFile = path.join(here, 'generated', `${target}-endpoints.json`);

const cfgPath = path.join(appDir, 'tsconfig.json');
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n')),
});
const files = cfg.fileNames.filter((f) => !/\.(spec|test)\.(ts|tsx)$/.test(f) && !f.includes('node_modules') && !f.includes('.next'));
const program = ts.createProgram({ rootNames: files, options: { ...cfg.options, noEmit: true, skipLibCheck: true } });
const checker = program.getTypeChecker();

const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete']);

function urlPattern(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let s = node.head.text;
    node.templateSpans.forEach((sp, i) => {
      let name = 'p' + i;
      const e = sp.expression;
      if (ts.isIdentifier(e)) name = e.text;
      else if (ts.isPropertyAccessExpression(e)) name = e.name.text;
      else if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && /encodeURIComponent/.test(e.expression.text) && e.arguments[0]) {
        const a = e.arguments[0];
        name = ts.isIdentifier(a) ? a.text : ts.isPropertyAccessExpression(a) ? a.name.text : name;
      }
      // Phần "?query" nối bằng biến (vd `${qs}`) → bỏ phần đó để lấy path thuần.
      s += `:${name}` + sp.literal.text;
    });
    return s;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = urlPattern(node.left);
    const r = ts.isStringLiteral(node.right) ? node.right.text : ':x';
    return l === null ? null : l + r;
  }
  if (ts.isParenthesizedExpression(node)) return urlPattern(node.expression);
  return null;
}

function cleanPath(p) {
  if (p == null) return null;
  // bỏ query-string; path động `:qs` ở cuối (tham số truy vấn nối bằng biến) cũng bỏ
  let s = p.split('?')[0];
  s = s.replace(/\/:(qs|query|params|search|q|queryString)$/i, '');
  s = s.replace(/:(qs|query|params|search|queryString)$/i, '');
  return s;
}

const seen = new Map(); // key -> entry
const SCHEMA_CACHE = new Map();

function typeToSchema(t, depth = 0, stack = new Set()) {
  if (depth > 7) return { k: 'any' };
  const flags = t.flags;
  const F = ts.TypeFlags;
  if (flags & F.Any || flags & F.Unknown) return { k: 'any' };
  if (flags & F.StringLiteral) return { k: 'lit', v: t.value };
  if (flags & F.NumberLiteral) return { k: 'lit', v: t.value };
  if (flags & F.BooleanLiteral) return { k: 'bool' };
  if (flags & F.String) return { k: 'str' };
  if (flags & F.Number) return { k: 'num' };
  if (flags & F.Boolean) return { k: 'bool' };
  if (flags & F.Null) return { k: 'null' };
  if (flags & F.Undefined || flags & F.Void) return { k: 'undef' };
  if (flags & F.BigInt) return { k: 'num' };
  if (t.isUnion()) {
    const parts = t.types.filter((x) => !(x.flags & (F.Undefined | F.Null | F.Void)));
    if (parts.length === 0) return { k: 'null' };
    // boolean = true|false
    if (parts.every((x) => x.flags & F.BooleanLiteral)) return { k: 'bool' };
    if (parts.every((x) => x.flags & (F.StringLiteral | F.NumberLiteral))) {
      return { k: 'enum', v: parts.map((x) => x.value) };
    }
    const nonLitBool = parts.filter((x) => !(x.flags & F.BooleanLiteral));
    const first = nonLitBool[0] ?? parts[0];
    // Union của nhiều kiểu object: lấy thành viên đầu + ghi chú các thành viên còn lại để harness có thể chọn.
    if (nonLitBool.length > 1 && nonLitBool.every((x) => x.flags & F.Object)) {
      return { k: 'union', of: nonLitBool.slice(0, 4).map((x) => typeToSchema(x, depth + 1, stack)) };
    }
    return typeToSchema(first, depth + 1, stack);
  }
  if (t.isIntersection()) {
    const props = {};
    for (const part of t.types) {
      const s = typeToSchema(part, depth + 1, stack);
      if (s.k === 'obj') Object.assign(props, s.props);
    }
    return { k: 'obj', props };
  }
  if (flags & F.Object) {
    const sym = t.getSymbol();
    const name = sym?.getName();
    if (checker.isArrayType(t) || checker.isTupleType(t)) {
      const el = checker.getTypeArguments(t)[0];
      return { k: 'arr', of: el ? typeToSchema(el, depth + 1, stack) : { k: 'any' } };
    }
    if (name === 'Date') return { k: 'str', name: 'date' };
    if (name === 'Promise') {
      const a = checker.getTypeArguments(t)[0];
      return a ? typeToSchema(a, depth + 1, stack) : { k: 'any' };
    }
    const id = t.id ?? name;
    if (stack.has(id)) return { k: 'any' };
    const next = new Set(stack);
    next.add(id);
    const props = {};
    for (const p of checker.getPropertiesOfType(t)) {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      const pt = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getTypeOfSymbol(p);
      const opt = !!(p.flags & ts.SymbolFlags.Optional);
      props[p.getName()] = { s: typeToSchema(pt, depth + 1, next), opt };
    }
    const idx = t.getStringIndexType?.();
    if (idx && Object.keys(props).length === 0) return { k: 'rec', of: typeToSchema(idx, depth + 1, next) };
    return { k: 'obj', props };
  }
  return { k: 'any' };
}

function findAsType(node) {
  // Tìm `as X` trong cùng biểu thức chuỗi: api.get(...).then((r) => r.data as X)
  let cur = node;
  for (let i = 0; i < 6 && cur; i++) {
    const parent = cur.parent;
    if (!parent) break;
    if (ts.isPropertyAccessExpression(parent) && parent.expression === cur && parent.name.text === 'then') {
      const call = parent.parent;
      if (ts.isCallExpression(call)) {
        const arg = call.arguments[0];
        let found = null;
        const visit = (n) => {
          if (found) return;
          if (ts.isAsExpression(n)) {
            found = checker.getTypeFromTypeNode(n.type);
            return;
          }
          ts.forEachChild(n, visit);
        };
        if (arg) visit(arg);
        if (found) return found;
      }
      cur = call;
    } else break;
  }
  return null;
}

function record(method, rawUrl, type, file, line) {
  const p = cleanPath(rawUrl);
  if (!p || !p.startsWith('/')) return;
  const key = `${method.toUpperCase()} ${p}`;
  const schema = type ? typeToSchema(type) : { k: 'any' };
  const rel = path.relative(root, file).replace(/\\/g, '/');
  if (!seen.has(key)) seen.set(key, { method: method.toUpperCase(), path: p, schema, sources: [`${rel}:${line}`] });
  else {
    const e = seen.get(key);
    if (e.schema.k === 'any' && schema.k !== 'any') e.schema = schema;
    if (e.sources.length < 4) e.sources.push(`${rel}:${line}`);
  }
}

function visitFile(sf) {
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // miniapp: api.get<T>(url) ; web: apiFetch<T>(url, { method })
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'api' && HTTP.has(callee.name.text)) {
        const method = callee.name.text;
        const url = urlPattern(node.arguments[0]);
        let type = null;
        if (node.typeArguments?.[0]) type = checker.getTypeFromTypeNode(node.typeArguments[0]);
        else type = findAsType(node);
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        record(method, url, type, sf.fileName, line + 1);
      } else if (ts.isIdentifier(callee) && /^(apiFetch|merchantFetch|shopFetch|request)$/.test(callee.text)) {
        const url = urlPattern(node.arguments[0]);
        let method = 'get';
        const opts = node.arguments[1];
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const pr of opts.properties) {
            if (ts.isPropertyAssignment(pr) && pr.name.getText() === 'method' && ts.isStringLiteral(pr.initializer)) method = pr.initializer.text.toLowerCase();
          }
        }
        let type = null;
        if (node.typeArguments?.[0]) type = checker.getTypeFromTypeNode(node.typeArguments[0]);
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        record(method, url, type, sf.fileName, line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile) continue;
  if (!files.includes(sf.fileName.replace(/\//g, path.sep)) && !files.includes(sf.fileName)) continue;
  visitFile(sf);
}

const out = [...seen.values()].sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const typed = out.filter((e) => e.schema.k !== 'any').length;
console.log(`${target}: ${out.length} endpoints (${typed} có kiểu phản hồi) -> ${path.relative(root, outFile)}`);
