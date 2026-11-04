/** Một vi phạm CSP đã rút gọn: chỉ giữ thứ đủ để biết nguồn nào bị chặn, không giữ query, fragment hay thân báo cáo thô. */
export interface CspViolation {
  directive: string;
  blocked: string;
  document: string;
}

export const MAX_VIOLATIONS_PER_REPORT = 10;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Bỏ ký tự điều khiển/không in được (chống chèn dòng log giả) và cắt độ dài. */
function clean(v: string, max: number): string {
  return v.replace(/[^\x20-\x7e]/g, '?').slice(0, max);
}

/** "inline", "eval", "data"... không phải URL: giữ nguyên từ khoá; URL thì chỉ origin + path. */
function blockedLabel(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'ws:' || u.protocol === 'wss:') return clean(u.origin + u.pathname, 200);
    return clean(u.protocol, 20);
  } catch {
    return clean(raw, 40);
  }
}

function documentPath(raw: string): string {
  try {
    return clean(new URL(raw).pathname, 120);
  } catch {
    return '';
  }
}

function fromLegacy(report: unknown): CspViolation | null {
  if (!report || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  const directive = str(r['effective-directive']) || str(r['violated-directive']);
  if (!directive) return null;
  return { directive: clean(directive, 60), blocked: blockedLabel(str(r['blocked-uri'])), document: documentPath(str(r['document-uri'])) };
}

function fromReportingApi(entry: unknown): CspViolation | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as { type?: unknown; body?: unknown };
  if (e.type !== 'csp-violation' || !e.body || typeof e.body !== 'object') return null;
  const b = e.body as Record<string, unknown>;
  const directive = str(b['effectiveDirective']) || str(b['violatedDirective']);
  if (!directive) return null;
  return { directive: clean(directive, 60), blocked: blockedLabel(str(b['blockedURL'])), document: documentPath(str(b['documentURL'])) };
}

/** Thân `application/csp-report` ({ "csp-report": {...} }) hoặc `application/reports+json` ([{ type, body }]). Sai dạng thì trả mảng rỗng. */
export function normalizeCspReports(body: unknown): CspViolation[] {
  const found: Array<CspViolation | null> = Array.isArray(body)
    ? body.slice(0, MAX_VIOLATIONS_PER_REPORT).map(fromReportingApi)
    : body && typeof body === 'object'
      ? [fromLegacy((body as Record<string, unknown>)['csp-report'])]
      : [];
  return found.filter((v): v is CspViolation => v !== null);
}

export const CSP_LOG_WINDOW_MS = 60_000;
export const CSP_LOG_MAX_LINES_PER_WINDOW = 30;
const MAX_TRACKED_KEYS = 500;

/**
 * Chống ngập log: cùng (directive, blocked, document) chỉ ghi một dòng mỗi cửa sổ 60 giây, và tổng không quá 30 dòng mỗi cửa sổ.
 * Phần bị bỏ được cộng vào dòng tóm tắt ở cửa sổ kế (một dòng, không theo khoá).
 */
export class CspLogGate {
  private windowStart = 0;
  private lines = 0;
  private suppressed = 0;
  private seen = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  /** `summary` là số báo cáo đã bị lược ở cửa sổ trước (0 nếu không có); `log` cho biết có ghi dòng này không. */
  admit(v: CspViolation): { log: boolean; summary: number } {
    const t = this.now();
    let summary = 0;
    if (t - this.windowStart >= CSP_LOG_WINDOW_MS) {
      summary = this.suppressed;
      this.windowStart = t;
      this.lines = 0;
      this.suppressed = 0;
      this.seen = new Set();
    }
    const key = `${v.directive}|${v.blocked}|${v.document}`;
    if (this.seen.has(key) || this.lines >= CSP_LOG_MAX_LINES_PER_WINDOW || this.seen.size >= MAX_TRACKED_KEYS) {
      this.suppressed += 1;
      return { log: false, summary };
    }
    this.seen.add(key);
    this.lines += 1;
    return { log: true, summary };
  }
}
