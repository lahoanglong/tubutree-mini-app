// Luật 1: GET mới mà trình duyệt gọi (app-core, web, Mini App) phải có mặc định trong apps/e2e/tests/support/mock-api.ts. Thiếu thì mọi spec
// Playwright đi qua màn đó đỏ vì lời gọi không mock (w24-03: GET /me/restock-alerts làm đỏ 11 ca Mini ở lượt release).
//
// "Mới" tính theo từng nền tảng: đường dẫn có ở bản hiện tại mà nền tảng đó (Mini App = apps/miniapp + app-core, web = apps/web + app-core)
// chưa gọi ở gốc của wave. Chép một GET có sẵn của web sang Mini vẫn là GET mới của Mini. Chỉ phân tích tệp đổi (cả hai phía) cộng các tệp
// không đổi để loại đường dẫn chỉ dời chỗ.
//
// Lời gọi được nhận: `apiFetch(path, { method? })` của web và `<http|api|coreHttp|...>.get(path)` của HttpClient. Đường dẫn đọc từ chuỗi, mẫu
// chuỗi, phép `+`, `?:`/`??`/`||`, hằng `const` (ở bất kỳ tầng nào trong tệp) và hàm phụ cùng tệp (`cartPath('/cart')`, `path(id)`); phần
// `${…}` không đọc được thành `:param`, phần sau `?` (query) bị bỏ. Lời gọi không đọc ra đường dẫn (hằng nhập từ tệp khác, hàm ở tệp khác)
// được nhắc kèm tệp:dòng để người kiểm tay.
//
// Mặc định được nhận: `api.fallback('GET', …)`, `api.allowUnmocked('GET …')`, `api.get(…)` nằm trong fixture `test` (mọi spec), `mockSession`
// và `loyaltyDefaults` (spec đã đăng nhập, cả hai nền tảng), `shellDefaults` (chỉ project web). Helper chỉ vài spec gọi (`adminShellDefaults`)
// và dòng comment không tính.
//
// Lời gọi cố ý không cần mặc định đánh dấu bằng comment ngay trên hoặc cùng dòng `// wave-preflight-ignore mock-api-fallback: <lý do>`:
// GET chỉ chạy khi bấm (spec của nút tự mock), hoặc fetcher app-core chỉ chạy khi web dựng trang ở máy chủ (`createServerHttp`), nơi
// `page.route` của Playwright không chặn được.
import { lineOf, loadTypescript, readMany } from '../lib.mjs';

export const id = 'mock-api-fallback';
export const title = 'GET mới phía client có mock mặc định trong apps/e2e/tests/support/mock-api.ts';

export const MOCK_API = 'apps/e2e/tests/support/mock-api.ts';
export const CLIENT_ROOTS = ['packages/app-core/src', 'apps/web/src', 'apps/miniapp/src'];
const HTTP_RECEIVER = /^(http|api|coreHttp|rawCoreHttp|httpClient|client)$|Http$/;
const IGNORE = /wave-preflight-ignore mock-api-fallback:\s*\S/;
const HOLE = '\u0000';
const MAX_VALUES = 32;
const PLATFORM_NAME = { miniapp: 'Mini App', web: 'web' };

export const isClientSource = (rel) =>
  CLIENT_ROOTS.some((r) => rel.startsWith(`${r}/`)) &&
  /\.(ts|tsx)$/.test(rel) &&
  !/\.(spec|test)\.tsx?$|\.d\.ts$|\.stories\.tsx?$/.test(rel) &&
  !/(^|\/)(test-utils|test-support|__tests__|test|__mocks__)\//.test(rel);

/** Nền tảng chạy mã của một tệp: app-core dùng chung cho cả hai. */
export const platformsOf = (rel) => (rel.startsWith('apps/miniapp/') ? ['miniapp'] : rel.startsWith('apps/web/') ? ['web'] : ['miniapp', 'web']);

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

const cap = (vals) => [...new Set(vals)].slice(0, MAX_VALUES);

/** Hằng `const` (mọi tầng) và hàm phụ (khai `function` hoặc `const f = (…) => …`) của một tệp. */
function fileScope(ts, sf) {
  const consts = new Map();
  const fns = new Map();
  const returns = (body) => {
    const out = [];
    const walk = (n) => {
      if (ts.isFunctionLike(n)) return;
      if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
      ts.forEachChild(n, walk);
    };
    ts.forEachChild(body, walk);
    return out;
  };
  const fnOf = (f) => ({
    params: f.parameters.map((p) => ({ name: ts.isIdentifier(p.name) ? p.name.text : null, init: p.initializer })),
    bodies: f.body ? (ts.isBlock(f.body) ? returns(f.body) : [f.body]) : [],
  });
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && n.parent && n.parent.flags & ts.NodeFlags.Const) {
      const init = n.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fns.set(n.name.text, fnOf(init));
      else {
        if (!consts.has(n.name.text)) consts.set(n.name.text, []);
        consts.get(n.name.text).push(init);
      }
    } else if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, fnOf(n));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { consts, fns };
}

/** Mọi đường dẫn mà một biểu thức đối số có thể cho ra; phần không đọc được là HOLE. `env` gắn tham số của hàm phụ đang đọc. */
function pathValues(ts, expr, scope, env = new Map(), depth = 0) {
  if (!expr || depth > 8) return [HOLE];
  const next = (e, en = env) => pathValues(ts, e, scope, en, depth + 1);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr.text];
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression?.(expr)) return next(expr.expression);
  if (ts.isIdentifier(expr)) {
    if (env.has(expr.text)) return env.get(expr.text);
    const inits = scope.consts.get(expr.text);
    return inits ? cap(inits.flatMap((i) => next(i, new Map()))) : [HOLE];
  }
  if (ts.isConditionalExpression(expr)) return cap([...next(expr.whenTrue), ...next(expr.whenFalse)]);
  if (ts.isTemplateExpression(expr)) {
    let acc = [expr.head.text];
    for (const span of expr.templateSpans) {
      const parts = next(span.expression);
      acc = cap(acc.flatMap((a) => parts.map((v) => a + v + span.literal.text)));
    }
    return acc;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) {
      const right = next(expr.right);
      return cap(next(expr.left).flatMap((l) => right.map((r) => l + r)));
    }
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) return cap([...next(expr.left), ...next(expr.right)]);
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && scope.fns.has(expr.expression.text)) {
    const fn = scope.fns.get(expr.expression.text);
    const bound = new Map();
    fn.params.forEach((p, i) => {
      if (!p.name) return;
      const arg = expr.arguments[i];
      bound.set(p.name, arg ? next(arg) : p.init ? next(p.init, new Map()) : [HOLE]);
    });
    const vals = fn.bodies.flatMap((b) => next(b, bound));
    return vals.length > 0 ? cap(vals) : [HOLE];
  }
  return [HOLE];
}

/** `method` của đối số tuỳ chọn thứ hai: 'GET' khi không có, chuỗi viết hoa khi đọc được, null khi không đọc được. */
function methodOf(ts, opts, scope) {
  if (!opts) return 'GET';
  let obj = opts;
  if (ts.isIdentifier(obj)) {
    const inits = scope.consts.get(obj.text) ?? [];
    obj = inits.length === 1 ? inits[0] : null;
  }
  while (obj && (ts.isParenthesizedExpression(obj) || ts.isAsExpression(obj) || ts.isSatisfiesExpression?.(obj))) obj = obj.expression;
  if (!obj || !ts.isObjectLiteralExpression(obj)) return null;
  if (obj.properties.some((p) => ts.isSpreadAssignment(p))) return null;
  const prop = obj.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === 'method');
  if (!prop) return 'GET';
  if (ts.isPropertyAssignment(prop) && (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))) {
    return prop.initializer.text.toUpperCase();
  }
  return null;
}

/**
 * Các GET trong một tệp. Mỗi phần tử là `{ path, line, ignored }` khi đọc ra đường dẫn, hoặc `{ unresolved, line, ignored }` (`unresolved` là
 * mã nguồn của lời gọi rút gọn) khi không đọc ra đường dẫn hay method.
 */
export function extractGetCalls(ts, text, file) {
  if (!MAY_CALL.test(text)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const scope = fileScope(ts, sf);
  const lines = text.split('\n');
  const out = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = node.expression;
      let method;
      if (ts.isIdentifier(callee) && callee.text === 'apiFetch') method = methodOf(ts, node.arguments[1], scope);
      else if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'get') {
        const recv = callee.expression;
        const name = ts.isIdentifier(recv) ? recv.text : ts.isPropertyAccessExpression(recv) ? recv.name.text : '';
        if (HTTP_RECEIVER.test(name)) method = 'GET';
      }
      if (method !== undefined && method !== null && method !== 'GET') method = undefined;
      if (method !== undefined) {
        const line = lineOf(text, node.getStart(sf));
        const ignored = IGNORE.test(lines[line - 1] ?? '') || IGNORE.test(lines[line - 2] ?? '');
        const paths = [...new Set(pathValues(ts, node.arguments[0], scope).filter((v) => v.startsWith('/')).map(normalizePath))];
        if (method === 'GET' && paths.length > 0) for (const path of paths) out.push({ path, line, ignored });
        else {
          const src = node.getText(sf).replace(/\s+/g, ' ');
          out.push({ unresolved: src.length > 120 ? `${src.slice(0, 117)}…` : src, line, ignored });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// Nơi khai mặc định trong mock-api.ts và nền tảng mà nó phủ (shellDefaults chỉ chạy cho project "Web …").
const MOCK_SCOPES = { test: ['miniapp', 'web'], mockSession: ['miniapp', 'web'], loyaltyDefaults: ['miniapp', 'web'], shellDefaults: ['web'] };

/** Đường dẫn GET có mặc định → các nền tảng được phủ; `null` khi không tìm thấy fixture `test` (đổi cấu trúc thì sửa luật). */
export function mockedGetPaths(ts, text) {
  const sf = ts.createSourceFile(MOCK_API, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = new Map();
  const add = (pattern, platforms) => {
    if (!pattern.startsWith('/')) return;
    const key = normalizeMock(pattern);
    if (!out.has(key)) out.set(key, new Set());
    for (const p of platforms) out.get(key).add(p);
  };
  const str = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
  const scan = (root, platforms) => {
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const name = n.expression.name.text;
        const [a0, a1] = n.arguments;
        if ((name === 'fallback' || name === 'on') && str(a0)?.toUpperCase() === 'GET' && str(a1)) add(str(a1), platforms);
        else if (name === 'get' && str(a0)) add(str(a0), platforms);
        else if (name === 'allowUnmocked') {
          for (const a of n.arguments) {
            const m = /^GET\s+(\S+)/.exec(str(a) ?? '');
            if (m) add(m[1], platforms);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
  };
  let found = false;
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && MOCK_SCOPES[st.name.text] && st.name.text !== 'test') scan(st, MOCK_SCOPES[st.name.text]);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === 'test' && d.initializer) {
          found = true;
          scan(d.initializer, MOCK_SCOPES.test);
        }
      }
    }
  }
  return found ? out : null;
}

/** Mẫu của mock khớp đường dẫn đọc từ mã: cùng số đoạn, mỗi đoạn bằng nhau hoặc phía mock là `:param`. */
export function mockCovers(mock, path) {
  const a = mock.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((seg, i) => seg === b[i] || seg === ':param');
}

const collect = (ts, files) => {
  const paths = new Map();
  const unresolved = new Map();
  for (const [rel, text] of files) {
    if (text == null) continue;
    for (const c of extractGetCalls(ts, text, rel)) {
      const map = c.path !== undefined ? paths : unresolved;
      const key = c.path ?? c.unresolved;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ file: rel, line: c.line, ignored: c.ignored });
    }
  }
  return { paths, unresolved };
};

/** Nền tảng mà `key` mới xuất hiện: có ở bản hiện tại (lời gọi không bị bỏ qua) mà gốc và tệp không đổi của nền tảng đó chưa có. */
function freshPlatforms(key, head, before, elsewhere) {
  const has = (map, p) => (map.get(key) ?? []).some((s) => !s.ignored && platformsOf(s.file).includes(p));
  const sites = (head.get(key) ?? []).filter((s) => !s.ignored);
  const platforms = [...new Set(sites.flatMap((s) => platformsOf(s.file)))];
  return platforms.filter((p) => !has(before, p) && !has(elsewhere, p));
}

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
  const mockText = ctx.head.read(MOCK_API);
  const mocks = mockText == null ? null : mockedGetPaths(ts, mockText);
  if (!mocks) {
    res.errors.push(`không đọc được fixture \`test\` trong ${MOCK_API} (đổi cấu trúc thì sửa luật này)`);
    return res;
  }
  const changedSet = new Set(changed);
  const head = collect(ts, readMany(ctx.head, changed));
  const before = collect(ts, readMany(ctx.base, changed));
  const unchangedFiles = CLIENT_ROOTS.flatMap((r) => ctx.head.list(r)).filter((f) => isClientSource(f) && !changedSet.has(f));
  const elsewhere = collect(ts, readMany(ctx.head, unchangedFiles));

  let fresh = 0;
  let covered = 0;
  for (const path of [...head.paths.keys()].sort()) {
    const sites = head.paths.get(path);
    if (sites.every((s) => s.ignored)) {
      if (!before.paths.has(path)) res.notes.push(`GET ${path}: bỏ qua theo comment wave-preflight-ignore (${sites[0].file}:${sites[0].line})`);
      continue;
    }
    const platforms = freshPlatforms(path, head.paths, before.paths, elsewhere.paths);
    if (platforms.length === 0) continue;
    fresh++;
    const missing = platforms.filter((p) => ![...mocks].some(([m, on]) => on.has(p) && mockCovers(m, path)));
    if (missing.length === 0) {
      covered++;
      continue;
    }
    const where = sites
      .filter((s) => !s.ignored && platformsOf(s.file).some((p) => missing.includes(p)))
      .map((s) => `${s.file}:${s.line}`)
      .join(', ');
    res.errors.push(
      `GET ${path} (${where}) là đường dẫn mới trên ${missing.map((p) => PLATFORM_NAME[p]).join(' và ')} nhưng ${MOCK_API} chưa có ` +
        `\`api.fallback('GET', '${path}', <mặc định như PROD khi cờ tắt>)\` trong fixture \`test\`${missing.includes('miniapp') ? '' : ' hoặc shellDefaults'}; ` +
        'spec Playwright nào đi qua màn này sẽ đỏ vì lời gọi không mock',
    );
  }
  for (const key of [...head.unresolved.keys()].sort()) {
    if (freshPlatforms(key, head.unresolved, before.unresolved, elsewhere.unresolved).length === 0) continue;
    const s = head.unresolved.get(key).find((x) => !x.ignored);
    res.warnings.push(
      `không đọc ra đường dẫn hoặc method của lời gọi GET mới \`${key}\` (${s.file}:${s.line}): tự kiểm ${MOCK_API} có mặc định cho nó, ` +
        'rồi ghi comment wave-preflight-ignore kèm lý do',
    );
  }
  res.notes.push(`${changed.length} tệp client đổi, ${fresh} GET mới, ${covered} đã có mặc định`);
  return res;
}
