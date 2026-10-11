import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../../scripts/check-undefined-css-vars.mjs', import.meta.url));

/**
 * `pnpm lint:vars` chỉ được tin các file token NÊU TÊN: một file css lạ trong css/ tự khai báo biến
 * không được làm im lỗi "biến chưa định nghĩa". Dựng một cây giả rồi chạy đúng script thật trong đó.
 */
describe('scripts/check-undefined-css-vars.mjs — nguồn định nghĩa token là danh sách tường minh', () => {
  let root: string;
  const put = (rel: string, content: string) => {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };
  const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf-8' });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lint-vars-'));
    put('packages/design-tokens/src/tokens.css', ':root{--stone-900:#111}');
    put('apps/miniapp/src/css/tokens.css', ':root{--app-token:1}');
    put('apps/miniapp/src/css/zaui-bridge.css', ':root{--zaui-light-color-primary:#222}');
    put('apps/miniapp/src/css/dealer-theme.css', ':root{--color-dealer-ink:#333}');
    put('apps/miniapp/src/css/brand-theme.css', ':root{--color-brand-poland:#444}');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('token khai báo ở 5 file nguồn (design-tokens, tokens, zaui-bridge, dealer-theme, brand-theme) đều hợp lệ', () => {
    put(
      'apps/miniapp/src/pages/x.tsx',
      "const s = 'var(--stone-900) var(--app-token) var(--zaui-light-color-primary) var(--color-dealer-ink) var(--color-brand-poland)';",
    );
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('biến chỉ khai báo trong một file css lạ vẫn bị báo chưa định nghĩa', () => {
    put('apps/miniapp/src/css/stray.css', ':root{--stray-only:1}');
    put('apps/miniapp/src/pages/x.tsx', "const s = 'var(--stray-only)';");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('var(--stray-only) is not defined anywhere');
  });

  it('tên biến gõ sai bị báo, kèm file:dòng', () => {
    put('apps/miniapp/src/pages/x.tsx', "const ok = 1;\nconst s = 'var(--color-dealer-inkk)';");
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/pages[\\/]x\.tsx:2: var\(--color-dealer-inkk\) is not defined anywhere/);
  });
});
