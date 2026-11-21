import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../../..');
const SCRIPT = join(REPO, 'scripts/ci/web-budget.cjs');

function run(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '' } }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, out: `${stdout}${stderr}` });
    });
  });
}

/** Byte ngẫu nhiên: gzip không nén được nên số gzip xấp xỉ số thô và 50 KB thêm vào là 50 KB thật. */
const chunk = (bytes: number) => randomBytes(bytes);

describe('scripts/ci/web-budget.cjs (ngân sách JS tải lần đầu + HTML Trang chủ)', () => {
  let dir: string;
  let next: string;
  const SIZES = { main: 20_000, rootLayout: 6_000, globalError: 1_000, home: 9_000, list: 4_000, pdp: 5_000, shopLayout: 3_000, admin: 90_000 };

  const writeChunk = (name: string, bytes: number) => writeFileSync(join(next, 'static/chunks', name), chunk(bytes));
  const writeManifest = (extraHome: string[] = []) =>
    writeFileSync(
      join(next, 'app-build-manifest.json'),
      JSON.stringify({
        pages: {
          '/layout': ['static/chunks/main.js', 'static/chunks/root-layout.js', 'static/css/app.css'],
          '/global-error': ['static/chunks/main.js', 'static/chunks/global-error.js'],
          '/page': ['static/chunks/main.js', 'static/chunks/home.js', ...extraHome],
          '/san-pham/page': ['static/chunks/main.js', 'static/chunks/list.js'],
          '/(shop)/layout': ['static/chunks/shop-layout.js'],
          '/(shop)/san-pham/[slug]/page': ['static/chunks/main.js', 'static/chunks/pdp.js'],
          '/admin/page': ['static/chunks/admin.js'],
        },
      }),
    );
  const writeBudget = (budget: unknown) => {
    const file = join(dir, 'budget.json');
    writeFileSync(file, JSON.stringify(budget));
    return file;
  };
  const homeRaw = SIZES.main + SIZES.rootLayout + SIZES.globalError + SIZES.home;
  const pdpRaw = SIZES.main + SIZES.rootLayout + SIZES.globalError + SIZES.shopLayout + SIZES.pdp;
  // Ngưỡng = số hiện tại + 3% như web-budget.json thật (gzip của byte ngẫu nhiên lớn hơn số thô vài chục byte).
  const BUDGET = {
    routes: {
      '/': { maxGzipBytes: Math.round(homeRaw * 1.03) },
      '/san-pham': { maxGzipBytes: Math.round((SIZES.main + SIZES.rootLayout + SIZES.globalError + SIZES.list) * 1.03) },
      '/san-pham/[slug]': { warnGzipBytes: Math.round(pdpRaw * 1.03) },
    },
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'web-budget-'));
    next = join(dir, '.next');
    mkdirSync(join(next, 'static/chunks'), { recursive: true });
    mkdirSync(join(next, 'static/css'), { recursive: true });
    writeFileSync(join(next, 'static/css/app.css'), chunk(50_000));
    writeChunk('main.js', SIZES.main);
    writeChunk('root-layout.js', SIZES.rootLayout);
    writeChunk('global-error.js', SIZES.globalError);
    writeChunk('home.js', SIZES.home);
    writeChunk('list.js', SIZES.list);
    writeChunk('pdp.js', SIZES.pdp);
    writeChunk('shop-layout.js', SIZES.shopLayout);
    writeChunk('admin.js', SIZES.admin);
    writeManifest();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('xanh trên bản dựng trong ngưỡng; JS lần đầu = hợp tệp .js của trang, layout bao nó (cả nhóm route) và global-error, mỗi tệp tính một lần, bỏ CSS', async () => {
    const r = await run([next, '--config', writeBudget(BUDGET)]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`| / | `);
    expect(r.out).toContain(`| ${homeRaw} B |`);
    expect(r.out).toContain(`| ${pdpRaw} B |`);
    expect(r.out).not.toContain('::error');
    expect(r.out).not.toContain('::warning');
    expect(r.out).toContain('trong ngưỡng');
  });

  it('đỏ (mã 1) khi cố ý thêm 50 KB vào JS tải lần đầu của Trang chủ', async () => {
    writeChunk('extra.js', 50_000);
    writeManifest(['static/chunks/extra.js']);
    const r = await run([next, '--config', writeBudget(BUDGET)]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/::error title=Ngân sách web::\/: \d+ B gzip > \d+ B/);
    expect(r.out).toContain('VƯỢT (chặn)');
  });

  it('route chỉ cảnh báo (đợt 4 khác đang thêm mã) vượt ngưỡng: in cảnh báo, vẫn xanh', async () => {
    writeChunk('pdp.js', SIZES.pdp + 50_000);
    const r = await run([next, '--config', writeBudget(BUDGET)]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/::warning title=Ngân sách web::\/san-pham\/\[slug\]: \d+ B gzip > \d+ B/);
    expect(r.out).toContain('vượt (chỉ cảnh báo)');
  });

  it('route chặn biến mất khỏi manifest thì đỏ; route chỉ cảnh báo biến mất thì chỉ cảnh báo', async () => {
    const missingWarn = await run([next, '--config', writeBudget({ routes: { ...BUDGET.routes, '/gio-hang': { warnGzipBytes: 1 } } })]);
    expect(missingWarn.code).toBe(0);
    expect(missingWarn.out).toContain('::warning title=Ngân sách web::/gio-hang: không có trong app-build-manifest.json');
    const missingMax = await run([next, '--config', writeBudget({ routes: { ...BUDGET.routes, '/thanh-toan': { maxGzipBytes: 999_999 } } })]);
    expect(missingMax.code).toBe(1);
    expect(missingMax.out).toContain('::error title=Ngân sách web::/thanh-toan: không có trong app-build-manifest.json');
  });

  it('chưa build (không có app-build-manifest.json) thì mã 2, không xanh giả', async () => {
    rmSync(join(next, 'app-build-manifest.json'));
    const r = await run([next, '--config', writeBudget(BUDGET)]);
    expect(r.code).toBe(2);
  });

  describe('HTML chưa nén của Trang chủ', () => {
    let server: Server;
    let base: string;
    let body = '';
    beforeEach(async () => {
      server = createServer((req, res) => {
        res.writeHead(req.url === '/' ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
        res.end(req.url === '/' ? body : 'không có');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const budget = () => writeBudget({ ...BUDGET, html: { '/': { maxBytes: 2_000 } } });

    it('không có --html-base thì ghi bỏ qua (CI không có dữ liệu thật), không đỏ', async () => {
      const r = await run([next, '--config', budget()]);
      expect(r.code).toBe(0);
      expect(r.out).toContain('bỏ qua: không có --html-base');
    });

    it('trong ngưỡng thì xanh, vượt ngưỡng thì đỏ', async () => {
      body = 'a'.repeat(1_500);
      const ok = await run([next, '--config', budget(), '--html-base', base]);
      expect(ok.code).toBe(0);
      expect(ok.out).toContain('| / | 1500 B | 2000 B | trong ngưỡng |');

      body = 'a'.repeat(2_500);
      const bad = await run([next, '--config', budget(), '--html-base', base]);
      expect(bad.code).toBe(1);
      expect(bad.out).toContain('::error title=Ngân sách web::HTML /: 2500 B > 2000 B');
    });
  });

  it('CI chạy ngân sách web SAU bước Build trên apps/web/.next, không tắt lỗi của bước', () => {
    const wf = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
    const build = wf.indexOf('run: pnpm build');
    const step = wf.indexOf('run: node scripts/ci/web-budget.cjs apps/web/.next');
    expect(build).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(build);
    const start = wf.lastIndexOf('\n      - ', step);
    const end = wf.indexOf('\n      - ', step);
    const block = wf.slice(start, end === -1 ? undefined : end);
    expect(block).toContain('- name: Ngân sách JS tải lần đầu của web');
    expect(block).not.toContain('continue-on-error');
  });

  it('ngưỡng thật nằm trong scripts/ci/web-budget.json: cả sáu route đều chặn cứng (không route nào chỉ cảnh báo), có ngân sách HTML Trang chủ', () => {
    const real = JSON.parse(readFileSync(join(REPO, 'scripts/ci/web-budget.json'), 'utf8')) as {
      routes: Record<string, { maxGzipBytes?: number; warnGzipBytes?: number }>;
      html: Record<string, { maxBytes: number }>;
    };
    const blocking = Object.entries(real.routes).filter(([, r]) => r.maxGzipBytes !== undefined).map(([k]) => k);
    const warnOnly = Object.entries(real.routes).filter(([, r]) => r.maxGzipBytes === undefined && r.warnGzipBytes !== undefined).map(([k]) => k);
    expect(blocking.sort()).toEqual(['/', '/gio-hang/[[...variant]]', '/san-pham', '/san-pham/[slug]', '/thanh-toan', '/vuon-xanh/[[...variant]]']);
    expect(warnOnly).toEqual([]);
    for (const [route, r] of Object.entries(real.routes)) expect([route, r.maxGzipBytes! > 0]).toEqual([route, true]);
    expect(real.html['/']?.maxBytes).toBeLessThanOrEqual(245_000);
  });
});
