#!/usr/bin/env node
// Kiểm tĩnh trước release (tubu-w29-04): sáu lỗi lặp lại ở các lượt release W22–W24, mỗi lần tốn khoảng một giờ chạy lại Playwright/race và
// commit sửa. Chỉ đọc tệp, không chạy DB, build hay test; dưới 5 giây trên cả repo.
//
//   node scripts/ci/wave-preflight/index.mjs                  so với merge-base của HEAD và origin/main
//   node scripts/ci/wave-preflight/index.mjs --base <ref>     so với ref khác (vd SHA gốc của wave)
//   node scripts/ci/wave-preflight/index.mjs --only cron-labels,admin-staff-matrix
//   node scripts/ci/wave-preflight/index.mjs --json           in kết quả dạng JSON
//
// Thoát 1 khi có lỗi. "nhắc" không làm đỏ. Luật 1 và 5 chỉ xét tệp đổi so với gốc; bốn luật còn lại kiểm cả repo.
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { changedFiles, fsTree, gitTree, resolveBase } from './lib.mjs';
import * as mockApiFallback from './rules/mock-api-fallback.mjs';
import * as heavyMigrations from './rules/heavy-migrations-runbook.mjs';
import * as cronLabels from './rules/cron-labels.mjs';
import * as notificationTemplates from './rules/notification-templates-count.mjs';
import * as dsRatchet from './rules/ds-ratchet-changed.mjs';
import * as adminMatrix from './rules/admin-staff-matrix.mjs';

export { changedFiles, fsTree, gitTree, memTree, resolveBase } from './lib.mjs';
export { extractGetCalls, mockCovers, mockedGetPaths, normalizePath } from './rules/mock-api-fallback.mjs';
export { stripSqlComments } from './rules/notification-templates-count.mjs';

export const RULES = [mockApiFallback, heavyMigrations, cronLabels, notificationTemplates, dsRatchet, adminMatrix];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Ngữ cảnh đọc repo thật: cây làm việc, cây ở gốc so sánh, danh sách tệp đổi. */
export function buildContext({ root = REPO, base } = {}) {
  const sha = resolveBase(root, base);
  return {
    root,
    head: fsTree(root),
    base: sha ? gitTree(root, sha) : null,
    baseRef: sha,
    changed: sha ? changedFiles(root, sha) : null,
  };
}

/** Chạy các luật trên một ngữ cảnh (spec truyền cây giả). Lỗi bất ngờ trong một luật thành lỗi của luật đó, không làm sập các luật khác. */
export async function runPreflight(ctx, { only } = {}) {
  const rules = only ? RULES.filter((r) => only.includes(r.id)) : RULES;
  const results = [];
  for (const rule of rules) {
    const started = performance.now();
    let out;
    try {
      out = await rule.check(ctx);
    } catch (e) {
      out = { errors: [`luật ném lỗi: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`], warnings: [], notes: [] };
    }
    results.push({ id: rule.id, title: rule.title, ms: Math.round(performance.now() - started), ...out });
  }
  return results;
}

export async function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  const only = arg('--only')
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = only?.filter((o) => !RULES.some((r) => r.id === o)) ?? [];
  if (unknown.length > 0) {
    io.error(`wave-preflight: không có luật ${unknown.join(', ')} (có: ${RULES.map((r) => r.id).join(', ')})`);
    return 2;
  }
  const started = performance.now();
  const ctx = buildContext({ root: resolve(arg('--root') ?? REPO), base: arg('--base') });
  if (arg('--base') && !ctx.baseRef) {
    io.error(`wave-preflight: không tìm thấy commit ${arg('--base')}`);
    return 2;
  }
  const results = await runPreflight(ctx, { only });
  const errors = results.reduce((n, r) => n + r.errors.length, 0);
  const warnings = results.reduce((n, r) => n + r.warnings.length, 0);
  const seconds = ((performance.now() - started) / 1000).toFixed(2);

  if (argv.includes('--json')) {
    io.log(JSON.stringify({ base: ctx.baseRef, changed: ctx.changed?.length ?? null, errors, warnings, seconds: Number(seconds), results }, null, 2));
    return errors > 0 ? 1 : 0;
  }
  const baseText = ctx.baseRef ? `gốc ${ctx.baseRef.slice(0, 9)}, ${ctx.changed.length} tệp đổi` : 'không có gốc so sánh';
  io.log(`wave-preflight (${baseText})`);
  results.forEach((r, i) => {
    const state = r.errors.length > 0 ? 'ĐỎ' : 'xanh';
    io.log(`[${i + 1}/${results.length}] ${r.id}: ${state} — ${r.title}${r.notes.length > 0 ? ` (${r.notes[r.notes.length - 1]})` : ''}`);
    for (const e of r.errors) io.error(`  lỗi: ${r.id}: ${e}`);
    for (const w of r.warnings) io.log(`  nhắc: ${r.id}: ${w}`);
    for (const n of r.notes.slice(0, -1)) io.log(`  ghi chú: ${r.id}: ${n}`);
  });
  io.log(`wave-preflight: ${errors} lỗi, ${warnings} nhắc, ${seconds} giây`);
  return errors > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
