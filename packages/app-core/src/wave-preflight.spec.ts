import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  buildContext,
  changedFiles,
  extractGetCalls,
  gitTree,
  main,
  memTree,
  mockCovers,
  mockedGetPaths,
  runPreflight,
  stripSqlComments,
  type PreflightContext,
} from '../../../scripts/ci/wave-preflight/index.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Ngữ cảnh giả: `head` là cây hiện tại, `base` là cây ở gốc wave, `changed` là danh sách tệp đổi. */
function fakeCtx(head: Record<string, string>, opts: { base?: Record<string, string>; changed?: string[] } = {}): PreflightContext {
  return { root: '/fake', head: memTree(head), base: memTree(opts.base ?? head), changed: opts.changed ?? [] };
}

async function run(id: string, ctx: PreflightContext) {
  const [r] = await runPreflight(ctx, { only: [id] });
  return r!;
}

describe('luật 1 mock-api-fallback: đọc đường dẫn GET từ mã client', () => {
  const paths = (src: string) => [...new Set(extractGetCalls(ts, src, 'x.ts').map((c) => c.path))].sort();

  it.each([
    ["http.get('/a/' + id + '/b')", ['/a/:param/b']],
    ["apiFetch(fresh ? '/x?fresh=1' : '/y')", ['/x', '/y']],
    ["const BASE = '/admin/s';\nexport const f = () => apiFetch(BASE);\nexport const g = () => apiFetch(`${BASE}/zero`);", ['/admin/s', '/admin/s/zero']],
    ["apiFetch('/p', { method: 'PUT', body })", []],
    ["apiFetch('/q', { method: m })", []],
    ["apiFetch('/r', { cache: 'no-store' })", ['/r']],
    ["searchParams.get('/not-http')", []],
    ["this.http.get<T>('/svc')", ['/svc']],
    ['http.get(`/products/${slug}/bundles`)', ['/products/:param/bundles']],
    ['http.get(`/orders${qs}`)', ['/orders']],
    ['http.get(`/v/${a}-${b}`)', ['/v/:param']],
    ["coreHttp.get(path ?? '/fallback')", ['/fallback']],
  ])('%s', (src, want) => {
    expect(paths(src)).toEqual(want);
  });

  it('mẫu của mock: `:tên` khớp mọi đoạn, đoạn cố định phải bằng nhau, số đoạn phải bằng nhau', () => {
    const mocks = mockedGetPaths("api.fallback('GET', '/products/:slug/bundles', {});\napi.allowUnmocked('GET /home', 'GET /checkout/shipping-estimate');");
    expect([...mocks].sort()).toEqual(['/checkout/shipping-estimate', '/home', '/products/:param/bundles']);
    expect(mockCovers('/products/:param/bundles', '/products/:param/bundles')).toBe(true);
    expect(mockCovers('/products/:param', '/products/featured')).toBe(true);
    expect(mockCovers('/products/featured', '/products/:param')).toBe(false);
    expect(mockCovers('/products/:param', '/products/:param/bundles')).toBe(false);
  });
});

describe('luật 1 mock-api-fallback: GET mới thiếu mặc định trong mock-api.ts thì đỏ', () => {
  const MOCK = 'apps/e2e/tests/support/mock-api.ts';
  const base = {
    'packages/app-core/src/api/restock.ts': "export const old = (http: HttpClient) => http.get('/me/old');\n",
    'packages/app-core/src/api/legacy.ts': "export const legacy = (http: HttpClient) => http.get('/me/legacy');\n",
    [MOCK]: "api.fallback('GET', '/me/old', {});\n",
  };
  const head = (mock: string, restockExtra = '') => ({
    ...base,
    'packages/app-core/src/api/restock.ts':
      base['packages/app-core/src/api/restock.ts'] +
      `${restockExtra}export const mine = (http: HttpClient) => http.get<MyRestockAlerts>('/me/restock-alerts');\n` +
      "export const again = (http: HttpClient) => http.get('/me/legacy');\n",
    'packages/app-core/src/api/restock.spec.ts': "http.get('/me/spec-only');\n",
    'apps/web/src/lib/stats.ts': "export const s = (id: string, d: number) => apiFetch(`/admin/x/${id}/stats?days=${d}`);\nexport const p = () => apiFetch('/admin/x', { method: 'POST' });\n",
    [MOCK]: mock,
  });
  const changed = ['packages/app-core/src/api/restock.ts', 'packages/app-core/src/api/restock.spec.ts', 'apps/web/src/lib/stats.ts', MOCK];

  it('ca vi phạm: /me/restock-alerts mới, chưa có api.fallback → đỏ, nêu đúng tệp:dòng; GET dời chỗ, POST, spec và GET đã có mặc định không bị nêu', async () => {
    const mock = `${base[MOCK]}api.fallback('GET', '/admin/x/:id/stats', {});\n`;
    const r = await run('mock-api-fallback', fakeCtx(head(mock), { base, changed }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('GET /me/restock-alerts (packages/app-core/src/api/restock.ts:2)');
    expect(r.errors[0]).toContain("api.fallback('GET', '/me/restock-alerts'");
  });

  it('thêm api.fallback cho đường dẫn đó thì xanh', async () => {
    const mock = `${base[MOCK]}api.fallback('GET', '/admin/x/:id/stats', {});\napi.fallback('GET', '/me/restock-alerts', { enabled: false, items: [] });\n`;
    const r = await run('mock-api-fallback', fakeCtx(head(mock), { base, changed }));
    expect(r.errors).toEqual([]);
    expect(r.notes.at(-1)).toContain('2 GET mới, 2 đã có mặc định');
  });

  it('comment wave-preflight-ignore có lý do ngay trên lời gọi thì bỏ qua; thiếu lý do thì vẫn đỏ', async () => {
    const mock = `${base[MOCK]}api.fallback('GET', '/admin/x/:id/stats', {});\n`;
    const withReason = head(mock, '// wave-preflight-ignore mock-api-fallback: chỉ gọi khi bấm, spec của nút tự mock\n');
    expect((await run('mock-api-fallback', fakeCtx(withReason, { base, changed }))).errors).toEqual([]);
    const noReason = head(mock, '// wave-preflight-ignore mock-api-fallback:\n');
    expect((await run('mock-api-fallback', fakeCtx(noReason, { base, changed }))).errors).toHaveLength(1);
  });

  it('không có gốc so sánh thì chỉ nhắc, không đỏ', async () => {
    const r = await run('mock-api-fallback', { root: '/fake', head: memTree(head(base[MOCK])), base: null, changed: null });
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toContain('không có gốc so sánh');
  });
});

describe('luật 2 heavy-migrations-runbook: HEAVY_MIGRATIONS khớp runbook mục 1.0/3.1/3.2', () => {
  const DB = 'apps/api/src/config/go-live/db-checks.ts';
  const RB = 'docs/launch/deploy-rollback-runbook.md';
  const dbChecks = [
    'export const REQUIRED_MIGRATIONS = [',
    "  '20260101000000_req_a',",
    '] as const;',
    'const ORDERS_LOCK_MIGRATION = REQUIRED_MIGRATIONS[0];',
    'export const HEAVY_MIGRATIONS: ReadonlyArray<{ name: string; ordersLock: boolean }> = [',
    '  { name: ORDERS_LOCK_MIGRATION, ordersLock: true },',
    "  { name: '20260102000000_b', ordersLock: false },",
    "  { name: '20260103000000_c_orders_idx', ordersLock: true },",
    '];',
  ].join('\n');
  const runbook = (rows: string[], max = 2) =>
    [
      '## 1. Chuẩn bị',
      '### 1.0 Việc đầu tiên',
      '| Migration | Làm gì | Thời gian |',
      ...rows.map((r) => `| \`${r}\` | … | … |`),
      '### 1.1 Redis',
      '## 3. Chọn giờ deploy',
      '### 3.1 Đếm đơn',
      `Danh sách có tối đa ${max} migration nặng trên orders.`,
      '### 3.2 Cửa sổ nên xin',
      `${max} × 10 giây = ${max * 10} giây`,
      '### 3.3 Chọn giờ',
    ].join('\n');
  const all = ['20260101000000_req_a', '20260102000000_b', '20260103000000_c_orders_idx'];

  it('đủ dòng và đúng số khoá orders (kể cả tên đọc qua hằng REQUIRED_MIGRATIONS[0]) thì xanh', async () => {
    const r = await run('heavy-migrations-runbook', fakeCtx({ [DB]: dbChecks, [RB]: runbook(all) }));
    expect(r.errors).toEqual([]);
    expect(r.notes.at(-1)).toBe('3 migration nặng, 2 khoá orders');
  });

  it('ca vi phạm (w24-01): migration nặng mới chưa có dòng mục 1.0 và 3.1/3.2 còn số cũ → đỏ cả ba chỗ', async () => {
    const r = await run('heavy-migrations-runbook', fakeCtx({ [DB]: dbChecks, [RB]: runbook(all.slice(0, 2), 1) }));
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toContain('20260103000000_c_orders_idx nằm trong HEAVY_MIGRATIONS nhưng bảng mục 1.0');
    expect(r.errors[1]).toContain('"tối đa 2"');
    expect(r.errors[2]).toContain('"2 × 10 giây = 20 giây"');
  });

  it('migration mới của wave dựng chỉ mục không CONCURRENTLY mà chưa vào danh sách thì nhắc (không đỏ)', async () => {
    const dir = 'apps/api/prisma/migrations/20260104000000_d';
    const head = (sql: string) => ({ [DB]: dbChecks, [RB]: runbook(all), [`${dir}/migration.sql`]: sql });
    const risky = await run('heavy-migrations-runbook', fakeCtx(head('-- chỉ mục mới\nCREATE INDEX "orders_x_idx" ON "orders"("x");'), { changed: [`${dir}/migration.sql`] }));
    expect(risky.errors).toEqual([]);
    expect(risky.warnings).toHaveLength(1);
    expect(risky.warnings[0]).toContain('20260104000000_d');
    const safe = await run('heavy-migrations-runbook', fakeCtx(head('CREATE INDEX CONCURRENTLY "orders_x_idx" ON "orders"("x");'), { changed: [`${dir}/migration.sql`] }));
    expect(safe.warnings).toEqual([]);
  });
});

describe('luật 3 cron-labels: mỗi @Cron có nhãn tiếng Việt trong CRON_JOB_LABELS', () => {
  const CRON = 'apps/api/src/modules/x/x.cron.ts';
  const LABELS = 'apps/web/src/components/admin/ops-health-tab.tsx';
  const SPEC = 'apps/web/src/components/admin/cron-job-labels.spec.ts';
  const cron = [
    'export class XCron {',
    "  @Cron('0 9 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })",
    '  @TrackCron()',
    '  async nudge() {}',
    '',
    "  @Cron(CronExpression.EVERY_HOUR, { name: 'x.named' })",
    "  @TrackCron('x.named')",
    '  hourly() {}',
    '}',
  ].join('\n');
  const labels = (rows: Record<string, string>) =>
    `export const CRON_JOB_LABELS: Record<string, string> = {\n${Object.entries(rows)
      .map(([k, v]) => `  '${k}': '${v}',`)
      .join('\n')}\n};\n`;
  const ok = { 'XCron.nudge': 'Nhắc khách lúc 9 giờ', 'x.named': 'Việc chạy mỗi giờ', 'Marker.job': 'Mốc tự ghi' };
  const ctx = (rows: Record<string, string>, cronSrc = cron) => fakeCtx({ [CRON]: cronSrc, [LABELS]: labels(rows), [SPEC]: "const MARKER_JOBS = ['Marker.job'];\n" });

  it('đủ nhãn (tên `Lớp.hàm` và tên `name` của @Cron), khoá mốc trong MARKER_JOBS được giữ → xanh', async () => {
    const r = await run('cron-labels', ctx(ok));
    expect(r.errors).toEqual([]);
    expect(r.notes.at(-1)).toBe('2 việc nền, 3 nhãn');
  });

  it('ca vi phạm (w23-01): @Cron mới chưa có nhãn → đỏ, nêu tên việc và tệp', async () => {
    const rest = Object.fromEntries(Object.entries(ok).filter(([k]) => k !== 'XCron.nudge'));
    const r = await run('cron-labels', ctx(rest));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain(`việc nền XCron.nudge (${CRON}) chưa có nhãn`);
  });

  it('khoá chết, nhãn không dấu và @TrackCron đặt trên @Cron đều đỏ', async () => {
    const r = await run('cron-labels', ctx({ ...ok, 'x.named': 'Hourly job', 'Old.job': 'Việc cũ' }));
    expect(r.errors.some((e) => e.includes('nhãn của x.named') && e.includes('Hourly job'))).toBe(true);
    expect(r.errors.some((e) => e.includes('khoá chết Old.job'))).toBe(true);
    const swapped = cron.replace(
      "  @Cron('0 9 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })\n  @TrackCron()\n",
      "  @TrackCron()\n  @Cron('0 9 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })\n",
    );
    const r2 = await run('cron-labels', ctx(ok, swapped));
    expect(r2.errors.some((e) => e.includes('2 @TrackCron nhưng chỉ đọc được 1 @Cron'))).toBe(true);
  });
});

describe('luật 4 notification-templates-count: "+N mới" của reference-seed race spec khớp seed và migration', () => {
  const SEED = 'apps/api/prisma/seed.ts';
  const RACE = 'apps/api/test/integration-race/reference-seed.race-spec.ts';
  const MIG = 'apps/api/prisma/migrations/20260101000000_x/migration.sql';
  const seed = (codes: string[]) =>
    `export const NOTIFICATION_TEMPLATES = [\n${codes.map((c) => `  { id: 'nt-${c.toLowerCase()}', code: '${c}', channel: 'INAPP', bodyTemplate: '${c}' },`).join('\n')}\n];\n`;
  const race = (n: number) => `expect(res.stdout).toContain('[seed-reference] notification_templates: +${n} mới');\n`;
  const sql = [
    'INSERT INTO "notification_templates" ("id", "code", "channel", "bodyTemplate") VALUES',
    "  -- ('nt-c', 'C', 'INAPP', 'tạm bỏ, không tính'),",
    "  ('nt-a', 'A', 'INAPP', 'Có '' nháy -- và gạch'),",
    "  ('nt-other', 'B', 'INAPP', 'trùng code, khác id')",
    'ON CONFLICT ("id") DO NOTHING;',
    'UPDATE "notification_templates" SET "bodyTemplate" = \'z\' WHERE "code" = \'C\';',
  ].join('\n');

  it('A trùng id, B trùng code đã có từ migration; chỉ C tạo mới → race spec "+1 mới" xanh', async () => {
    const r = await run('notification-templates-count', fakeCtx({ [SEED]: seed(['A', 'B', 'C']), [RACE]: race(1), [MIG]: sql }));
    expect(r.errors).toEqual([]);
    expect(r.notes.at(-1)).toContain('3 mẫu seed, 1 mẫu tạo mới');
  });

  it('ca vi phạm (w23-01/w24-02): thêm mẫu vào seed mà race spec còn số cũ → đỏ, nêu số đúng', async () => {
    const r = await run('notification-templates-count', fakeCtx({ [SEED]: seed(['A', 'B', 'C', 'D']), [RACE]: race(1), [MIG]: sql }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('chờ "notification_templates: +1 mới" nhưng DB vừa migrate sẽ tạo 2 mẫu');
    expect(r.errors[0]).toContain('sửa thành +2');
  });

  it('migration xoá mẫu hoặc đổi code thì không tự tính được → đỏ, không đếm sai', async () => {
    const del = `${sql}\nDELETE FROM "notification_templates" WHERE "code" = 'A';`;
    const r = await run('notification-templates-count', fakeCtx({ [SEED]: seed(['A', 'B', 'C']), [RACE]: race(1), [MIG]: del }));
    expect(r.errors.some((e) => e.includes('DELETE FROM notification_templates'))).toBe(true);
    const rename = `${sql}\nUPDATE "notification_templates" SET "code" = 'A2' WHERE "id" = 'nt-a';`;
    const r2 = await run('notification-templates-count', fakeCtx({ [SEED]: seed(['A', 'B', 'C']), [RACE]: race(1), [MIG]: rename }));
    expect(r2.errors.some((e) => e.includes('UPDATE đổi id/code'))).toBe(true);
  });

  it('stripSqlComments giữ `--` nằm trong chuỗi', () => {
    expect(stripSqlComments("SELECT 'a -- b' -- bỏ\n, 1")).toBe("SELECT 'a -- b' \n, 1");
  });
});

describe('luật 5 ds-ratchet-changed: tệp giao diện đổi không tăng bánh cóc', () => {
  const BASELINE = 'scripts/uiux/ds-baseline.json';
  const WISHLIST = 'apps/miniapp/src/pages/wishlist.tsx';
  const HOME = 'apps/miniapp/src/pages/home.tsx';
  const baseline = JSON.stringify({ px: { [HOME]: 1 }, maxMd: {}, guards: { miniapp: { 'open-snackbar': { 'pages/wishlist.tsx': 3 } }, web: {} } });
  // Mỗi tệp đếm thêm 2 chỗ cho dòng `const { openSnackbar } = useSnackbar()`; n lời gọi thành n + 2 chỗ.
  const snack = (n: number) => `const { openSnackbar } = useSnackbar();\n${Array.from({ length: n }, (_, i) => `openSnackbar({ text: '${i}' });`).join('\n')}\n`;
  const home = (extra = '') => `export const H = () => <div style={{ padding: 8${extra} }} />;\n`;

  it('giữ nguyên số đếm so với baseline thì xanh và nhắc chạy lint:parity khi đổi Mini', async () => {
    const r = await run('ds-ratchet-changed', fakeCtx({ [BASELINE]: baseline, [WISHLIST]: snack(1), [HOME]: home() }, { changed: [WISHLIST, HOME] }));
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toContain('pnpm lint:parity');
  });

  it('ca vi phạm (w24-04): thêm một openSnackbar vào trang Yêu thích Mini → đỏ open-snackbar', async () => {
    const r = await run('ds-ratchet-changed', fakeCtx({ [BASELINE]: baseline, [WISHLIST]: snack(2), [HOME]: home() }, { changed: [WISHLIST] }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('ds-shop-guard (miniapp): open-snackbar: pages/wishlist.tsx: 4 chỗ, baseline 3');
  });

  it('px viết tay tăng ở tệp cũ hoặc có ở tệp mới → đỏ px-ratchet', async () => {
    const fresh = 'apps/miniapp/src/components/new-card.tsx';
    const r = await run(
      'ds-ratchet-changed',
      fakeCtx({ [BASELINE]: baseline, [HOME]: home(', gap: 12'), [fresh]: 'export const C = () => <div style={{ margin: 10 }} />;\n' }, { changed: [HOME, fresh] }),
    );
    expect(r.errors.some((e) => e.startsWith('px-ratchet:') && e.includes(`${HOME}: px tăng 1 → 2`))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('px-ratchet:') && e.includes(`${fresh}: file mới`))).toBe(true);
  });

  it('không đổi tệp giao diện thì không làm gì', async () => {
    const r = await run('ds-ratchet-changed', fakeCtx({ [BASELINE]: baseline }, { changed: ['apps/api/src/x.ts'] }));
    expect(r).toMatchObject({ errors: [], warnings: [] });
  });
});

describe('luật 6 admin-staff-matrix: mọi route /admin có trong bảng quyền', () => {
  const CTRL = 'apps/api/src/modules/a/a.controller.ts';
  const SPEC = 'apps/api/src/common/staff-permissions.matrix.spec.ts';
  const ctrl = [
    "@Controller('admin/widgets')",
    'export class AdminWidgetsController {',
    '  @Get()',
    '  list() {}',
    "  @Post(':id/publish')",
    '  publish() {}',
    '}',
    "@Controller(['feed', 'internal/feed'])",
    'export class FeedController {',
    "  @Get('admin/queue')",
    '  queue() {}',
    "  @Get('public')",
    '  pub() {}',
    '}',
  ].join('\n');
  const matrix = (keys: string[]) => `const EXPECTED: Record<string, Access> = {\n${keys.map((k) => `  '${k}': ADMIN_ONLY,`).join('\n')}\n};\n`;
  const all = ['GET /admin/widgets', 'POST /admin/widgets/:id/publish', 'GET /feed/admin/queue', 'GET /internal/feed/admin/queue'];
  const ctx = (keys: string[], extra: Record<string, string> = {}) => fakeCtx({ [CTRL]: ctrl, [SPEC]: matrix(keys), ...extra });

  it('đủ dòng (kể cả /admin nằm giữa đường dẫn và controller nhiều tiền tố) thì xanh; route không có admin không cần dòng', async () => {
    const r = await run('admin-staff-matrix', ctx(all, { 'apps/api/src/modules/a/a.controller.spec.ts': "@Controller('admin/spec-only')\nclass X { @Get() a() {} }" }));
    expect(r.errors).toEqual([]);
    expect(r.notes.at(-1)).toBe('4 route quản trị, 4 dòng trong bảng');
  });

  it('ca vi phạm (w24-02): route /admin mới chưa khai trong EXPECTED → đỏ, nêu khoá cần thêm', async () => {
    const r = await run('admin-staff-matrix', ctx(all.filter((k) => !k.startsWith('POST'))));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain(`route quản trị POST /admin/widgets/:id/publish (${CTRL}) chưa có trong EXPECTED`);
  });

  it('dòng của route đã xoá và đường dẫn không phải chuỗi trực tiếp đều đỏ', async () => {
    expect((await run('admin-staff-matrix', ctx([...all, 'GET /admin/gone']))).errors[0]).toContain('còn route quản trị GET /admin/gone');
    const dynamic = await run('admin-staff-matrix', ctx(all, { 'apps/api/src/modules/b/b.controller.ts': "@Controller('admin/b')\nclass B {\n  @Get(ROUTE)\n  x() {}\n}" }));
    expect(dynamic.errors.some((e) => e.includes('@Get(ROUTE) không phải chuỗi trực tiếp'))).toBe(true);
  });
});

describe('git: tệp đổi gồm commit, sửa chưa commit, tệp mới chưa track; đọc cây ở gốc bằng một lần cat-file', () => {
  it('trên repo git tạm', () => {
    const root = mkdtempSync(join(tmpdir(), 'wave-preflight-'));
    const git = ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false'];
    const g = (...args: string[]) => execFileSync('git', [...git, ...args], { cwd: root, encoding: 'utf8' });
    const put = (rel: string, text: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    g('init', '-q');
    put('a/old.ts', 'cũ\n');
    put('a/same.ts', 'giữ\n');
    g('add', '.');
    g('commit', '-qm', 'gốc');
    const base = g('rev-parse', 'HEAD').trim();
    put('a/committed.ts', 'mới\n');
    g('add', '.');
    g('commit', '-qm', 'wave');
    put('a/old.ts', 'sửa\n');
    put('a/untracked.ts', 'chưa add\n');
    expect(changedFiles(root, base)).toEqual(['a/committed.ts', 'a/old.ts', 'a/untracked.ts']);
    const tree = gitTree(root, base);
    expect(tree.list('a').sort()).toEqual(['a/old.ts', 'a/same.ts']);
    expect([...tree.readMany(['a/old.ts', 'a/missing.ts', 'a/same.ts'])]).toEqual([
      ['a/old.ts', 'cũ\n'],
      ['a/missing.ts', null],
      ['a/same.ts', 'giữ\n'],
    ]);
  });
});

describe('repo thật', () => {
  it('bốn luật kiểm cả repo đều xanh và chạy dưới 5 giây', async () => {
    const started = performance.now();
    const results = await runPreflight(buildContext({ root: REPO, base: 'HEAD' }), {
      only: ['heavy-migrations-runbook', 'cron-labels', 'notification-templates-count', 'admin-staff-matrix'],
    });
    expect(results.map((r) => [r.id, r.errors])).toEqual([
      ['heavy-migrations-runbook', []],
      ['cron-labels', []],
      ['notification-templates-count', []],
      ['admin-staff-matrix', []],
    ]);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('CLI: luật không có thì thoát 2 và liệt kê luật có', async () => {
    const lines: string[] = [];
    const code = await main(['--only', 'khong-co'], { log: (s) => lines.push(s), error: (s) => lines.push(s) });
    expect(code).toBe(2);
    expect(lines[0]).toContain('mock-api-fallback, heavy-migrations-runbook, cron-labels, notification-templates-count, ds-ratchet-changed, admin-staff-matrix');
  });
});
