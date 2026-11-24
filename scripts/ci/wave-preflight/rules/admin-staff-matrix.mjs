// Luật 6: bảng EXPECTED của apps/api/src/common/staff-permissions.matrix.spec.ts khớp đúng các route quản trị khai trong controller. Cùng phạm vi
// với spec jest (`inScope`): @Roles chỉ ADMIN, @Roles có STAFF, có @AllowStaff, hoặc đường dẫn có đoạn `admin` (/admin/*, /feed/admin/*…);
// cùng cách tính quyền (@Roles/@AllowStaff của hàm thắng của lớp, STAFF → `STAFF`, còn lại là nhóm việc theo thứ tự STAFF_PERMISSIONS).
// Spec jest dựng cả AppModule; luật này đọc decorator bằng cây cú pháp TypeScript (bỏ qua comment) nên chạy trong vài trăm mili giây.
// Đối số decorator không đọc được (không phải chuỗi, mảng chuỗi, `Role.X`, hay `...HẰNG` mảng chuỗi) thì báo đỏ thay vì bỏ sót.
import { loadTypescript, quotedStrings, sliceBlock } from '../lib.mjs';

export const id = 'admin-staff-matrix';
export const title = 'Route quản trị (/admin, @Roles ADMIN/STAFF, @AllowStaff) khớp bảng quyền staff-permissions.matrix.spec.ts';

export const API_SRC = 'apps/api/src';
export const MATRIX_SPEC = 'apps/api/src/common/staff-permissions.matrix.spec.ts';

const HTTP = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options']);
const PERMS = ['CSKH', 'KHO', 'MARKETING', 'KE_TOAN'];
const joinPath = (a, b) => `/${[a, b].filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
export const isAdminPath = (path) => /(^|\/)admin(\/|$)/.test(path);

/** `const X = ['a', 'b']` (kể cả `as const`, có kiểu) ở mọi tệp, để đọc `@AllowStaff(...COMMUNITY_MODERATORS)`. */
function constArrays(texts) {
  const out = new Map();
  for (const s of texts) {
    if (s == null) continue;
    for (const m of s.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=\n]+)?=\s*\[([^\]]*)\]\s*(?:as const)?\s*;/g)) out.set(m[1], quotedStrings(m[2]));
  }
  return out;
}

const decoratorsOf = (ts, node) => (ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []);

/** Tên và đối số của một decorator dạng gọi `@Ten(...)`. */
function callOf(ts, dec) {
  const e = dec.expression;
  if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression)) return null;
  return { name: e.expression.text, args: e.arguments };
}

/** Chuỗi của các đối số: 'X', `X`, Role.X, X (tên trần), ...HẰNG; `null` khi có đối số không đọc được. */
function argStrings(ts, args, arrays) {
  const out = [];
  for (const a of args) {
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) out.push(a.text);
    else if (ts.isPropertyAccessExpression(a)) out.push(a.name.text);
    else if (ts.isIdentifier(a)) out.push(a.text);
    else if (ts.isSpreadElement(a) && ts.isIdentifier(a.expression) && arrays.has(a.expression.text)) out.push(...arrays.get(a.expression.text));
    else return null;
  }
  return out;
}

/** Đường dẫn của @Controller/@Get…: không đối số, chuỗi, mảng chuỗi, hoặc `{ path }`; `null` khi không đọc được. */
function pathArgs(ts, args) {
  if (args.length === 0) return [''];
  const a = args[0];
  if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return [a.text];
  if (ts.isArrayLiteralExpression(a) && a.elements.every((e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))) return a.elements.map((e) => e.text);
  if (ts.isObjectLiteralExpression(a)) {
    const p = a.properties.find((x) => ts.isPropertyAssignment(x) && x.name && ts.isIdentifier(x.name) && x.name.text === 'path');
    return p ? pathArgs(ts, [p.initializer]) : [''];
  }
  return null;
}

/** Mọi route của các controller: `{ key, file, line, roles, allowed, access, inScope }`, và các chỗ không đọc được. */
export function controllerRoutes(ts, files, arrays = new Map()) {
  const routes = [];
  const problems = [];
  for (const [rel, text] of files) {
    if (text == null || !text.includes('@Controller(')) continue;
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const where = (node) => `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
    const read = (node, decs) => {
      const res = {};
      for (const d of decs) {
        const c = callOf(ts, d);
        if (!c || (c.name !== 'Roles' && c.name !== 'AllowStaff')) continue;
        const v = argStrings(ts, c.args, arrays);
        if (v === null) problems.push(`${where(d)}: @${c.name}(${c.args.map((x) => x.getText(sf)).join(', ')}) không đọc được (dùng chuỗi hoặc ...HẰNG mảng chuỗi)`);
        else res[c.name] = v;
      }
      return res;
    };
    const visit = (node) => {
      if (ts.isClassDeclaration(node)) {
        const decs = decoratorsOf(ts, node);
        const ctrl = decs.map((d) => callOf(ts, d)).find((c) => c?.name === 'Controller');
        if (ctrl) {
          const prefixes = pathArgs(ts, ctrl.args);
          if (!prefixes) problems.push(`${where(node)}: @Controller(${ctrl.args.map((x) => x.getText(sf)).join(', ')}) không phải chuỗi trực tiếp`);
          const cls = read(node, decs);
          for (const m of node.members) {
            const mdecs = decoratorsOf(ts, m);
            const verbs = mdecs.map((d) => callOf(ts, d)).filter((c) => c && HTTP.has(c.name));
            if (verbs.length === 0 || !prefixes) continue;
            const own = read(m, mdecs);
            // Cùng thứ tự với RolesGuard (getAllAndOverride): decorator của hàm (kể cả rỗng) thắng của lớp.
            const roles = own.Roles ?? cls.Roles ?? [];
            const allowed = own.AllowStaff ?? cls.AllowStaff ?? [];
            const access = roles.includes('STAFF') ? 'STAFF' : PERMS.filter((p) => allowed.includes(p));
            for (const v of verbs) {
              const subs = pathArgs(ts, v.args);
              if (!subs) {
                problems.push(`${where(m)}: @${v.name}(${v.args.map((x) => x.getText(sf)).join(', ')}) không phải chuỗi trực tiếp`);
                continue;
              }
              for (const p of prefixes) {
                for (const q of subs) {
                  const path = joinPath(p, q);
                  const inScope = (roles.length === 1 && roles[0] === 'ADMIN') || roles.includes('STAFF') || allowed.length > 0 || isAdminPath(path);
                  routes.push({ key: `${v.name.toUpperCase()} ${path}`, file: where(m), roles, allowed, access, inScope });
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { routes, problems };
}

/** Khoá `METHOD /path` → quyền của EXPECTED: `STAFF`, `[]` (ADMIN_ONLY), mảng nhóm việc, hoặc `undefined` khi viết dạng khác. */
export function matrixEntries(text) {
  const block = sliceBlock(text, 'const EXPECTED', '\n};');
  if (!block) return null;
  const out = new Map();
  for (const m of block.matchAll(/^\s*(['"])([A-Z]+ \/[^'"]*)\1\s*:\s*([^\n]*?),?\s*$/gm)) {
    const v = m[3].trim();
    const list = /^\[([\w\s,]*)\]$/.exec(v);
    out.set(m[2], v === 'STAFF' ? 'STAFF' : v === 'ADMIN_ONLY' ? [] : list ? list[1].split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  }
  return out;
}

const show = (a) => (a === 'STAFF' ? 'STAFF' : a.length === 0 ? 'ADMIN_ONLY' : `[${a.join(', ')}]`);
const sameAccess = (a, b) => (a === 'STAFF' || b === 'STAFF' ? a === b : a.length === b.length && a.every((x) => b.includes(x)));

export async function check(ctx) {
  const res = { errors: [], warnings: [], notes: [] };
  const spec = ctx.head.read(MATRIX_SPEC);
  const expected = spec == null ? null : matrixEntries(spec);
  if (!expected || expected.size === 0) {
    res.errors.push(`không đọc được bảng EXPECTED trong ${MATRIX_SPEC}`);
    return res;
  }
  const ts = await loadTypescript();
  if (!ts) {
    res.errors.push('không nạp được typescript: chạy `pnpm install` ở gốc repo rồi chạy lại');
    return res;
  }
  const sources = ctx.head.list(API_SRC).filter((f) => f.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(f));
  const texts = sources.map((f) => [f, ctx.head.read(f)]);
  const { routes, problems } = controllerRoutes(ts, texts, constArrays(texts.map(([, t]) => t)));
  res.errors.push(...problems);

  const scoped = routes.filter((r) => r.inScope);
  const byKey = new Map();
  for (const r of scoped) {
    if (byKey.has(r.key)) res.errors.push(`route ${r.key} khai hai lần (${byKey.get(r.key).file}, ${r.file})`);
    else byKey.set(r.key, r);
  }
  for (const r of byKey.values()) {
    if (!expected.has(r.key)) {
      res.errors.push(`route quản trị ${r.key} (${r.file}) chưa có trong EXPECTED của ${MATRIX_SPEC}: thêm \`'${r.key}': ${show(r.access)},\``);
      continue;
    }
    const want = expected.get(r.key);
    if (want === undefined) res.warnings.push(`EXPECTED['${r.key}'] viết dạng luật không đọc được, không so quyền`);
    else if (!sameAccess(want, r.access)) {
      res.errors.push(`route ${r.key} (${r.file}) mở cho ${show(r.access)} theo @Roles/@AllowStaff nhưng EXPECTED ghi ${show(want)}: sửa một trong hai cho khớp`);
    }
  }
  const all = new Map(routes.map((r) => [r.key, r]));
  for (const k of expected.keys()) {
    if (byKey.has(k)) continue;
    const r = all.get(k);
    res.errors.push(
      r
        ? `EXPECTED của ${MATRIX_SPEC} còn ${k} nhưng route (${r.file}) không còn là route quản trị (không @Roles ADMIN/STAFF, không @AllowStaff, không có /admin): xoá dòng hoặc khai lại quyền`
        : `EXPECTED của ${MATRIX_SPEC} còn ${k} mà không controller nào khai: xoá dòng`,
    );
  }
  res.notes.push(`${byKey.size} route quản trị (${scoped.filter((r) => isAdminPath(r.key.split(' ')[1])).length} có /admin), ${expected.size} dòng trong bảng`);
  return res;
}
