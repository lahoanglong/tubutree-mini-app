// Luật 2: mỗi tên trong HEAVY_MIGRATIONS (apps/api/src/config/go-live/db-checks.ts) có trong bảng mục 1.0 của runbook deploy, và mục 3.1/3.2 dùng
// đúng số migration nặng khoá `orders`. Đây là bản tĩnh của khối "bảng 1.0 và ví dụ cửa sổ khớp HEAVY_MIGRATIONS" trong
// apps/api/src/config/deploy-scripts.spec.ts (w24-01 thêm chỉ mục orders vào danh sách nhưng không sửa runbook, chỉ lộ ở lượt release).
// Thêm: migration mới của wave có câu SQL dễ khoá bảng mà chưa nằm trong danh sách thì nhắc (không đỏ: nặng hay không cần người xét).
import { quotedStrings, sliceBlock } from '../lib.mjs';

export const id = 'heavy-migrations-runbook';
export const title = 'HEAVY_MIGRATIONS có trong runbook deploy mục 1.0, 3.1, 3.2';

export const DB_CHECKS = 'apps/api/src/config/go-live/db-checks.ts';
export const RUNBOOK = 'docs/launch/deploy-rollback-runbook.md';
const MIGRATIONS = 'apps/api/prisma/migrations/';

/** `const X = '…'` và `const X = ARR[n]` (ARR là mảng chuỗi) trong cùng tệp, để đọc `{ name: ORDERS_LOCK_MIGRATION }`. */
function constStrings(text) {
  const out = new Map();
  for (const m of text.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*(['"`])([^'"`]*)\2\s*;/g)) out.set(m[1], m[3]);
  const arrays = new Map();
  for (const m of text.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]\s*(?:as const)?\s*;/g)) arrays.set(m[1], quotedStrings(m[2]));
  for (const m of text.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(\w+)\[(\d+)\]\s*;/g)) {
    const v = arrays.get(m[2])?.[Number(m[3])];
    if (v !== undefined) out.set(m[1], v);
  }
  return out;
}

/**
 * Các mục `{ name, ordersLock }` của HEAVY_MIGRATIONS, viết một dòng hay xuống dòng, thêm trường khác hay không. Mục không đọc được (tên là
 * hằng lạ, thiếu `ordersLock`) ghi vào `unresolved` để luật báo đỏ thay vì đếm sai số migration khoá orders.
 */
export function parseHeavyMigrations(text) {
  const block = sliceBlock(text, 'export const HEAVY_MIGRATIONS', '\n];');
  if (!block) return null;
  const body = block.slice(block.indexOf('= [') + 3).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const consts = constStrings(text);
  const entries = [];
  const unresolved = [];
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
    const nm = /\bname\s*:\s*(?:(['"`])([^'"`]+)\1|(\w+))/.exec(m[1]);
    const lock = /\bordersLock\s*:\s*(true|false)\b/.exec(m[1]);
    const name = nm ? (nm[2] ?? consts.get(nm[3])) : undefined;
    if (name === undefined || !lock) unresolved.push(m[1].trim().replace(/\s+/g, ' '));
    else entries.push({ name, ordersLock: lock[1] === 'true' });
  }
  const declared = (body.match(/\bname\s*:/g) ?? []).length;
  if (declared !== entries.length + unresolved.length) unresolved.push(`${declared} mục có \`name:\` nhưng chỉ tách được ${entries.length + unresolved.length} khối { … }`);
  return { entries, unresolved };
}

/** Đoạn của một mục `### x.y ` tới mục `### ` kế tiếp (cùng cách cắt với deploy-scripts.spec.ts). */
export function runbookSection(runbook, heading) {
  const start = runbook.indexOf(heading);
  if (start < 0) return null;
  const end = runbook.indexOf('\n### ', start + 1);
  return runbook.slice(start, end < 0 ? undefined : end);
}

// Câu SQL thường khoá bảng lâu: dựng chỉ mục không CONCURRENTLY, UPDATE/DELETE hàng loạt, đổi kiểu cột.
const RISKY_SQL = [
  /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)/i,
  /(?:^|\n)\s*UPDATE\s+"?\w+"?\s+(?:AS\s+\w+\s+)?SET\b/i,
  /(?:^|\n)\s*DELETE\s+FROM\b/i,
  /ALTER\s+COLUMN\s+"?\w+"?\s+(?:SET\s+DATA\s+)?TYPE\b/i,
];

export function check(ctx) {
  const res = { errors: [], warnings: [], notes: [] };
  const src = ctx.head.read(DB_CHECKS);
  const runbook = ctx.head.read(RUNBOOK);
  if (src == null || runbook == null) {
    res.errors.push(`không thấy ${src == null ? DB_CHECKS : RUNBOOK}`);
    return res;
  }
  const parsed = parseHeavyMigrations(src);
  if (!parsed || parsed.entries.length === 0) {
    res.errors.push(`không đọc được HEAVY_MIGRATIONS trong ${DB_CHECKS} (đổi cách khai thì sửa luật này)`);
    return res;
  }
  for (const u of parsed.unresolved) res.errors.push(`HEAVY_MIGRATIONS có mục luật không đọc được (${u}); khai \`name: '<tên>'\` và \`ordersLock: true|false\` trực tiếp hoặc sửa luật`);

  const table = runbookSection(runbook, '### 1.0 ');
  const s31 = runbookSection(runbook, '### 3.1 ');
  const s32 = runbookSection(runbook, '### 3.2 ');
  if (!table || !s31 || !s32) {
    res.errors.push(`${RUNBOOK} thiếu mục ${!table ? '1.0' : !s31 ? '3.1' : '3.2'}`);
    return res;
  }
  for (const { name, ordersLock } of parsed.entries) {
    if (!table.includes(name)) {
      res.errors.push(
        `${name} nằm trong HEAVY_MIGRATIONS nhưng bảng mục 1.0 của ${RUNBOOK} chưa có dòng \`| \`${name}\` | …\` ` +
          `(${ordersLock ? 'khoá orders: tính vào cửa sổ và db.orders_lock' : 'không khoá orders'}; thêm câu đếm để ước thời gian)`,
      );
    }
  }
  const n = parsed.entries.filter((e) => e.ordersLock).length;
  if (!s31.includes(`tối đa ${n}`)) res.errors.push(`mục 3.1 của ${RUNBOOK} phải ghi "tối đa ${n}" migration nặng trên orders (HEAVY_MIGRATIONS có ${n} dòng ordersLock: true)`);
  if (!s32.includes(`${n} × 10 giây = ${n * 10} giây`)) res.errors.push(`ví dụ mục 3.2 của ${RUNBOOK} phải là "${n} × 10 giây = ${n * 10} giây"`);

  if (ctx.changed) {
    const listed = new Set(parsed.entries.map((e) => e.name));
    const fresh = [...new Set(ctx.changed.filter((f) => f.startsWith(MIGRATIONS) && f.endsWith('/migration.sql')).map((f) => f.slice(MIGRATIONS.length).split('/')[0]))];
    for (const dir of fresh) {
      if (listed.has(dir)) continue;
      const sql = (ctx.head.read(`${MIGRATIONS}${dir}/migration.sql`) ?? '').replace(/--[^\n]*/g, '');
      const hit = RISKY_SQL.find((re) => re.test(sql));
      if (hit) {
        res.warnings.push(
          `migration mới ${dir} có câu có thể khoá bảng lâu (${sql.match(hit)[0].trim().replace(/\s+/g, ' ')}…) nhưng chưa nằm trong HEAVY_MIGRATIONS; ` +
            'nếu chạm bảng lớn (orders, users, products…) thì thêm vào danh sách và runbook mục 1.0/3.1/3.2',
        );
      }
    }
  }
  res.notes.push(`${parsed.entries.length} migration nặng, ${n} khoá orders`);
  return res;
}
