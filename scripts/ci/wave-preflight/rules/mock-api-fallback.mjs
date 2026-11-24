// Luật 1: GET mới mà trình duyệt gọi (app-core, web, Mini App) phải có mặc định trong fixture `api` của e2e. Thiếu thì mọi spec Playwright đi
// qua màn đó đỏ vì lời gọi không mock (w24-03: GET /me/restock-alerts làm đỏ 11 ca Mini ở lượt release).
//
// "Mới" = đường dẫn có ở bản hiện tại nhưng không có ở gốc của wave. Chỉ phân tích tệp đổi (cả hai phía) cộng các tệp không đổi để loại đường
// dẫn chỉ dời chỗ. Lời gọi được nhận: `apiFetch(path, { method? })` của web và `<http|api|coreHttp|...>.get(path)` của HttpClient.
// Đường dẫn đọc từ chuỗi, mẫu chuỗi, phép `+`, toán tử `?:`/`??`/`||` và hằng `const X = '/…'` cùng tệp; phần `${…}` thành `:param`, phần sau `?`
// (query) bị bỏ. Lời gọi cố ý không cần mặc định (chỉ chạy khi bấm, spec của nó tự mock) đánh dấu bằng comment ngay trên hoặc cùng dòng:
// `// wave-preflight-ignore mock-api-fallback: <lý do>`.
import { lineOf, loadTypescript, readMany } from '../lib.mjs';

export const id = 'mock-api-fallback';
export const title = 'GET mới phía client có mock mặc định trong apps/e2e/tests/support/mock-api.ts';

export const MOCK_API = 'apps/e2e/tests/support/mock-api.ts';
export const CLIENT_ROOTS = ['packages/app-core/src', 'apps/web/src', 'apps/miniapp/src'];
const HTTP_RECEIVER = /^(http|api|coreHttp|rawCoreHttp|httpClient|client)$|Http$/;
const IGNORE = /wave-preflight-ignore mock-api-fallback:\s*\S/;
const HOLE = '\u0000';

export const isClientSource = (rel) =>
  CLIENT_ROOTS.some((r) => rel.startsWith(`${r}/`)) &&
  /\.(ts|tsx)$/.test(rel) &&
  !/\.(spec|test)\.tsx?$|\.d\.ts$|\.stories\.tsx?$/.test(rel) &&
  !/(^|\/)(test-utils|test-support|__tests__|test|__mocks__)\//.test(rel);

// Lọc thô trước khi dựng cây cú pháp: tệp không có hai dạng gọi này thì không cần parse.
const MAY_CALL = /apiFetch\s*[<(]|\.get\s*[<(]/;

/** `/a/${x}/b?y=1` → `/a/:param/b`. Lỗ dính đuôi đoạn cuối (`/x${qs}`) coi là query nên bỏ; lỗ khác trong một đoạn thành `:param`. */
export function normalizePath(raw) {
  const segs = raw.split('?')[0].split('/');
  const last = segs.length - 1;
  const p = segs
    .map((s, i) => {
      if (!s.includes(HOLE)) return s;
      if (i === last && !s.startsWith(HOLE) && s.indexOf(HOLE) === s.length - 1) return s.slice(0, -1);
      return ':param';
    })
    .join('/')
    .replace(/\/{2,}/g, '/');
  return p.length > 1 ? p.replace(/\/$/, '') : p;
}

/** `/products/:slug/bundles` → `/products/:param/bundles` để so với đường dẫn đọc từ mã. */
const normalizeMock = (p) => normalizePath(p).replace(/(^|\/):[^/]+/g, '$1:param');

/** Mọi đường dẫn mà một biểu thức đối số có thể cho ra; phần không đọc được là HOLE. */
function pathValues(ts, expr, consts, depth = 0) {
  if (!expr || depth > 8) return [HOLE];
  const next = (e) => pathValues(ts, e, consts, depth + 1);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) return next(expr.expression);
  if (ts.isIdentifier(expr)) return consts.has(expr.text) ? next(consts.get(expr.text)) : [HOLE];
  if (ts.isConditionalExpression(expr)) return [...next(expr.whenTrue), ...next(expr.whenFalse)];
  if (ts.isTemplateExpression(expr)) {
    let acc = [expr.head.text];
    for (const span of expr.templateSpans) {
      const parts = next(span.expression);
      acc = acc.flatMap((a) => parts.map((v) => a + v + span.literal.text));
    }
    return acc;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) {
      const right = next(expr.right);
      return next(expr.left).flatMap((l) => right.map((r) => l + r));
    }
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) return [...next(expr.left), ...next(expr.right)];
  }
  return [HOLE];
}

/** `method` của đối số tuỳ chọn thứ hai: 'GET' khi không có, chuỗi viết hoa khi là hằng, null khi không đọc được. */
function methodOf(ts, opts) {
  if (!opts) return 'GET';
  if (!ts.isObjectLiteralExpression(opts)) return null;
  const prop = opts.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'method');
  if (!prop) return 'GET';
  if (ts.isPropertyAssignment(prop) && (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))) {
    return prop.initializer.text.toUpperCase();
  }
  return null;
}

/** Các GET trong một tệp: `{ path, line, ignored }`, path đã chuẩn hoá. */
export function extractGetCalls(ts, text, file) {
  if (!MAY_CALL.test(text)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const consts = new Map();
  for (const st of sf.statements) {
    const list = ts.isVariableStatement(st) ? st.declarationList : null;
    if (!list || !(list.flags & ts.NodeFlags.Const)) continue;
    for (const d of list.declarations) if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer);
  }
  const lines = text.split('\n');
  const out = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      let method = null;
      if (ts.isIdentifier(callee) && callee.text === 'apiFetch') method = methodOf(ts, node.arguments[1]);
      else if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'get') {
        const recv = callee.expression;
        const name = ts.isIdentifier(recv) ? recv.text : ts.isPropertyAccessExpression(recv) ? recv.name.text : '';
        if (HTTP_RECEIVER.test(name)) method = 'GET';
      }
      if (method === 'GET') {
        const line = lineOf(text, node.getStart(sf));
        const ignored = IGNORE.test(lines[line - 1] ?? '') || IGNORE.test(lines[line - 2] ?? '');
        for (const v of new Set(pathValues(ts, node.arguments[0], consts))) {
          if (v.startsWith('/')) out.push({ path: normalizePath(v), line, ignored });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Đường dẫn GET có mặc định: `api.fallback('GET', …)` và `api.allowUnmocked('GET …')` trong mock-api.ts. */
export function mockedGetPaths(text) {
  const out = new Set();
  for (const m of text.matchAll(/\.fallback\(\s*(['"`])GET\1\s*,\s*(['"`])([^'"`]+)\2/g)) out.add(normalizeMock(m[3]));
  for (const m of text.matchAll(/\.allowUnmocked\(([^)]*)\)/g)) {
    for (const s of m[1].matchAll(/(['"`])GET\s+([^'"`]+)\1/g)) out.add(normalizeMock(s[2]));
  }
  return out;
}

/** Mẫu của mock khớp đường dẫn đọc từ mã: cùng số đoạn, mỗi đoạn bằng nhau hoặc phía mock là `:param`. */
export function mockCovers(mock, path) {
  const a = mock.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg === b[i] || seg === ':param');
}

const collect = (ts, files) => {
  const map = new Map();
  for (const [rel, text] of files) {
    if (text == null) continue;
    for (const c of extractGetCalls(ts, text, rel)) {
      if (!map.has(c.path)) map.set(c.path, []);
      map.get(c.path).push({ file: rel, line: c.line, ignored: c.ignored });
    }
  }
  return map;
};

export async function check(ctx) {
  const res = { errors: [], warnings: [], notes: [] };
  if (!ctx.base || !ctx.changed) {
    res.warnings.push('không có gốc so sánh (origin/main hoặc --base), bỏ qua luật này');
    return res;
  }
  const changed = ctx.changed.filter(isClientSource);
  if (changed.length === 0) {
    res.notes.push('không đổi tệp client nào');
    return res;
  }
  const ts = await loadTypescript();
  if (!ts) {
    res.errors.push('không nạp được typescript: chạy `pnpm install` ở gốc repo rồi chạy lại');
    return res;
  }
  const changedSet = new Set(changed);
  const head = collect(ts, readMany(ctx.head, changed));
  const before = collect(ts, readMany(ctx.base, changed));
  const unchangedFiles = CLIENT_ROOTS.flatMap((r) => ctx.head.list(r)).filter((f) => isClientSource(f) && !changedSet.has(f));
  const elsewhere = collect(ts, readMany(ctx.head, unchangedFiles));
  const fresh = [...head.keys()].filter((p) => !before.has(p) && !elsewhere.has(p)).sort();

  const mockText = ctx.head.read(MOCK_API);
  if (mockText == null) {
    res.errors.push(`không thấy ${MOCK_API}`);
    return res;
  }
  const mocks = [...mockedGetPaths(mockText)];
  let covered = 0;
  for (const path of fresh) {
    const sites = head.get(path);
    if (mocks.some((m) => mockCovers(m, path))) {
      covered++;
      continue;
    }
    if (sites.every((s) => s.ignored)) {
      res.notes.push(`GET ${path}: bỏ qua theo comment wave-preflight-ignore (${sites[0].file}:${sites[0].line})`);
      continue;
    }
    const where = sites.map((s) => `${s.file}:${s.line}`).join(', ');
    res.errors.push(
      `GET ${path} (${where}) là đường dẫn mới nhưng ${MOCK_API} chưa có \`api.fallback('GET', '${path}', <mặc định như PROD khi cờ tắt>)\`; ` +
        'spec Playwright nào đi qua màn này sẽ đỏ vì lời gọi không mock',
    );
  }
  res.notes.push(`${changed.length} tệp client đổi, ${fresh.length} GET mới, ${covered} đã có mặc định`);
  return res;
}
