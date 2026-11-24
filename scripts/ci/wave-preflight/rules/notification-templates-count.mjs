// Luật 4: số "+N mới" của nhóm notification_templates mà apps/api/test/integration-race/reference-seed.race-spec.ts chờ khớp với seed.
// Trên DB vừa `migrate deploy`, migration đã chèn sẵn một phần mẫu; seed-reference chỉ tạo các mẫu NOTIFICATION_TEMPLATES (apps/api/prisma/seed.ts)
// mà cả `id` lẫn `code` chưa có (createMany skipDuplicates). Thêm mẫu vào seed mà không có migration chèn thì N tăng 1, và race spec chỉ đỏ
// ở lượt release (w23-04 SUBSCRIPTION_UPCOMING, w24-02 ORDER_PAYMENT_REMINDER). Luật tính N từ SQL của migration, không cần DB.
import { sliceBlock } from '../lib.mjs';

export const id = 'notification-templates-count';
export const title = 'Số mẫu NOTIFICATION_TEMPLATES khớp câu "+N mới" của reference-seed race spec';

export const SEED = 'apps/api/prisma/seed.ts';
export const RACE_SPEC = 'apps/api/test/integration-race/reference-seed.race-spec.ts';
export const MIGRATIONS = 'apps/api/prisma/migrations';

/** `{ id, code }` của từng mẫu trong NOTIFICATION_TEMPLATES, và số dòng `code:` để phát hiện mẫu viết khác dạng. */
export function parseSeedTemplates(text) {
  const block = sliceBlock(text, 'export const NOTIFICATION_TEMPLATES = [', '\n];');
  if (!block) return null;
  const rows = [...block.matchAll(/\{\s*id:\s*'([^']+)',\s*code:\s*'([^']+)'/g)].map((m) => ({ id: m[1], code: m[2] }));
  const codeCount = (block.match(/\bcode:\s*['"`]/g) ?? []).length;
  return { rows, codeCount };
}

/** Các bộ giá trị của một `INSERT … VALUES (…), (…)` bắt đầu từ `from`; dừng ở `;` hoặc từ khoá ngoài ngoặc (ON CONFLICT). */
function valueTuples(sql, from) {
  const tuples = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  let fields = [];
  for (let i = from; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      if (ch === "'" && sql[i + 1] === "'") {
        cur += "'";
        i++;
      } else if (ch === "'") inStr = false;
      else cur += ch;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      continue;
    }
    if (ch === '(') {
      depth++;
      if (depth === 1) {
        cur = '';
        fields = [];
        continue;
      }
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        fields.push(cur.trim());
        tuples.push(fields);
        continue;
      }
    } else if (ch === ',' && depth === 1) {
      fields.push(cur.trim());
      cur = '';
      continue;
    } else if (depth === 0 && (ch === ';' || /[A-Za-z]/.test(ch))) break;
    if (depth >= 1) cur += ch;
  }
  return tuples;
}

/**
 * `id` và `code` mà các migration chèn vào notification_templates. Câu xoá/đổi id/code hoặc INSERT … SELECT không tính tay được nên trả về
 * trong `unsupported` để luật báo đỏ (thà người xem lại còn hơn đếm sai).
 */
export function migrationTemplates(sqlByDir) {
  const ids = new Set();
  const codes = new Set();
  const unsupported = [];
  for (const [dir, raw] of sqlByDir) {
    const sql = stripSqlComments(raw);
    const bare = sql.replace(/'(?:''|[^'])*'/g, "''");
    for (const m of sql.matchAll(/INSERT\s+INTO\s+"?notification_templates"?\s*\(([^)]*)\)\s*(VALUES|SELECT)/gi)) {
      if (m[2].toUpperCase() !== 'VALUES') {
        unsupported.push(`${dir}: INSERT … SELECT vào notification_templates`);
        continue;
      }
      const cols = m[1].split(',').map((c) => c.trim().replace(/"/g, ''));
      const ci = cols.indexOf('code');
      const ii = cols.indexOf('id');
      for (const t of valueTuples(sql, m.index + m[0].length)) {
        if (ii >= 0) ids.add(t[ii]);
        if (ci >= 0) codes.add(t[ci]);
      }
    }
    if (/DELETE\s+FROM\s+"?notification_templates"?/i.test(bare)) unsupported.push(`${dir}: DELETE FROM notification_templates`);
    for (const u of bare.matchAll(/UPDATE\s+"?notification_templates"?\s+SET\s+([\s\S]*?)(?:\bWHERE\b|;|$)/gi)) {
      if (/(?:^|,)\s*"?(?:code|id)"?\s*=/i.test(u[1])) unsupported.push(`${dir}: UPDATE đổi id/code của notification_templates`);
    }
  }
  return { ids, codes, unsupported };
}

/** Bỏ comment `-- …` của SQL, trừ khi `--` nằm trong chuỗi '…' (nội dung mẫu có thể chứa nó). */
export function stripSqlComments(sql) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return out;
}

export function check(ctx) {
  const res = { errors: [], warnings: [], notes: [] };
  const seed = ctx.head.read(SEED);
  const spec = ctx.head.read(RACE_SPEC);
  if (seed == null || spec == null) {
    res.errors.push(`không thấy ${seed == null ? SEED : RACE_SPEC}`);
    return res;
  }
  const parsed = parseSeedTemplates(seed);
  if (!parsed || parsed.rows.length === 0) {
    res.errors.push(`không đọc được NOTIFICATION_TEMPLATES trong ${SEED}`);
    return res;
  }
  if (parsed.rows.length !== parsed.codeCount) {
    res.errors.push(`${SEED}: ${parsed.codeCount} mẫu có \`code:\` nhưng chỉ ${parsed.rows.length} mẫu viết dạng \`{ id: '…', code: '…'\`; viết mẫu mới theo dạng đó để luật đếm được`);
    return res;
  }
  const dupCodes = parsed.rows.map((r) => r.code).filter((c, i, a) => a.indexOf(c) !== i);
  if (dupCodes.length > 0) res.errors.push(`${SEED}: code mẫu trùng ${[...new Set(dupCodes)].join(', ')}`);

  const sqlFiles = ctx.head.list(MIGRATIONS).filter((f) => f.endsWith('/migration.sql')).sort();
  const { ids, codes, unsupported } = migrationTemplates(sqlFiles.map((f) => [f.slice(MIGRATIONS.length + 1).split('/')[0], ctx.head.read(f) ?? '']));
  for (const u of unsupported) res.errors.push(`không tự tính được số mẫu tạo mới (${u}); đếm tay rồi sửa luật hoặc race spec`);
  const fresh = parsed.rows.filter((r) => !ids.has(r.id) && !codes.has(r.code));

  const m = spec.match(/notification_templates: \+(\d+) mới/);
  if (!m) {
    res.errors.push(`${RACE_SPEC} không còn câu chờ "[seed-reference] notification_templates: +N mới" (đổi cách kiểm thì sửa luật này)`);
    return res;
  }
  const expected = Number(m[1]);
  if (unsupported.length === 0 && expected !== fresh.length) {
    res.errors.push(
      `${RACE_SPEC} chờ "notification_templates: +${expected} mới" nhưng DB vừa migrate sẽ tạo ${fresh.length} mẫu ` +
        `(${parsed.rows.length} mẫu seed, ${parsed.rows.length - fresh.length} đã có từ migration): sửa thành +${fresh.length}, ` +
        'hoặc thêm migration chèn mẫu mới nếu mẫu phải có trên PROD ngay khi deploy',
    );
  }
  res.notes.push(`${parsed.rows.length} mẫu seed, ${fresh.length} mẫu tạo mới trên DB vừa migrate, race spec chờ +${expected}`);
  return res;
}
