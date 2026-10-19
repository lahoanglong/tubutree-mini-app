import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../../..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
/** Bỏ dòng chú thích để khẳng định "không có lệnh X" không dính chữ trong comment. */
const code = (text: string) =>
  text
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');

describe('.github/workflows/docker-build.yml (D6-09a)', () => {
  const wf = read('.github/workflows/docker-build.yml');

  it('build đúng hai Dockerfile api và web trên PR vào main, quyền chỉ đọc', () => {
    expect(wf).toMatch(/pull_request:\s*\n\s+branches: \[main\]/);
    expect(wf).toContain('apps/api/Dockerfile');
    expect(wf).toContain('apps/web/Dockerfile');
    expect(wf).toMatch(/permissions:\s*\n\s+contents: read/);
  });

  it('không đẩy image đi đâu: không login registry, không docker push, không push: true', () => {
    const c = code(wf);
    expect(c).not.toMatch(/docker push|docker login|docker\/login-action|push: true/);
  });

  it('web build có ZALO_APP_ID giả (Dockerfile dừng nếu rỗng) và kiểm container chạy bằng user node ghi được .next/cache', () => {
    expect(wf).toMatch(/--build-arg NEXT_PUBLIC_ZALO_APP_ID=\S+/);
    expect(wf).toMatch(/--entrypoint id \S+ -un/);
    expect(wf).toContain('apps/web/.next/cache/.write-test');
    expect(wf).toContain('apps/web/.next/server/app/.write-test');
  });

  it('api build kiểm module chạy được từ image (bắt phantom dependency như express thiếu)', () => {
    expect(wf).toMatch(/require\('express'\)/);
    expect(wf).toMatch(/require\('@nestjs\/core'\)/);
  });
});

describe('.github/workflows/race.yml (D6-09b)', () => {
  const wf = read('.github/workflows/race.yml');
  const setupEnv = read('apps/api/test/integration-race/setup-env.ts');

  it('chạy trên PR vào main (khi đụng API), hằng đêm và bằng tay', () => {
    expect(wf).toMatch(/pull_request:\s*\n\s+branches: \[main\]/);
    expect(wf).toMatch(/schedule:\s*\n\s+- cron: /);
    expect(wf).toContain('workflow_dispatch');
  });

  it('DB là service Postgres tên tubutree_it và DATABASE_URL qua được chốt an toàn của setup-env.ts', () => {
    expect(wf).toContain('POSTGRES_DB: tubutree_it');
    const url = /DATABASE_URL: (\S+)/.exec(wf)?.[1] ?? '';
    const guard = /if \(!(\/.+\/)\.test\(url\)\)/.exec(setupEnv)?.[1] ?? '';
    expect(guard).not.toBe('');
    const re = new Function(`return ${guard}`)() as RegExp;
    expect(re.test(url)).toBe(true);
  });

  it('áp migration và kiểm drift trước khi chạy, rồi chạy race suite nối tiếp bằng đúng config', () => {
    const migrate = wf.indexOf('prisma migrate deploy');
    const drift = wf.indexOf('prisma migrate diff');
    const run = wf.indexOf('test/integration-race/jest.config.js --runInBand');
    expect(migrate).toBeGreaterThan(-1);
    expect(drift).toBeGreaterThan(migrate);
    expect(run).toBeGreaterThan(drift);
    expect(wf).toMatch(/--exit-code/);
  });

  it('quyền chỉ đọc, có timeout và hủy lượt cũ khi đẩy commit mới', () => {
    expect(wf).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(wf).toMatch(/timeout-minutes: \d+/);
    expect(wf).toMatch(/cancel-in-progress: true/);
  });
});

describe('.github/workflows/ci.yml — báo cáo bundle miniapp (D6-08)', () => {
  const wf = read('.github/workflows/ci.yml');

  it('chạy SAU bước Build, chỉ trên thư mục www của miniapp, ngưỡng chỉnh được bằng biến repo', () => {
    const build = wf.indexOf('run: pnpm build');
    const step = wf.indexOf('scripts/ci/bundle-budget.cjs apps/miniapp/www');
    expect(build).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(build);
    expect(wf).toMatch(/MINIAPP_ENTRY_WARN_KB: \$\{\{ vars\.MINIAPP_ENTRY_WARN_KB \|\| '\d+' \}\}/);
    expect(wf).toMatch(/MINIAPP_TOTAL_WARN_KB: \$\{\{ vars\.MINIAPP_TOTAL_WARN_KB \|\| '\d+' \}\}/);
  });

  it('chỉ cảnh báo, không chặn: không bật chế độ strict', () => {
    expect(wf).not.toContain('BUNDLE_BUDGET_STRICT');
  });
});

describe('scripts/ci/bundle-budget.cjs', () => {
  const SCRIPT = join(REPO, 'scripts/ci/bundle-budget.cjs');

  /** Thư mục build giả: entry JS `entryKb` KB, một chunk nhỏ, một CSS. Nội dung ngẫu nhiên để gzip không nén mất. */
  function run(opts: { entryKb: number; chunkKb?: number; env?: Record<string, string>; noDir?: boolean }) {
    const dir = mkdtempSync(join(tmpdir(), 'tubu-bundle-'));
    const www = join(dir, 'www');
    if (!opts.noDir) {
      mkdirSync(join(www, 'assets'), { recursive: true });
      const blob = (kb: number) => Buffer.from(Array.from({ length: kb * 1024 }, (_, i) => (i * 7919 + (i >> 3)) % 251));
      writeFileSync(join(www, 'assets/index.abc.module.js'), blob(opts.entryKb));
      writeFileSync(join(www, 'assets/product.def.js'), blob(opts.chunkKb ?? 10));
      writeFileSync(join(www, 'assets/index.abc.css'), blob(5));
    }
    const summary = join(dir, 'summary.md');
    const res = spawnSync('node', [SCRIPT, www], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', GITHUB_STEP_SUMMARY: summary, ...opts.env },
    });
    let md = '';
    try {
      md = readFileSync(summary, 'utf8');
    } catch {
      /* không ghi summary */
    }
    rmSync(dir, { recursive: true, force: true });
    return { status: res.status, out: `${res.stdout}${res.stderr}`, md };
  }
  const warnings = (out: string) => out.split('\n').filter((l) => l.startsWith('::warning'));

  it('dưới ngưỡng: in kích thước, không cảnh báo, thoát 0, ghi bảng vào step summary', () => {
    const { status, out, md } = run({ entryKb: 100, env: { MINIAPP_ENTRY_WARN_KB: '700', MINIAPP_TOTAL_WARN_KB: '2048' } });
    expect(status).toBe(0);
    expect(warnings(out)).toEqual([]);
    expect(out).toContain('index.abc.module.js');
    expect(md).toContain('Bundle miniapp');
    expect(md).toMatch(/\| JS \|/);
  });

  it('entry vượt ngưỡng: cảnh báo nêu ngưỡng và tên file, VẪN thoát 0 (không chặn)', () => {
    const { status, out } = run({ entryKb: 100, env: { MINIAPP_ENTRY_WARN_KB: '50', MINIAPP_TOTAL_WARN_KB: '2048' } });
    expect(status).toBe(0);
    const w = warnings(out).join('\n');
    expect(w).toContain('index.abc.module.js');
    expect(w).toMatch(/50 KB/);
  });

  it('tổng vượt ngưỡng: cảnh báo riêng cho tổng', () => {
    const { status, out } = run({ entryKb: 100, chunkKb: 100, env: { MINIAPP_ENTRY_WARN_KB: '700', MINIAPP_TOTAL_WARN_KB: '150' } });
    expect(status).toBe(0);
    expect(warnings(out).join('\n')).toMatch(/tổng.*150 KB/i);
  });

  it('BUNDLE_BUDGET_STRICT=1 mới thoát 1 khi vượt ngưỡng', () => {
    const { status } = run({ entryKb: 100, env: { MINIAPP_ENTRY_WARN_KB: '50', BUNDLE_BUDGET_STRICT: '1' } });
    expect(status).toBe(1);
  });

  it('không thấy thư mục build: cảnh báo (đổi tên thư mục đầu ra không được im lặng), thoát 0', () => {
    const { status, out } = run({ entryKb: 1, noDir: true });
    expect(status).toBe(0);
    expect(warnings(out).join('\n')).toMatch(/không thấy thư mục/);
  });

  it('ngưỡng sai dạng thì dùng mặc định, không thoát lỗi', () => {
    const { status } = run({ entryKb: 10, env: { MINIAPP_ENTRY_WARN_KB: 'abc' } });
    expect(status).toBe(0);
  });
});
