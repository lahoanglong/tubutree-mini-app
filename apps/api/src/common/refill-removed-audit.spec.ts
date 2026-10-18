import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Trang /refill của miniapp bị gỡ (spec 13.2), nên bộ script audit/uiux không còn mô tả trang đó,
 * seed dữ liệu chỉ phục vụ nó, hay chấm điểm một trang không còn tồn tại.
 * Spec đọc file NGOÀI package apps/api (scripts/audit, scripts/uiux ở gốc repo).
 */

const REPO = join(__dirname, '../../../..');
const AUDIT_DIR = join(REPO, 'scripts/audit');
const UIUX_DIR = join(REPO, 'scripts/uiux');

const SKIPPED_DIRS = new Set(['node_modules', 'results', '.probe', 'generated']);

function walk(dir: string, out: string[] = [], skipped: ReadonlySet<string> = SKIPPED_DIRS): string[] {
  for (const name of readdirSync(dir)) {
    if (skipped.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out, skipped);
    else out.push(p);
  }
  return out;
}

const files = [...walk(AUDIT_DIR), ...walk(UIUX_DIR)];
const rel = (p: string): string => relative(REPO, p);

const NEW_PATTERNS = ['/recycle', '/recycle/rules', '/recycle/new', '/recycle/points', '/recycle/requests', '/rewards', '/rewards/mine', '/recycle/desk'];

describe('script audit/uiux không còn dấu vết Refill (spec 13.2)', () => {
  it('không file nào nhắc đường dẫn /refill', () => {
    const offenders = files.filter((f) => /['"`]\/refill(?![\w-])/.test(readFileSync(f, 'utf-8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('seed audit không còn gieo bottleReturn, promo fuwa-refill hay huy hiệu REFILL_HERO', () => {
    const content = readFileSync(join(AUDIT_DIR, 'seed-audit-personas.ts'), 'utf-8');
    expect(/prisma\s*\.\s*bottleReturn\s*\./.test(content)).toBe(false);
    expect(content).not.toContain('fuwa-refill');
    expect(content).not.toContain('REFILL_HERO');
  });

  it('routes.json có trang Đổi rác và Kho quà, không còn /refill', () => {
    const doc = JSON.parse(readFileSync(join(AUDIT_DIR, 'routes.json'), 'utf-8')) as { miniapp: { pattern: string; personas: string[]; examples: string[] }[] };
    const patterns = doc.miniapp.map((r) => r.pattern);
    expect(patterns).not.toContain('/refill');
    for (const p of NEW_PATTERNS) expect(patterns).toContain(p);
    expect(doc.miniapp.find((r) => r.pattern === '/recycle/desk')?.personas).toEqual(['staff', 'admin']);
    expect(doc.miniapp.find((r) => r.pattern === '/rewards')?.examples).toEqual(['/rewards']);
  });

  it('buildRoutes của seed audit có cùng các trang mới', () => {
    const content = readFileSync(join(AUDIT_DIR, 'seed-audit-personas.ts'), 'utf-8');
    for (const p of NEW_PATTERNS) expect(content).toContain(`{ pattern: '${p}', `);
  });

  it('routes.mjs của bộ chụp có mọi trang mới, scorecard không còn dòng refill', () => {
    const routes = readFileSync(join(UIUX_DIR, 'routes.mjs'), 'utf-8');
    for (const p of ["'/recycle'", "'/recycle/new'", "'/recycle/points'", "'/recycle/requests'", "'/recycle/rules'", "'/recycle/desk'", "'/rewards'", "'/rewards/mine'"]) expect(routes).toContain(p);
    expect(/^\s*['"]?refill['"]?\s*:\s*\[/m.test(readFileSync(join(UIUX_DIR, 'scorecard.mjs'), 'utf-8'))).toBe(false);
  });

  it('hai danh sách endpoint sinh ra không còn Refill', () => {
    for (const f of ['generated/miniapp-endpoints.json', 'generated/web-endpoints.json']) {
      expect(readFileSync(join(UIUX_DIR, f), 'utf-8')).not.toMatch(/refill/i);
    }
    expect(readFileSync(join(UIUX_DIR, 'generated/miniapp-endpoints.json'), 'utf-8')).toContain('waste-api.ts');
  });
});
