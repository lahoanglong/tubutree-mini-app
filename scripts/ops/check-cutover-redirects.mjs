#!/usr/bin/env node
// Kiểm bảng chuyển hướng WordPress -> web mới (apps/web/src/lib/legacy-wp-redirects.ts) trên một host thật, TRƯỚC khi đổi DNS.
// Chỉ ĐỌC: gửi HEAD (hoặc GET) tới URL công khai, không ghi gì. Node >= 22.18 (nạp thẳng tệp .ts của bảng chuyển hướng).
//
//   # Thử máy chủ Vietnix khi tubutree.com còn ở ZenCloud (giống curl --resolve tubutree.com:443:14.225.207.177):
//   node scripts/ops/check-cutover-redirects.mjs --base https://tubutree.com --resolve-ip 14.225.207.177
//   # Cả sitemap WordPress đã lưu về (mỗi file một --sitemap) và mẫu blog đi qua reverse proxy:
//   node scripts/ops/check-cutover-redirects.mjs --base https://tubutree.com --resolve-ip 14.225.207.177 \
//        --sitemap product-sitemap.xml --sitemap page-sitemap.xml --blog proxy
//   node scripts/ops/check-cutover-redirects.mjs --help
//
// Mỗi URL được đi theo chuyển hướng tay (tối đa 6 chặng) rồi xếp PASS / WARN / FAIL:
//   PASS  301/308 một chặng tới đúng đích và đích trả 2xx; 410 cho trang demo; URL không có luật thì trả 2xx không chuyển hướng.
//   WARN  chuyển hướng tạm thời (302/303/307).
//   FAIL  sai đích, chuỗi từ 2 chặng, vòng lặp, sang origin khác, đích 4xx/5xx, lỗi mạng, hoặc mong 410 mà không phải 410.
// URL WordPress có luật (chuyển hướng hoặc 410) mà đi qua chặng bỏ dấu "/" cuối trước (308 rồi 301) là FAIL: web đặt skipTrailingSlashRedirect để mọi URL
// WordPress cũ, vốn đều kết thúc bằng "/", đi MỘT chặng. URL không có luật (vd /gio-hang/) bỏ dấu "/" bằng 308 là bình thường, chỉ ghi chú.
// Mã thoát: 0 không có FAIL (WARN vẫn 0, trừ --strict), 1 có FAIL, 2 sai tham số.
// Node in cảnh báo ExperimentalWarning/MODULE_TYPELESS_PACKAGE_JSON ra stderr khi nạp tệp .ts: vô hại, không ảnh hưởng kết quả.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODULE_FILE = fileURLToPath(new URL('../../apps/web/src/lib/legacy-wp-redirects.ts', import.meta.url));
const MAX_HOPS = 6;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PERMANENT_STATUSES = new Set([301, 308]);

export const isRedirectStatus = (status) => REDIRECT_STATUSES.has(status);
const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** Lấy mọi `<loc>` của một sitemap (bỏ `<image:loc>`), đổi `&amp;` về `&`. */
export function parseSitemapLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => (m[1] ?? '').replace(/&amp;/g, '&'));
}

/** URL tuyệt đối hoặc đường dẫn bắt đầu bằng "/" -> `{ path, search }`; chuỗi khác -> null. */
export function toPathAndSearch(input) {
  const text = input.trim();
  if (!text) return null;
  try {
    const u = text.startsWith('/') ? new URL(text, 'http://x.invalid') : new URL(text);
    return { path: u.pathname, search: u.search };
  } catch {
    return null;
  }
}

export function sameTarget(a, b) {
  return trimSlash(a.path) === trimSlash(b.path) && a.search === b.search;
}

/** Chặng chỉ bỏ dấu "/" cuối của chính URL vừa gọi (cùng query). */
export function isSlashHop(step) {
  return !!step.next && step.path !== '/' && step.path.endsWith('/') && step.next.path === trimSlash(step.path) && step.next.search === step.search;
}

/**
 * Xếp loại một chuỗi chuyển hướng. `expected` = `{ kind: 'redirect', location } | { kind: 'gone' } | { kind: 'none' }`.
 * `steps` = các phản hồi theo thứ tự `{ status, path, search, next }`, `next` = `{ origin, path, search }` của Location (nếu có).
 * `flags` = `{ loop, tooMany, external }` do bộ đi theo chuyển hướng đặt.
 */
export function classifyChain({ expected, steps, flags = {} }) {
  const last = steps[steps.length - 1];
  if (!last || last.status === 0) return { verdict: 'FAIL', reason: 'lỗi mạng hoặc quá thời gian chờ', notes: [] };
  if (flags.loop) return { verdict: 'FAIL', reason: 'vòng lặp chuyển hướng', notes: [] };
  if (flags.external) return { verdict: 'FAIL', reason: `chuyển sang origin khác: ${last.next?.origin ?? '?'}`, notes: [] };
  if (flags.tooMany) return { verdict: 'FAIL', reason: `quá ${MAX_HOPS} chặng`, notes: [] };

  const notes = [];
  const slashHops = steps.filter(isSlashHop).length;
  if (slashHops) notes.push(`${slashHops} chặng bỏ dấu /`);
  const contentHops = steps.filter((s) => s.next && isRedirectStatus(s.status) && !isSlashHop(s));
  const ok2xx = last.status >= 200 && last.status < 300;

  if (expected.kind === 'gone') {
    if (contentHops.length) return { verdict: 'FAIL', reason: 'mong 410 nhưng bị chuyển hướng', notes };
    if (slashHops) return { verdict: 'FAIL', reason: 'mong 410 ngay ở URL gốc nhưng phải bỏ dấu / cuối trước (thêm một chặng)', notes };
    return last.status === 410 ? { verdict: 'PASS', reason: '410', notes } : { verdict: 'FAIL', reason: `mong 410, nhận ${last.status}`, notes };
  }

  if (expected.kind === 'none') {
    if (contentHops.length) return { verdict: 'FAIL', reason: 'không có luật nhưng bị chuyển hướng', notes };
    return ok2xx ? { verdict: 'PASS', reason: String(last.status), notes } : { verdict: 'FAIL', reason: `nhận ${last.status}`, notes };
  }

  const first = contentHops[0];
  if (!first) return { verdict: 'FAIL', reason: `không chuyển hướng (nhận ${last.status})`, notes };
  if (!first.next || !sameTarget(first.next, toPathAndSearch(expected.location) ?? { path: '', search: '' })) {
    return { verdict: 'FAIL', reason: `sai đích: ${first.next ? first.next.path + first.next.search : '?'} (mong ${expected.location})`, notes };
  }
  if (contentHops.length > 1) return { verdict: 'FAIL', reason: `chuỗi ${contentHops.length} chặng nội dung`, notes };
  if (slashHops) return { verdict: 'FAIL', reason: 'chuỗi 2 chặng: bỏ dấu / cuối rồi mới chuyển hướng (cần chuyển hướng thẳng một chặng)', notes };
  if (!ok2xx) return { verdict: 'FAIL', reason: `đích trả ${last.status}`, notes };
  if (!PERMANENT_STATUSES.has(first.status)) return { verdict: 'WARN', reason: `chuyển hướng tạm thời (${first.status})`, notes };
  return { verdict: 'PASS', reason: String(first.status), notes };
}

function requestOnce(url, { resolveIp, method, timeout }) {
  const secure = url.protocol === 'https:';
  const options = {
    method,
    host: resolveIp || url.hostname,
    port: url.port || (secure ? 443 : 80),
    path: url.pathname + url.search,
    // Kết nối tới IP nhưng gửi Host và SNI của tên miền thật, tương đương `curl --resolve`.
    headers: { host: url.host, 'user-agent': 'tubutree-cutover-check/1', accept: 'text/html,*/*' },
    servername: url.hostname,
    timeout,
  };
  return new Promise((resolve) => {
    const req = (secure ? https : http).request(options, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, location: null }));
    req.end();
  });
}

/** Đi theo chuyển hướng bằng tay từ `path+search` trên `base`; trả `{ steps, flags }` cho classifyChain. */
export async function walk({ base, resolveIp = '', path, search = '', method = 'HEAD', timeout = 15000 }) {
  const baseUrl = new URL(base);
  const steps = [];
  const seen = new Set();
  let current = new URL(path + search, baseUrl);
  for (let i = 0; i <= MAX_HOPS; i += 1) {
    if (seen.has(current.href)) return { steps, flags: { loop: true } };
    seen.add(current.href);
    const res = await requestOnce(current, { resolveIp, method, timeout });
    let next = null;
    if (isRedirectStatus(res.status) && res.location) {
      const target = new URL(res.location, current);
      next = { origin: target.origin, path: target.pathname, search: target.search };
    }
    steps.push({ status: res.status, path: current.pathname, search: current.search, next });
    if (!next) return { steps, flags: {} };
    if (next.origin !== baseUrl.origin) return { steps, flags: { external: true } };
    current = new URL(next.path + next.search, baseUrl);
  }
  return { steps, flags: { tooMany: true } };
}

/** Đổi kết quả tra của bảng (`resolveLegacyWpPath`) thành `expected` cho classifyChain. */
export function expectedFor(resolution) {
  if (!resolution) return { kind: 'none' };
  return resolution.kind === 'gone' ? { kind: 'gone' } : { kind: 'redirect', location: resolution.location };
}

const HELP = `Dùng: node scripts/ops/check-cutover-redirects.mjs [tuỳ chọn]

Kiểm bảng chuyển hướng WordPress -> web mới trên một host. Chỉ đọc (HEAD mặc định).

Tuỳ chọn:
  --base URL          gốc cần kiểm, vd https://tubutree.com (mặc định https://app.tubutree.com)
  --resolve-ip IP     kết nối tới IP này nhưng giữ Host/SNI của --base (như curl --resolve); vd 14.225.207.177
  --sitemap FILE      sitemap WordPress đã lưu về, lặp lại được; mỗi <loc> là một URL cần kiểm
  --urls FILE         mỗi dòng một URL tuyệt đối hoặc đường dẫn bắt đầu bằng /
  --blog proxy|skip   URL blog/ảnh/feed của WordPress: proxy = mong trả 2xx không chuyển hướng; skip = bỏ qua (mặc định)
  --method HEAD|GET   mặc định HEAD
  --concurrency N     số request song song (4)
  --timeout MS        thời gian chờ mỗi request (15000)
  --limit N           chỉ kiểm N URL đầu
  --strict            WARN cũng làm thoát mã 1
  --json              in kết quả dạng JSON
  -h, --help          in trợ giúp này

Không có --sitemap/--urls thì kiểm bộ URL dựng từ chính bảng chuyển hướng (mọi trang, 91 sản phẩm, vài trang demo), mỗi URL kèm dấu / cuối như WordPress.
Mã thoát: 0 không có FAIL, 1 có FAIL, 2 sai tham số.`;

export function parseArgs(argv) {
  const opts = { base: 'https://app.tubutree.com', resolveIp: '', sitemaps: [], urls: '', blog: 'skip', method: 'HEAD', concurrency: 4, timeout: 15000, limit: 0, strict: false, json: false, help: false };
  const takes = new Set(['--base', '--resolve-ip', '--sitemap', '--urls', '--blog', '--method', '--concurrency', '--timeout', '--limit']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--json') opts.json = true;
    else if (takes.has(arg)) {
      i += 1;
      const value = argv[i];
      if (value === undefined) throw new Error(`${arg} cần một giá trị`);
      if (arg === '--base') opts.base = value;
      else if (arg === '--resolve-ip') opts.resolveIp = value;
      else if (arg === '--sitemap') opts.sitemaps.push(value);
      else if (arg === '--urls') opts.urls = value;
      else if (arg === '--blog') opts.blog = value;
      else if (arg === '--method') opts.method = value.toUpperCase();
      else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) throw new Error(`${arg} cần số nguyên không âm`);
        if (arg === '--concurrency') opts.concurrency = Math.max(1, n);
        else if (arg === '--timeout') opts.timeout = Math.max(1, n);
        else opts.limit = n;
      }
    } else throw new Error(`Tham số lạ: ${arg}`);
  }
  if (!['proxy', 'skip'].includes(opts.blog)) throw new Error('--blog chỉ nhận proxy hoặc skip');
  if (!['HEAD', 'GET'].includes(opts.method)) throw new Error('--method chỉ nhận HEAD hoặc GET');
  try {
    new URL(opts.base);
  } catch {
    throw new Error(`--base không phải URL: ${opts.base}`);
  }
  return opts;
}

async function loadTable() {
  try {
    return await import(pathToFileURL(MODULE_FILE).href);
  } catch (err) {
    throw new Error(`Không nạp được ${MODULE_FILE} (cần Node >= 22.18 để chạy thẳng .ts, hoặc thêm --experimental-strip-types): ${err instanceof Error ? err.message : String(err)}`);
  }
}

function defaultInventory(table) {
  const paths = [
    ...Object.keys(table.LEGACY_PAGE_REDIRECTS),
    ...Object.keys(table.LEGACY_FILE_REDIRECTS),
    ...Object.keys(table.LEGACY_PRODUCT_REDIRECTS).map((slug) => `/product/${slug}`),
    '/shop/page/2',
    '/product-category/fuwa3e',
    '/elements/hotspot',
    '/blocks/shop-header',
    '/featured_item/magazine',
    ...table.LEGACY_GONE_EXACT,
  ];
  return paths.map((p) => ({ path: `${p}/`, search: '' }));
}

function collectInputs(opts, table) {
  const raw = [];
  for (const file of opts.sitemaps) raw.push(...parseSitemapLocs(readFileSync(file, 'utf8')));
  if (opts.urls) raw.push(...readFileSync(opts.urls, 'utf8').split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')));
  const parsed = raw.length ? raw.map(toPathAndSearch).filter(Boolean) : defaultInventory(table);
  const seen = new Set();
  const unique = parsed.filter((u) => {
    const key = u.path + u.search;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return opts.limit ? unique.slice(0, opts.limit) : unique;
}

async function mapPool(items, size, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : String(err)}\n\n${HELP}`);
    return 2;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  const table = await loadTable();
  const inputs = collectInputs(opts, table);
  const rows = await mapPool(inputs, opts.concurrency, async (input) => {
    const isBlog = table.isWpBlogPath(input.path);
    if (isBlog && opts.blog === 'skip') return { ...input, verdict: 'SKIP', reason: 'blog/ảnh WordPress (--blog skip)', notes: [], expected: { kind: 'blog' }, steps: [] };
    const expected = isBlog ? { kind: 'none' } : expectedFor(table.resolveLegacyWpPath(input.path));
    const { steps, flags } = await walk({ base: opts.base, resolveIp: opts.resolveIp, path: input.path, search: input.search, method: opts.method, timeout: opts.timeout });
    return { ...input, expected, steps, ...classifyChain({ expected, steps, flags }) };
  });

  const count = (v) => rows.filter((r) => r.verdict === v).length;
  const summary = { total: rows.length, pass: count('PASS'), warn: count('WARN'), fail: count('FAIL'), skip: count('SKIP') };
  if (opts.json) {
    console.log(JSON.stringify({ base: opts.base, resolveIp: opts.resolveIp || null, summary, rows }, null, 2));
  } else {
    for (const r of rows) {
      const to = r.expected.kind === 'redirect' ? ` -> ${r.expected.location}` : r.expected.kind === 'gone' ? ' -> 410' : '';
      const notes = r.notes.length ? ` [${r.notes.join(', ')}]` : '';
      console.log(`${r.verdict.padEnd(4)}  ${r.path}${r.search}${to}  (${r.reason})${notes}`);
    }
    console.log(`\n${opts.base}${opts.resolveIp ? ` qua ${opts.resolveIp}` : ''}: ${summary.total} URL, ${summary.pass} PASS, ${summary.warn} WARN, ${summary.fail} FAIL, ${summary.skip} SKIP`);
  }
  return summary.fail || (opts.strict && summary.warn) ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => process.exit(code));
}
