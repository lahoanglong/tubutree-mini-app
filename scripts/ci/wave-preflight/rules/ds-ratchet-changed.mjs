// Luật 5: wave đổi tệp giao diện của Mini App (hoặc web) thì chạy ngay bánh cóc giao diện trên đúng các tệp đó: px viết tay / `max-md:` của
// scripts/uiux/ds-ratchet.mjs và luật ds-shop-guard của scripts/uiux/ds-shop-rules.mjs (thẻ tự chế, giá gạch, primitive màu, `Text` zmp-ui,
// gọi thẳng openSnackbar), so với scripts/uiux/ds-baseline.json. Luật guard chỉ chạy trong vitest (ds-shop-guard.spec.ts) nên trước đây chỉ lộ ở
// lượt release (w24-04: toast báo hàng về của Yêu thích gọi thẳng openSnackbar). Không đụng tệp nào thì luật không làm gì.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readMany } from '../lib.mjs';

export const id = 'ds-ratchet-changed';
export const title = 'Tệp giao diện Mini App/web đổi không tăng bánh cóc giao diện (ds-ratchet + ds-shop-guard)';

export const BASELINE = 'scripts/uiux/ds-baseline.json';
const PLATFORMS = ['miniapp', 'web'];
// Mã bánh cóc lấy từ repo chứa preflight (không từ `--root`), để spec chạy trên cây giả vẫn dùng đúng luật thật.
const UIUX = join(dirname(fileURLToPath(import.meta.url)), '../../../uiux');

async function loadRatchet() {
  try {
    const ratchet = await import(pathToFileURL(join(UIUX, 'ds-ratchet.mjs')).href);
    const rules = await import(pathToFileURL(join(UIUX, 'ds-shop-rules.mjs')).href);
    return { ratchet, rules };
  } catch (e) {
    return { error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
}

const platformOf = (rel) => PLATFORMS.find((p) => rel.startsWith(`apps/${p}/src/`));
const isUiSource = (rel) => platformOf(rel) !== undefined && /\.(ts|tsx)$/.test(rel) && !/\.(spec|test)\.|\.d\.ts$/.test(rel);

export async function check(ctx) {
  const res = { errors: [], warnings: [], notes: [] };
  if (!ctx.changed) {
    res.warnings.push('không có gốc so sánh (origin/main hoặc --base), bỏ qua luật này; chạy `pnpm lint:parity` và ds-shop-guard.spec của hai app');
    return res;
  }
  const touchedMini = ctx.changed.some((f) => f.startsWith('apps/miniapp/'));
  const files = ctx.changed.filter(isUiSource);
  if (files.length === 0) {
    res.notes.push(touchedMini ? 'đổi tệp apps/miniapp nhưng không đổi mã giao diện' : 'không đổi tệp giao diện nào');
    return res;
  }
  const mods = await loadRatchet();
  if (mods.error) {
    res.errors.push(`không nạp được scripts/uiux/ds-ratchet.mjs (${mods.error}): chạy \`pnpm install\` ở gốc repo rồi chạy lại`);
    return res;
  }
  const { countPx, countMaxMd, inScope, compareCounts } = mods.ratchet;
  const { guardViolations } = mods.rules;
  let raw;
  try {
    raw = JSON.parse(ctx.head.read(BASELINE) ?? '{}');
  } catch (e) {
    res.errors.push(`${BASELINE} không phải JSON hợp lệ (${e instanceof Error ? e.message : String(e)})`);
    return res;
  }
  const baseline = { px: raw.px ?? {}, maxMd: raw.maxMd ?? {}, guards: raw.guards ?? {} };
  const texts = readMany(ctx.head, files);
  const changedSet = new Set(files);
  const pick = (o) => Object.fromEntries(Object.entries(o).filter(([f]) => changedSet.has(f)));

  const scoped = files.filter((f) => inScope(f) && texts.get(f) != null);
  for (const [kind, count, name] of [['px', countPx, 'px-ratchet'], ['maxMd', countMaxMd, 'max-md-ratchet']]) {
    const current = Object.fromEntries(scoped.map((f) => [f, count(texts.get(f), f)]).filter(([, n]) => n > 0));
    const { errors, notices } = compareCounts({ kind, baseline: pick(baseline[kind]), current });
    res.errors.push(...errors.map((e) => `${name}: ${e}`));
    res.notes.push(...notices.map((n) => `${name}: ${n}`));
  }

  for (const platform of PLATFORMS) {
    const prefix = `apps/${platform}/src/`;
    const mine = files.filter((f) => f.startsWith(prefix) && texts.get(f) != null);
    if (mine.length === 0) continue;
    const rels = new Set(mine.map((f) => f.slice(prefix.length)));
    const guardBaseline = Object.fromEntries(
      Object.entries(baseline.guards[platform] ?? {}).map(([rule, perFile]) => [rule, Object.fromEntries(Object.entries(perFile).filter(([f]) => rels.has(f)))]),
    );
    const { errors, notices } = guardViolations({ platform, files: mine.map((f) => ({ rel: f.slice(prefix.length), text: texts.get(f) })), baseline: guardBaseline });
    res.errors.push(...errors.map((e) => `ds-shop-guard (${platform}): ${e}`));
    res.notes.push(...notices.map((n) => `ds-shop-guard (${platform}): ${n}`));
  }

  const perPlatform = PLATFORMS.map((p) => `${p} ${files.filter((f) => platformOf(f) === p).length}`).join(', ');
  res.notes.push(`đã kiểm ${files.length} tệp giao diện đổi (${perPlatform})`);
  if (touchedMini) res.warnings.push('wave đổi apps/miniapp: trước khi báo xong vẫn chạy `pnpm lint:parity` (cả cây) và đo gói Mini (`node scripts/ci/bundle-budget.cjs apps/miniapp/www`)');
  return res;
}
