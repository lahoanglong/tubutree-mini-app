// Luật 6: mọi route có đoạn `admin` trong đường dẫn (/admin/*, /feed/admin/*, /refill/admin/*…) có dòng trong EXPECTED của
// apps/api/src/common/staff-permissions.matrix.spec.ts, và bảng không giữ route quản trị đã xoá. Spec jest dựng cả AppModule để đọc metadata;
// luật này đọc decorator `@Controller(...)` + `@Get/@Post/...(...)` bằng regex (mọi controller hiện khai đường dẫn bằng chuỗi trực tiếp) nên
// chạy trong vài chục mili giây. Đường dẫn không phải chuỗi trực tiếp thì báo đỏ thay vì bỏ sót.
import { quotedStrings, sliceBlock } from '../lib.mjs';

export const id = 'admin-staff-matrix';
export const title = 'Mọi route /admin có trong bảng quyền staff-permissions.matrix.spec.ts';

export const API_SRC = 'apps/api/src';
export const MATRIX_SPEC = 'apps/api/src/common/staff-permissions.matrix.spec.ts';

const METHOD_RE = /@(Get|Post|Put|Patch|Delete|All|Head|Options)\(([^)]*)\)/g;
const joinPath = (a, b) => `/${[a, b].filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
export const isAdminPath = (path) => /(^|\/)admin(\/|$)/.test(path);

/** Đường dẫn khai trong đối số decorator: chuỗi, mảng chuỗi, hoặc `{ path: … }`. `null` khi không đọc được. */
function decoratorPaths(args) {
  const a = args.trim();
  if (a === '') return [''];
  const obj = /^\{[\s\S]*\}$/.test(a);
  const src = obj ? (/\bpath\s*:\s*(\[[^\]]*\]|(['"`])[^'"`]*\2)/.exec(a)?.[1] ?? null) : a;
  if (src === null) return obj ? [''] : null;
  if (!/^(\[\s*)?(['"`])/.test(src.trim())) return null;
  return quotedStrings(src);
}

/** Các route `METHOD /đường/dẫn` của mọi controller, và chỗ luật không đọc được. */
export function controllerRoutes(files) {
  const routes = [];
  const problems = [];
  for (const [rel, s] of files) {
    if (s == null || !s.includes('@Controller(')) continue;
    const ctrls = [...s.matchAll(/@Controller\(([^)]*)\)/g)];
    ctrls.forEach((c, i) => {
      const body = s.slice(c.index, i + 1 < ctrls.length ? ctrls[i + 1].index : s.length);
      const prefixes = decoratorPaths(c[1]);
      if (!prefixes) {
        problems.push(`${rel}: @Controller(${c[1].trim()}) không phải chuỗi trực tiếp, luật không đọc được đường dẫn`);
        return;
      }
      for (const m of body.matchAll(METHOD_RE)) {
        const paths = decoratorPaths(m[2]);
        if (!paths) {
          problems.push(`${rel}: @${m[1]}(${m[2].trim()}) không phải chuỗi trực tiếp, luật không đọc được đường dẫn`);
          continue;
        }
        for (const p of prefixes) for (const q of paths) routes.push({ key: `${m[1].toUpperCase()} ${joinPath(p, q)}`, file: rel });
      }
    });
  }
  return { routes, problems };
}

/** Khoá `METHOD /path` của EXPECTED trong spec bảng quyền. */
export function matrixKeys(text) {
  const block = sliceBlock(text, 'const EXPECTED', '\n};');
  if (!block) return null;
  return new Set([...block.matchAll(/^\s*(['"])([A-Z]+ \/[^'"]*)\1\s*:/gm)].map((m) => m[2]));
}

export function check(ctx) {
  const res = { errors: [], warnings: [], notes: [] };
  const spec = ctx.head.read(MATRIX_SPEC);
  const keys = spec == null ? null : matrixKeys(spec);
  if (!keys || keys.size === 0) {
    res.errors.push(`không đọc được bảng EXPECTED trong ${MATRIX_SPEC}`);
    return res;
  }
  const sources = ctx.head.list(API_SRC).filter((f) => f.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(f));
  const { routes, problems } = controllerRoutes(sources.map((f) => [f, ctx.head.read(f)]));
  res.errors.push(...problems);
  const admin = routes.filter((r) => isAdminPath(r.key.split(' ')[1]));
  for (const r of admin) {
    if (!keys.has(r.key)) {
      res.errors.push(
        `route quản trị ${r.key} (${r.file}) chưa có trong EXPECTED của ${MATRIX_SPEC}: thêm \`'${r.key}': ADMIN_ONLY\` ` +
          '(hoặc nhóm việc [CSKH/KHO/MARKETING/KE_TOAN] đúng với @AllowStaff)',
      );
    }
  }
  const live = new Set(routes.map((r) => r.key));
  for (const k of keys) {
    if (isAdminPath(k.split(' ')[1]) && !live.has(k)) res.errors.push(`EXPECTED của ${MATRIX_SPEC} còn route quản trị ${k} mà không controller nào khai: xoá dòng`);
  }
  res.notes.push(`${admin.length} route quản trị, ${keys.size} dòng trong bảng`);
  return res;
}
