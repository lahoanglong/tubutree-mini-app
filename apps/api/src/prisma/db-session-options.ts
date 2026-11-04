/**
 * Hạn chờ Postgres chỉ gắn vào kết nối của tiến trình API, không vào DATABASE_URL: `prisma migrate deploy` và các script
 * dùng chung DATABASE_URL trong compose, nên hạn 30 giây trong URL sẽ cắt migration nặng giữa chừng (P3009).
 */
export const DB_SESSION_OPTION_NAMES = ['statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout'] as const;
export type DbSessionOptionName = (typeof DB_SESSION_OPTION_NAMES)[number];

const VALUE_RE = /^\d+(ms|s|min)?$/;

export type ParsedDbSessionOptions = { ok: true; settings: Partial<Record<DbSessionOptionName, string>> } | { ok: false; errors: string[] };

export function parseDbSessionOptions(raw: string): ParsedDbSessionOptions {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const errors: string[] = [];
  const settings: Partial<Record<DbSessionOptionName, string>> = {};
  for (let i = 0; i < tokens.length; ) {
    if (tokens[i] !== '-c') {
      errors.push(`"${tokens[i]}" không đúng dạng: mỗi hạn chờ viết thành "-c <tên>=<giá trị>", ví dụ -c statement_timeout=30s.`);
      i += 1;
      continue;
    }
    const pair = tokens[i + 1];
    i += 2;
    if (pair === undefined) {
      errors.push('Sau "-c" thiếu "<tên>=<giá trị>".');
      continue;
    }
    const eq = pair.indexOf('=');
    const name = eq < 0 ? pair : pair.slice(0, eq);
    const value = eq < 0 ? '' : pair.slice(eq + 1);
    if (!(DB_SESSION_OPTION_NAMES as readonly string[]).includes(name)) {
      errors.push(`"${name}" không được phép; chỉ nhận ${DB_SESSION_OPTION_NAMES.join(', ')}.`);
      continue;
    }
    if (!VALUE_RE.test(value)) {
      errors.push(`${name}="${value}" sai: giá trị là số kèm đơn vị ms, s hoặc min (hoặc số trần tính bằng mili giây), ví dụ 30s.`);
      continue;
    }
    if (name in settings) {
      errors.push(`${name} bị khai báo hai lần.`);
      continue;
    }
    settings[name as DbSessionOptionName] = value;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, settings };
}

export function urlHasOptionsParam(databaseUrl: string): boolean {
  const q = databaseUrl.indexOf('?');
  return q >= 0 && /(^|&)options=/.test(databaseUrl.slice(q + 1));
}

/** Lỗi cấu hình cho DB_SESSION_OPTIONS (rỗng nghĩa là hợp lệ hoặc không đặt). */
export function dbSessionOptionsIssues(databaseUrl: string | undefined, raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  const parsed = parseDbSessionOptions(raw);
  const issues = parsed.ok ? [] : parsed.errors.map((e) => `DB_SESSION_OPTIONS: ${e}`);
  if (databaseUrl && urlHasOptionsParam(databaseUrl)) {
    issues.push('DB_SESSION_OPTIONS đã đặt mà DATABASE_URL cũng có tham số options=: bỏ một trong hai (hạn chờ chỉ nên đặt qua DB_SESSION_OPTIONS để migrate không bị cắt).');
  }
  return issues;
}

/** undefined = không có gì để đè, PrismaClient cứ đọc DATABASE_URL. Không sửa process.env. */
export function buildDatasourceUrl(databaseUrl: string | undefined, raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '' || !databaseUrl) return undefined;
  const issues = dbSessionOptionsIssues(databaseUrl, raw);
  if (issues.length > 0) throw new Error(issues.join(' '));
  return `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}options=${encodeURIComponent(raw.trim().split(/\s+/).join(' '))}`;
}

const UNIT_MS: Record<string, number> = { us: 0.001, ms: 1, s: 1_000, min: 60_000, h: 3_600_000, d: 86_400_000 };

/** Đổi giá trị Postgres in ra (30s, 2min, 1h, 0) hoặc giá trị khai báo sang mili giây; NaN nếu không hiểu. */
export function pgDurationToMs(v: string): number {
  const m = /^(\d+)(us|ms|s|min|h|d)?$/.exec(v.trim());
  if (!m) return NaN;
  return Number(m[1]) * (m[2] ? (UNIT_MS[m[2]] ?? NaN) : 1);
}
