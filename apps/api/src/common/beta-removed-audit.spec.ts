import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

/**
 * Trang /beta của miniapp bị xoá (PD-1) và 4 route /beta/* của API bị gỡ (PE-2), nên bộ script audit/uiux
 * không được còn mô tả trang đó, seed dữ liệu chỉ phục vụ nó, hay chấm điểm một trang không còn tồn tại.
 * Bảng `beta_testers`/`beta_feedbacks` vẫn còn (không DROP), vì vậy phần dọn dòng cũ của audit user được giữ.
 *
 * Spec đọc file NGOÀI package apps/api (scripts/audit, scripts/uiux ở gốc repo), nên turbo.json phải khai hai thư mục đó
 * là đầu vào của task test cho apps/api; nếu không, sửa script không làm hỏng cache và spec bị bỏ qua ở CI.
 */

const REPO = join(__dirname, '../../../..');
const AUDIT_DIR = join(REPO, 'scripts/audit');
const UIUX_DIR = join(REPO, 'scripts/uiux');

/**
 * Thư mục sinh ra khi chạy script, nằm ngoài git (results, .probe) hoặc là bản sinh ra (generated): có thể chứa tên trang
 * cũ trong ảnh chụp, log, danh sách endpoint chụp lúc trước nên không phải nguồn của script. Quét chúng làm spec đỏ
 * trên máy từng chạy audit mà xanh trên bản checkout sạch.
 */
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

/** Seed gọi prisma.betaTester/betaFeedback ghi dữ liệu; chạy trên cả nội dung file nên gọi tách dòng (prisma\n.betaTester\n.create) cũng bị bắt. */
const BETA_SEED_CALL = /prisma\s*\.\s*beta(Tester|Feedback)\s*\.\s*(create|createMany|upsert)\b/;
const BETA_FEATURES_KEY = /['"`]beta\.features['"`]/;
/** Khoá `beta: [` của bảng chấm điểm, có hay không có nháy quanh khoá. */
const BETA_SCORECARD_KEY = /^\s*['"]?beta['"]?\s*:\s*\[/m;

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
    const content = readFileSync(join(AUDIT_DIR, 'seed-audit-personas.ts'), 'utf-8');
    expect(BETA_SEED_CALL.test(content)).toBe(false);
    expect(BETA_FEATURES_KEY.test(content)).toBe(false);
  });

  it('bảng chấm điểm uiux không còn dòng của trang beta', () => {
    expect(BETA_SCORECARD_KEY.test(readFileSync(join(UIUX_DIR, 'scorecard.mjs'), 'utf-8'))).toBe(false);
  });
});

describe('bộ quét beta bắt đúng các dạng viết (test của chính spec)', () => {
  it('bắt lời gọi seed viết thường, tách dòng, có khoảng trắng quanh dấu chấm', () => {
    for (const src of [
      'await prisma.betaTester.create({ data })',
      'await prisma.betaFeedback.createMany({ data })',
      'await prisma.betaTester.upsert({ where })',
      'await prisma\n  .betaTester\n  .create({ data })',
      'await prisma . betaFeedback . create ( { data } )',
      'await prisma.\n    betaTester.\n    upsert({})',
    ]) {
      expect(BETA_SEED_CALL.test(src)).toBe(true);
    }
  });

  it('không bắt phần dọn dòng cũ của audit user (deleteMany) và các bảng khác', () => {
    for (const src of [
      'await prisma.betaTester.deleteMany({ where: { userId } })',
      'await prisma.betaFeedback.deleteMany({})',
      'await prisma.user.create({ data })',
      'await prisma.betaTesterCount.create({})',
    ]) {
      expect(BETA_SEED_CALL.test(src)).toBe(false);
    }
  });

  it('bắt khoá scorecard có nháy đơn, nháy kép hoặc không nháy, thụt lề tuỳ ý, không phụ thuộc dòng đầu file', () => {
    for (const src of ["  beta: [", "  'beta': [", '  "beta" : [', "\tbeta:[", "export default {\n  home: [],\n  'beta': [\n    1,\n  ],\n}"]) {
      expect(BETA_SCORECARD_KEY.test(src)).toBe(true);
    }
  });

  it('không bắt khoá khác có chữ beta hay mảng không phải khoá', () => {
    for (const src of ['  betaFeatures: [', "  'beta-x': [", '  beta_list: [', '  home: [ "beta" ]', '  // beta: [']) {
      expect(BETA_SCORECARD_KEY.test(src)).toBe(false);
    }
  });

  it('khoá cấu hình beta.features bắt đủ ba loại nháy', () => {
    for (const src of ["'beta.features'", '"beta.features"', '`beta.features`']) expect(BETA_FEATURES_KEY.test(src)).toBe(true);
  });
});

describe('thư mục sinh ra bị bỏ qua khi quét (PF-3)', () => {
  // Quét thư mục thật không chứng minh được gì: results/.probe không có trên bản checkout sạch nên danh sách file rỗng các
  // thư mục đó dù walk có bỏ qua hay không. Dựng thư mục tạm có đủ các thư mục sinh ra, file nào cũng nhắc /beta.
  let root: string;
  const put = (name: string) => {
    mkdirSync(join(root, dirname(name)), { recursive: true });
    writeFileSync(join(root, name), "await page.goto('/beta');\n");
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'beta-audit-walk-'));
    for (const name of [
      'keep.mjs',
      'nested/deep/keep.json',
      'results/run.json',
      '.probe/shot.txt',
      'generated/endpoints.ts',
      'node_modules/pkg/index.js',
      'nested/results/run.json',
      'nested/deep/.probe/log.txt',
      'nested/generated/api.ts',
      'nested/node_modules/pkg/index.js',
    ]) {
      put(name);
    }
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const scanned = (skipped?: ReadonlySet<string>) =>
    walk(root, [], skipped)
      .map((f) => relative(root, f))
      .sort();

  it('walk bỏ results, .probe, generated, node_modules ở mọi cấp và vẫn đọc file nguồn', () => {
    expect(scanned()).toEqual(['keep.mjs', 'nested/deep/keep.json']);
  });

  it('SKIPPED_DIRS đúng là bốn thư mục đó (bỏ bớt một tên thì walk quét lại thư mục sinh ra)', () => {
    expect([...SKIPPED_DIRS].sort()).toEqual(['.probe', 'generated', 'node_modules', 'results']);
    expect(scanned(new Set(['node_modules', '.probe', 'generated'])).some((f) => f.startsWith('results/'))).toBe(true);
    expect(scanned(new Set()).length).toBe(10);
  });

  it('file trong thư mục sinh ra có nhắc /beta thì không bị tính là vi phạm của script', () => {
    const offenders = walk(root).filter((f) => /['"`]\/beta(?![\w-])/.test(readFileSync(f, 'utf-8')));
    expect(offenders.map((f) => relative(root, f)).sort()).toEqual(['keep.mjs', 'nested/deep/keep.json']);
  });
});

/**
 * Turbo chỉ băm file trong package của task; scripts/audit và scripts/uiux nằm ngoài apps/api nên phải khai bằng
 * $TURBO_ROOT$. Task riêng cho @tubutree/api thay HẲN định nghĩa test chung, nên phải giữ nguyên dependsOn và outputs.
 */
describe('turbo.json băm scripts/audit và scripts/uiux cho test của apps/api (PF-3)', () => {
  type TaskDef = { dependsOn?: string[]; outputs?: string[]; inputs?: string[] };
  const turbo = JSON.parse(readFileSync(join(REPO, 'turbo.json'), 'utf-8')) as { tasks: Record<string, TaskDef> };
  const apiTest = turbo.tasks['@tubutree/api#test'];

  it('có task test riêng cho @tubutree/api', () => {
    expect(apiTest).toBeDefined();
  });

  it('inputs giữ file mặc định của package và thêm hai thư mục script ngoài package', () => {
    expect(apiTest?.inputs).toEqual(['$TURBO_DEFAULT$', '$TURBO_ROOT$/scripts/audit/**', '$TURBO_ROOT$/scripts/uiux/**', '$TURBO_ROOT$/docs/**', '$TURBO_ROOT$/README.md']);
  });

  it('không làm mất dependsOn và outputs của task test chung', () => {
    expect(apiTest?.dependsOn).toEqual(turbo.tasks.test?.dependsOn);
    expect(apiTest?.outputs).toEqual(turbo.tasks.test?.outputs);
  });

  it('hai thư mục khai trong inputs có thật và đúng là nơi spec đọc', () => {
    expect(statSync(AUDIT_DIR).isDirectory()).toBe(true);
    expect(statSync(UIUX_DIR).isDirectory()).toBe(true);
  });
});
