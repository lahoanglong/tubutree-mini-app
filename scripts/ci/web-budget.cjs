#!/usr/bin/env node
/**
 * Ngân sách JS tải lần đầu của web (Next app router) và HTML Trang chủ. Ngưỡng nằm trong `web-budget.json` cạnh tệp này.
 *
 *   node scripts/ci/web-budget.cjs [thư mục .next, mặc định apps/web/.next] [--html-base http://localhost:3000] [--config đường-dẫn.json]
 *
 * JS tải lần đầu của một route = hợp các tệp .js của trang, của mọi layout / khung chờ / ranh giới lỗi bao nó và `global-error` trong
 * `app-build-manifest.json` (đúng các thẻ script module trình duyệt tải khi mở thẳng route đó; polyfill `nomodule` không tính), cộng byte gzip
 * mức 9 như cột "First Load JS" của `next build` (cột đó chỉ tính tệp của trang nên nhỏ hơn).
 * Route có `maxGzipBytes` mà vượt thì thoát mã 1 (đỏ CI); route chỉ có `warnGzipBytes` thì in cảnh báo, không chặn.
 * HTML: chỉ kiểm khi có `--html-base` (cần máy chủ đang chạy với dữ liệu thật); CI không có dữ liệu nên bỏ qua và ghi rõ.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function parseArgs(argv) {
  const out = { dir: 'apps/web/.next', htmlBase: process.env.WEB_BUDGET_HTML_BASE || '', config: path.join(__dirname, 'web-budget.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--html-base') out.htmlBase = argv[++i] ?? '';
    else if (argv[i] === '--config') out.config = argv[++i] ?? out.config;
    else out.dir = argv[i];
  }
  return out;
}

/** `/(shop)/san-pham/[slug]/page` → `/san-pham/[slug]`: bỏ nhóm route `(…)`, slot `@…` và đuôi `/page`. */
function routeOfKey(key) {
  const segs = key.split('/').filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  if (segs.at(-1) !== 'page') return null;
  return '/' + segs.slice(0, -1).join('/');
}

/** Tệp đặc biệt của mỗi đoạn đường dẫn mà HTML của route kéo theo (layout, khung chờ, ranh giới lỗi). */
const SEGMENT_FILES = ['layout', 'template', 'loading', 'error', 'not-found', 'forbidden', 'unauthorized'];

function firstLoadFiles(pages, route) {
  const pageKey = Object.keys(pages).find((k) => routeOfKey(k) === route);
  if (!pageKey) return null;
  const parts = pageKey.split('/').slice(0, -1);
  const keys = [pageKey, '/global-error'];
  for (let i = 1; i <= parts.length; i++) {
    const dir = parts.slice(0, i).join('/') || '';
    for (const file of SEGMENT_FILES) keys.push(`${dir}/${file}`);
  }
  return [...new Set(keys.flatMap((k) => (pages[k] ?? []).filter((f) => f.endsWith('.js'))))];
}

const gzipCache = new Map();
function sizes(dir, files) {
  let raw = 0;
  let gzip = 0;
  for (const f of files) {
    if (!gzipCache.has(f)) {
      const buf = fs.readFileSync(path.join(dir, f));
      gzipCache.set(f, { raw: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length });
    }
    raw += gzipCache.get(f).raw;
    gzip += gzipCache.get(f).gzip;
  }
  return { raw, gzip };
}

async function htmlBytes(base, route) {
  const res = await fetch(new URL(route, base), { headers: { 'accept-encoding': 'identity', accept: 'text/html' } });
  return { status: res.status, bytes: Buffer.byteLength(await res.text()) };
}

const kb = (n) => (n / 1024).toFixed(1);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const budget = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  const manifestPath = path.join(args.dir, 'app-build-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`Không thấy ${manifestPath}: chạy \`next build\` của apps/web trước.`);
    process.exit(2);
  }
  const pages = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).pages;
  const lines = ['| Route | JS lần đầu gzip | thô | Ngưỡng | Kết quả |', '|---|---:|---:|---:|---|'];
  const failures = [];
  const warnings = [];
  for (const [route, rule] of Object.entries(budget.routes)) {
    const files = firstLoadFiles(pages, route);
    if (!files) {
      (rule.maxGzipBytes ? failures : warnings).push(`${route}: không có trong app-build-manifest.json`);
      lines.push(`| ${route} | — | — | — | không thấy route |`);
      continue;
    }
    const s = sizes(args.dir, files);
    const limit = rule.maxGzipBytes ?? rule.warnGzipBytes;
    const over = s.gzip > limit;
    const verdict = !over ? 'trong ngưỡng' : rule.maxGzipBytes ? 'VƯỢT (chặn)' : 'vượt (chỉ cảnh báo)';
    if (over) (rule.maxGzipBytes ? failures : warnings).push(`${route}: ${s.gzip} B gzip > ${limit} B`);
    lines.push(`| ${route} | ${s.gzip} B (${kb(s.gzip)} KB) | ${s.raw} B | ${limit} B${rule.maxGzipBytes ? '' : ' (cảnh báo)'} | ${verdict} |`);
  }
  if (budget.html && Object.keys(budget.html).length > 0) {
    lines.push('', '| HTML chưa nén | Byte | Ngưỡng | Kết quả |', '|---|---:|---:|---|');
    for (const [route, rule] of Object.entries(budget.html)) {
      if (!args.htmlBase) {
        lines.push(`| ${route} | — | ${rule.maxBytes} B | bỏ qua: không có --html-base (cần máy chủ với dữ liệu thật) |`);
        continue;
      }
      const h = await htmlBytes(args.htmlBase, route);
      const bad = h.status !== 200 || h.bytes > rule.maxBytes;
      if (bad) failures.push(`HTML ${route}: ${h.status !== 200 ? `HTTP ${h.status}` : `${h.bytes} B > ${rule.maxBytes} B`}`);
      lines.push(`| ${route} | ${h.bytes} B | ${rule.maxBytes} B | ${bad ? 'VƯỢT (chặn)' : 'trong ngưỡng'} |`);
    }
  }
  const report = lines.join('\n');
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Ngân sách web\n\n${report}\n`);
  for (const w of warnings) console.log(`::warning title=Ngân sách web::${w}`);
  for (const f of failures) console.log(`::error title=Ngân sách web::${f}`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
