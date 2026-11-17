import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '../../../../../../scripts/ci/bundle-budget.cjs');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Bản build giả: entry nhỏ và các chunk `mini-*` với kích thước raw cho trước (byte). */
function run(chunks: Record<string, number>, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tubu-mini-budget-'));
  dirs.push(dir);
  const assets = join(dir, 'www', 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, 'index.abc.module.js'), Buffer.alloc(10 * 1024, 97));
  for (const [name, bytes] of Object.entries(chunks)) writeFileSync(join(assets, `${name}.x1.module.js`), Buffer.alloc(bytes, 98));
  const res = spawnSync(process.execPath, [SCRIPT, join(dir, 'www')], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });
  const warnings = `${res.stdout}${res.stderr}`.split('\n').filter((l) => l.startsWith('::warning'));
  return { status: res.status, warnings };
}

/** Kích thước đo được của 9 chunk game mini sau đợt B (byte raw), làm mốc cho spec. */
const WAVE_B = {
  'mini-round-shell': 9_914,
  'mini-result': 5_889,
  'mini-sort': 3_050,
  'mini-match': 3_045,
  'mini-basket-cart': 2_729,
  'mini-result-products': 2_196,
  'mini-basket': 2_162,
  'mini-origin': 1_785,
  'mini-daily-quiz': 1_725,
};

describe('cổng gói game mini (scripts/ci/bundle-budget.cjs)', () => {
  it('5 game: tổng chunk mini-* dưới 40000 byte và từng chunk dưới trần thì không cảnh báo, chế độ strict thoát 0', () => {
    const { status, warnings } = run(WAVE_B, { BUNDLE_BUDGET_STRICT: '1' });
    expect(warnings).toEqual([]);
    expect(status).toBe(0);
  });

  it('tổng chunk mini-* vượt 40000 byte (mặc định, không đặt biến) thì cảnh báo và strict thoát 1', () => {
    const { status, warnings } = run({ ...WAVE_B, 'mini-extra-a': 5_000, 'mini-extra-b': 5_000 }, { BUNDLE_BUDGET_STRICT: '1' });
    expect(warnings.join('\n')).toMatch(/mini-\*\) tổng \d+ byte raw, vượt ngưỡng 40000/);
    expect(status).toBe(1);
  });

  it('một chunk bàn chơi quá 6 KB, hay khung ván quá 10 KB, thì cảnh báo riêng chunk đó', () => {
    const { warnings } = run({ 'mini-round-shell': 10 * 1024 + 1, 'mini-match': 6 * 1024 + 1, 'mini-origin': 6 * 1024 });
    const text = warnings.join('\n');
    expect(text).toMatch(/mini-round-shell\.x1\.module\.js là 10241 byte raw, vượt trần 10240/);
    expect(text).toMatch(/mini-match\.x1\.module\.js là 6145 byte raw, vượt trần 6144/);
    expect(text).not.toMatch(/mini-origin/);
  });
});
