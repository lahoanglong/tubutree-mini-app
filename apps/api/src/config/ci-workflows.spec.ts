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

  it('dựng cả image zalo-bridge và kiểm zca-js nạp được từ image', () => {
    expect(wf).toMatch(/matrix:\s*\n\s+app: \[api, web, zalo-bridge\]/);
    expect(wf).toContain('apps/zalo-bridge/Dockerfile');
    expect(wf).toContain("- 'apps/zalo-bridge/**'");
    expect(wf).toMatch(/require\('zca-js'\)/);
  });

  it('không đẩy image đi đâu: không login registry, không docker push, không push: true', () => {
    const c = code(wf);
    expect(c).not.toMatch(/docker push|docker login|docker\/login-action|push: true/);
  });

  it('web build có ZALO_APP_ID và ZALO_MINIAPP_ID giả (Dockerfile dừng nếu rỗng, không phải số hoặc trùng nhau) và kiểm container chạy bằng user node ghi được .next/cache', () => {
    const appId = /--build-arg NEXT_PUBLIC_ZALO_APP_ID=(\S+)/.exec(wf)?.[1];
    const miniAppId = /--build-arg NEXT_PUBLIC_ZALO_MINIAPP_ID=(\S+)/.exec(wf)?.[1];
    expect(appId).toMatch(/^[0-9]+$/);
    expect(miniAppId).toMatch(/^[0-9]+$/);
    expect(appId).not.toBe(miniAppId);
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

describe('.github/workflows/ci.yml — rào chunk lười Mini App (tubu-w22-03)', () => {
  const wf = read('.github/workflows/ci.yml');

  it('chạy SAU bước Build trên thư mục www của miniapp, và chặn (không continue-on-error)', () => {
    const build = wf.indexOf('run: pnpm build');
    const step = wf.indexOf('run: node scripts/ci/mini-lazy-chunks.cjs apps/miniapp/www');
    expect(build).toBeGreaterThan(-1);
    expect(step).toBeGreaterThan(build);
    const block = wf.slice(wf.lastIndexOf('- name:', step), wf.indexOf('- name:', step) === -1 ? undefined : wf.indexOf('- name:', step));
    expect(code(block)).not.toContain('continue-on-error');
  });
});

describe('scripts/ci/bundle-budget.cjs', () => {
  const SCRIPT = join(REPO, 'scripts/ci/bundle-budget.cjs');

  /**
   * Thư mục build giả: entry JS `entryKb` KiB (hoặc đúng `entryBytes` byte), một chunk nhỏ, một chunk game mini 2 KiB (`noGameChunk` bỏ nó),
   * một CSS. Nội dung ngẫu nhiên để gzip không nén mất. Bản build thật luôn có chunk `mini-*`, nên thiếu nó là một cảnh báo riêng.
   * `totalBytes`: thêm một tệp đệm để tổng mọi tệp đúng bằng số byte này.
   */
  function run(opts: { entryKb: number; entryBytes?: number; chunkKb?: number; totalBytes?: number; env?: Record<string, string>; noDir?: boolean; noGameChunk?: boolean }) {
    const dir = mkdtempSync(join(tmpdir(), 'tubu-bundle-'));
    const www = join(dir, 'www');
    if (!opts.noDir) {
      mkdirSync(join(www, 'assets'), { recursive: true });
      const blob = (bytes: number) => Buffer.from(Array.from({ length: bytes }, (_, i) => (i * 7919 + (i >> 3)) % 251));
      const files: [string, Buffer][] = [
        ['assets/index.abc.module.js', blob(opts.entryBytes ?? opts.entryKb * 1024)],
        ['assets/product.def.js', blob((opts.chunkKb ?? 10) * 1024)],
        ...(opts.noGameChunk ? [] : ([['assets/mini-round-shell.ghi.js', blob(2 * 1024)]] as [string, Buffer][])),
        ['assets/index.abc.css', blob(5 * 1024)],
      ];
      if (opts.totalBytes !== undefined) {
        const pad = opts.totalBytes - files.reduce((s, [, b]) => s + b.length, 0);
        if (pad < 0) throw new Error(`totalBytes ${opts.totalBytes} nhỏ hơn các tệp sẵn có`);
        files.push(['assets/pad.bin', Buffer.alloc(pad, 1)]);
      }
      for (const [name, buf] of files) writeFileSync(join(www, name), buf);
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
    expect(w).toMatch(/50 KiB = 51200 B/);
  });

  it('tổng vượt ngưỡng: cảnh báo riêng cho tổng', () => {
    const { status, out } = run({ entryKb: 100, chunkKb: 100, env: { MINIAPP_ENTRY_WARN_KB: '700', MINIAPP_TOTAL_WARN_KB: '150' } });
    expect(status).toBe(0);
    expect(warnings(out).join('\n')).toMatch(/tổng.*150 KiB = 153600 B/i);
  });

  // Trước w33-03 script so Math.round(byte / 1024) với ngưỡng: bản dựng 2210 KiB + 511 B vẫn qua strict.
  it('trần tổng mặc định 2210 KiB so từng byte: đúng 2 263 040 B qua strict, thêm 1 B thì strict thoát 1, chế độ CI chỉ cảnh báo', () => {
    const atCap = run({ entryKb: 100, totalBytes: 2210 * 1024, env: { BUNDLE_BUDGET_STRICT: '1' } });
    expect(atCap.status).toBe(0);
    expect(warnings(atCap.out)).toEqual([]);
    expect(atCap.out).toContain('KiB (1024 B)');
    expect(atCap.out).toContain('Tổng: 2263040 B raw, ngưỡng 2210 KiB = 2263040 B (mặc định 2210): còn 0 B tới trần');

    const overByOne = run({ entryKb: 100, totalBytes: 2210 * 1024 + 1, env: { BUNDLE_BUDGET_STRICT: '1' } });
    expect(overByOne.status).toBe(1);
    expect(overByOne.out).toContain('Tổng: 2263041 B raw, ngưỡng 2210 KiB = 2263040 B (mặc định 2210): vượt 1 B');
    expect(warnings(overByOne.out)).toEqual([
      expect.stringMatching(/^::warning title=Bundle miniapp::Tổng bản build là 2263041 B raw .*vượt ngưỡng cảnh báo 2210 KiB = 2263040 B \(mặc định 2210\): thừa 1 B\.$/),
    ]);

    const ci = run({ entryKb: 100, totalBytes: 2210 * 1024 + 1, env: { MINIAPP_ENTRY_WARN_KB: '312', MINIAPP_TOTAL_WARN_KB: '2210' } });
    expect(ci.status).toBe(0);
    expect(warnings(ci.out)).toHaveLength(1);
    expect(ci.out).toContain('ngưỡng 2210 KiB = 2263040 B (MINIAPP_TOTAL_WARN_KB=2210): vượt 1 B');
    expect(ci.md).toContain('vượt 1 B');

    const headroom = run({ entryKb: 100, totalBytes: 2210 * 1024 - 511, env: { BUNDLE_BUDGET_STRICT: '1' } });
    expect(headroom.status).toBe(0);
    expect(headroom.out).toContain('còn 511 B tới trần');
  });

  it('ngưỡng entry cũng so từng byte: 312 KiB = 319 488 B qua strict, 319 489 B thì strict thoát 1', () => {
    const env = { BUNDLE_BUDGET_STRICT: '1', MINIAPP_TOTAL_WARN_KB: '4096' };
    expect(run({ entryKb: 0, entryBytes: 312 * 1024, env }).status).toBe(0);
    const over = run({ entryKb: 0, entryBytes: 312 * 1024 + 1, env });
    expect(over.status).toBe(1);
    expect(warnings(over.out).join('\n')).toMatch(/Entry assets\/index\.abc\.module\.js là 319489 B raw .*vượt ngưỡng cảnh báo 312 KiB = 319488 B \(mặc định 312\): thừa 1 B\./);
  });

  it('ngưỡng sai dạng: log nói rõ đang dùng mặc định và giá trị bị bỏ', () => {
    const { status, out } = run({ entryKb: 100, totalBytes: 2210 * 1024, env: { MINIAPP_TOTAL_WARN_KB: 'abc', BUNDLE_BUDGET_STRICT: '1' } });
    expect(status).toBe(0);
    expect(out).toContain('ngưỡng 2210 KiB = 2263040 B (mặc định 2210, MINIAPP_TOTAL_WARN_KB="abc" sai dạng): còn 0 B tới trần');
  });

  it('ci.yml và script cùng mặc định ngưỡng tổng/entry', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const wf = read('.github/workflows/ci.yml');
    for (const name of ['MINIAPP_TOTAL_WARN_KB', 'MINIAPP_ENTRY_WARN_KB']) {
      const def = new RegExp(`threshold\\('${name}', (\\d+)\\)`).exec(script)?.[1];
      expect(def).toBeDefined();
      expect(wf).toContain(`${name}: \${{ vars.${name} || '${def}' }}`);
    }
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

  it('không có chunk game mini (mini-*): đúng một cảnh báo riêng, vẫn thoát 0', () => {
    const { status, out } = run({ entryKb: 100, noGameChunk: true, env: { MINIAPP_ENTRY_WARN_KB: '700', MINIAPP_TOTAL_WARN_KB: '2048' } });
    expect(status).toBe(0);
    const w = warnings(out);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Không thấy chunk game mini \(mini-\*\)/);
  });

  it('ngưỡng sai dạng thì dùng mặc định, không thoát lỗi', () => {
    const { status } = run({ entryKb: 10, env: { MINIAPP_ENTRY_WARN_KB: 'abc' } });
    expect(status).toBe(0);
  });
});
