import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Trang /beta của miniapp bị xoá (PD-1) và 4 route /beta/* của API bị gỡ (PE-2), nên bộ script audit/uiux
 * không được còn mô tả trang đó, seed dữ liệu chỉ phục vụ nó, hay chấm điểm một trang không còn tồn tại.
 * Bảng `beta_testers`/`beta_feedbacks` vẫn còn (không DROP), vì vậy phần dọn dòng cũ của audit user được giữ.
 */

const REPO = join(__dirname, '../../../..');
const AUDIT_DIR = join(REPO, 'scripts/audit');
const UIUX_DIR = join(REPO, 'scripts/uiux');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = [...walk(AUDIT_DIR), ...walk(UIUX_DIR)];
const rel = (p: string): string => relative(REPO, p);

describe('script audit/uiux không còn dấu vết trang /beta (PE-4)', () => {
  it('quét đủ file (dò đúng, không rỗng)', () => {
    const names = files.map(rel);
    expect(names).toContain('scripts/audit/routes.json');
    expect(names).toContain('scripts/audit/seed-audit-personas.ts');
    expect(names).toContain('scripts/uiux/scorecard.mjs');
  });

  it('không file nào nhắc đường dẫn /beta (mẫu route, ví dụ, điều hướng)', () => {
    const offenders = files.filter((f) => /['"`]\/beta(?![\w-])/.test(readFileSync(f, 'utf-8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('routes.json không còn mẫu miniapp nào là /beta', () => {
    const doc = JSON.parse(readFileSync(join(AUDIT_DIR, 'routes.json'), 'utf-8')) as { miniapp: { pattern: string }[] };
    expect(doc.miniapp.length).toBeGreaterThan(30);
    expect(doc.miniapp.map((r) => r.pattern)).not.toContain('/beta');
  });

  it('seed audit không còn gieo dòng beta hay khoá cấu hình beta.features', () => {
    const lines = readFileSync(join(AUDIT_DIR, 'seed-audit-personas.ts'), 'utf-8').split('\n');
    const seeded = lines.filter((l) => /prisma\.beta(Tester|Feedback)\.(create|createMany|upsert)\b|['"`]beta\.features['"`]/.test(l));
    expect(seeded).toEqual([]);
  });

  it('bảng chấm điểm uiux không còn dòng của trang beta', () => {
    const lines = readFileSync(join(UIUX_DIR, 'scorecard.mjs'), 'utf-8').split('\n');
    expect(lines.filter((l) => /^\s*beta:\s*\[/.test(l))).toEqual([]);
  });
});
