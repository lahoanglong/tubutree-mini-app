#!/usr/bin/env node
// Kiểm sitemap ↔ canonical ↔ robots trên một bản web đang chạy. Chỉ GET công khai: không đăng nhập, không ghi gì.
//
//   # Bản dựng chạy cục bộ (next start), canonical là host thật của bản dựng:
//   node scripts/ci/sitemap-guard/index.mjs --base http://localhost:3000 --canonical https://tubutree.com
//   # Site thật, lấy mẫu 20 URL mỗi loại có nhiều trang (sản phẩm, danh mục, nhãn, gian hàng, chiến dịch):
//   node scripts/ci/sitemap-guard/index.mjs --base https://tubutree.com --max-per-kind 20
//
// Với mỗi URL của /sitemap.xml:
//   - trả 200 thẳng (chuyển hướng, 404, 410 đều FAIL: sitemap chỉ được khai URL cuối),
//   - <link rel="canonical"> trỏ đúng URL đó (cùng host, đường dẫn và query),
//   - không noindex (thẻ meta robots/googlebot hay header X-Robots-Tag),
//   - robots.txt không chặn (luật khớp dài nhất, như Google).
// Sitemap phải có trang chủ, đủ 5 trang /chinh-sach/* (thiếu trang nào là trang đó chưa có nội dung đã duyệt nên tự noindex),
// không URL trùng, mọi URL thuộc host canonical.
// Kiểm tĩnh không cần máy chủ (chạy trong CI cùng Vitest): apps/web/src/app/sitemap-integrity.spec.ts.
// Mã thoát: 0 không có FAIL (WARN vẫn 0, trừ --strict), 1 có FAIL, 2 sai tham số.
import { pathToFileURL } from 'node:url';
import { checkSitemapXml, evenSample, extractCanonical, extractMeta, hostProblem } from '../../cutover/verify-apex-cutover.mjs';

/** Phải trùng `LEGAL_SLUGS` của packages/app-core/src/legal-core.ts (spec của script giữ hai danh sách khớp nhau). */
export const LEGAL_SLUGS = ['dieu-khoan', 'bao-mat', 'doi-tra', 'van-chuyen', 'thanh-toan'];

const UA = 'tubutree-sitemap-guard/1';
const MAX_CHILD_SITEMAPS = 50;
const MAX_FAIL_LINES = 60;

const finding = (check, level, message) => ({ check, level, message });
const sample = (list) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} … (+${list.length - 3})` : list.join(', '));

// ---------------------------------------------------------------------------------------------------------------------------------
// robots.txt

/**
 * Luật của nhóm `User-agent: *` (nhiều nhóm `*` thì gộp). Dòng `User-agent` liền nhau mở chung một nhóm; dòng luật đầu tiên đóng phần
 * khai user-agent của nhóm đó. Trả `{ allow, disallow }` (đã bỏ chú thích, bỏ luật rỗng: `Disallow:` trống nghĩa là không chặn gì).
 */
export function parseRobots(text) {
  const allow = [];
  const disallow = [];
  let agents = [];
  let inRules = false;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }
    if (key !== 'allow' && key !== 'disallow') continue;
    inRules = true;
    if (!agents.includes('*') || value === '') continue;
    (key === 'allow' ? allow : disallow).push(value);
  }
  return { allow, disallow };
}

/** Luật robots (có `*` và `$` cuối như Google) thành RegExp neo ở đầu đường dẫn. */
function robotsPattern(rule) {
  const anchored = rule.endsWith('$');
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/**
 * `path` (kèm query) có bị robots chặn không: luật khớp dài nhất thắng, bằng nhau thì Allow thắng (quy tắc của Google).
 * Trả `{ allowed, rule }`, `rule` là luật quyết định (null khi không luật nào khớp).
 */
export function robotsVerdict(path, rules) {
  let best = null;
  for (const [kind, list] of [
    ['allow', rules.allow],
    ['disallow', rules.disallow],
  ]) {
    for (const rule of list) {
      if (!robotsPattern(rule).test(path)) continue;
      if (!best || rule.length > best.rule.length || (rule.length === best.rule.length && kind === 'allow')) best = { kind, rule };
    }
  }
  return { allowed: !best || best.kind === 'allow', rule: best ? `${best.kind === 'allow' ? 'Allow' : 'Disallow'}: ${best.rule}` : null };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// URL và tín hiệu của trang

const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** Hai URL tuyệt đối cùng host, cùng đường dẫn (bỏ qua `/` cuối) và cùng query. */
export function sameUrl(a, b) {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && trimSlash(x.pathname) === trimSlash(y.pathname) && x.search === y.search;
  } catch {
    return false;
  }
}

/** Nội dung thẻ meta robots hoặc header X-Robots-Tag có chặn lập chỉ mục không (`noindex` hay `none`, kể cả dạng `googlebot: noindex`). */
export const isNoindex = (value) =>
  String(value ?? '')
    .toLowerCase()
    .split(/[,\s]+/)
    .some((token) => token === 'noindex' || token === 'none' || token.endsWith(':noindex') || token.endsWith(':none'));

const PATH_KINDS = [
  ['legal', /^\/chinh-sach\/[^/]+$/],
  ['product', /^\/san-pham\/[^/]+$/],
  ['brand', /^\/brand\/[^/]+$/],
  ['storefront', /^\/s\/[^/]+$/],
  ['campaign', /^\/chien-dich\/[^/]+$/],
];

/** Loại URL của sitemap: home, legal, product, category, brand, storefront, campaign, static. */
export function kindOf(loc) {
  let url;
  try {
    url = new URL(loc);
  } catch {
    return 'static';
  }
  const path = trimSlash(url.pathname);
  if (path === '/' && !url.search) return 'home';
  if (path === '/san-pham' && url.searchParams.has('category')) return 'category';
  return PATH_KINDS.find(([, re]) => re.test(path))?.[0] ?? 'static';
}

/** Loại có thể có hàng trăm URL: `--max-per-kind` chỉ lấy mẫu ở các loại này. Trang chủ, trang tĩnh và chính sách luôn kiểm hết. */
export const SAMPLED_KINDS = ['product', 'category', 'brand', 'storefront', 'campaign'];

/**
 * Danh sách URL của sitemap: trùng, host lạ, thiếu trang chủ, thiếu trang chính sách. `legalSlugs` tiêm được để test.
 * Trả `{ counts, findings }`, `counts` theo loại (kindOf).
 */
export function analyzeLocs(locs, canonicalOrigin, { legalSlugs = LEGAL_SLUGS } = {}) {
  const findings = [];
  const counts = {};
  const seen = new Set();
  const duplicates = [];
  for (const loc of locs) {
    if (seen.has(loc)) duplicates.push(loc);
    seen.add(loc);
    const kind = kindOf(loc);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  const bad = locs.flatMap((loc) => {
    const reason = hostProblem(loc, canonicalOrigin);
    return reason ? [`${loc} (${reason})`] : [];
  });
  if (bad.length) findings.push(finding('sitemap', 'FAIL', `${bad.length} URL không thuộc ${new URL(canonicalOrigin).origin}: ${sample(bad)}`));
  if (!counts.home) findings.push(finding('sitemap', 'FAIL', 'không có trang chủ "/"'));
  if (duplicates.length) findings.push(finding('sitemap', 'WARN', `${duplicates.length} URL trùng: ${sample(duplicates)}`));

  const legalPaths = new Set(locs.filter((loc) => kindOf(loc) === 'legal').map((loc) => trimSlash(new URL(loc).pathname)));
  const missing = legalSlugs.filter((slug) => !legalPaths.has(`/chinh-sach/${slug}`));
  if (missing.length) {
    findings.push(
      finding(
        'legal',
        'FAIL',
        `thiếu ${missing.length}/${legalSlugs.length} trang chính sách: ${missing.map((s) => `/chinh-sach/${s}`).join(', ')} ` +
          '(chưa có nội dung đã duyệt ở admin nên trang tự noindex và sitemap bỏ; hồ sơ Bộ Công Thương cần đủ 5 trang)',
      ),
    );
  } else findings.push(finding('legal', 'PASS', `đủ ${legalSlugs.length} trang chính sách /chinh-sach/*`));
  return { counts, findings };
}

/**
 * Kiểm một trang của sitemap từ phản hồi đã tải. `res` = `{ status, headers, location, body }` (headers chữ thường).
 * Trả danh sách lỗi (chuỗi), rỗng khi đạt.
 */
export function pageProblems(loc, res, robots) {
  const problems = [];
  const url = new URL(loc);
  const verdict = robotsVerdict(url.pathname + url.search, robots);
  if (!verdict.allowed) problems.push(`robots.txt chặn (${verdict.rule})`);
  if (res.status === 0) return [...problems, `lỗi mạng (${res.error ?? 'không rõ'})`];
  if (res.status >= 300 && res.status < 400) return [...problems, `HTTP ${res.status} chuyển hướng → ${res.location ?? '(không có Location)'}; sitemap phải khai URL cuối`];
  if (res.status !== 200) return [...problems, `HTTP ${res.status}`];
  const header = res.headers?.['x-robots-tag'];
  if (isNoindex(Array.isArray(header) ? header.join(', ') : header)) problems.push(`X-Robots-Tag: ${header}`);
  const html = typeof res.body === 'string' ? res.body : String(res.body ?? '');
  for (const key of ['robots', 'googlebot']) {
    const meta = extractMeta(html, key);
    if (isNoindex(meta)) problems.push(`<meta name="${key}" content="${meta}">`);
  }
  const canonical = extractCanonical(html);
  if (!canonical) problems.push('không có <link rel="canonical">');
  else {
    let absolute = canonical;
    try {
      absolute = new URL(canonical, loc).href;
    } catch {
      // giữ nguyên để báo bên dưới
    }
    if (!sameUrl(absolute, loc)) problems.push(`canonical ${canonical} khác URL của sitemap`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Chạy thật

function makeRequester({ timeout = 20_000 } = {}) {
  return async (url) => {
    try {
      const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' }, signal: AbortSignal.timeout(timeout) });
      const headers = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]));
      const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
      return { status: res.status, headers, location: res.headers.get('location'), body };
    } catch (err) {
      return { status: 0, headers: {}, location: null, body: '', error: err instanceof Error ? err.message : String(err) };
    }
  };
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

const statusText = (res) => (res.status === 0 ? `lỗi mạng (${res.error ?? 'không rõ'})` : `HTTP ${res.status}`);

/** URL trên host canonical -> cùng đường dẫn + query trên `base` (chạy thử bản dựng cục bộ mà canonical vẫn là host thật). */
const onBase = (loc, base) => {
  const u = new URL(loc);
  return new URL(u.pathname + u.search, base).href;
};

/** Các URL sẽ tải: mọi trang chủ/trang tĩnh/chính sách, các loại nhiều trang lấy mẫu đều `maxPerKind` (0 = tất cả). Giữ thứ tự sitemap, bỏ trùng. */
export function pickLocs(locs, maxPerKind = 0) {
  const unique = [...new Set(locs)];
  if (!maxPerKind) return unique;
  const keep = new Set();
  const byKind = new Map();
  for (const loc of unique) {
    const kind = kindOf(loc);
    if (!SAMPLED_KINDS.includes(kind)) keep.add(loc);
    else byKind.set(kind, [...(byKind.get(kind) ?? []), loc]);
  }
  for (const list of byKind.values()) for (const loc of evenSample(list, maxPerKind)) keep.add(loc);
  return unique.filter((loc) => keep.has(loc));
}

/** Chạy trên `opts.base` (chỉ GET). `opts.request(url: string)` tiêm được để test. */
export async function runGuard(opts) {
  const base = new URL(opts.base).origin;
  const canonical = new URL(opts.canonical ?? base).origin;
  const request = opts.request ?? makeRequester(opts);
  const findings = [];

  const robotsRes = await request(new URL('/robots.txt', base).href);
  let robots = { allow: [], disallow: [] };
  if (robotsRes.status === 200) robots = parseRobots(robotsRes.body);
  else findings.push(finding('robots', 'WARN', `/robots.txt: ${statusText(robotsRes)} (coi như không chặn gì)`));

  const sitemapRes = await request(new URL('/sitemap.xml', base).href);
  if (sitemapRes.status !== 200) {
    findings.push(finding('sitemap', 'FAIL', `/sitemap.xml: ${statusText(sitemapRes)}`));
    return { base, canonical, counts: {}, checked: 0, findings };
  }
  const parsed = checkSitemapXml(String(sitemapRes.body));
  const errors = parsed.errors.map((e) => `/sitemap.xml: ${e}`);
  let locs = parsed.locs;
  if (parsed.root === 'sitemapindex') {
    locs = [];
    for (const child of parsed.locs.slice(0, MAX_CHILD_SITEMAPS)) {
      const sub = await request(onBase(child, base));
      const subParsed = sub.status === 200 ? checkSitemapXml(String(sub.body)) : { errors: [statusText(sub)], locs: [] };
      errors.push(...subParsed.errors.map((e) => `${child}: ${e}`));
      locs.push(...subParsed.locs);
    }
  }
  for (const e of errors.slice(0, 5)) findings.push(finding('sitemap', 'FAIL', e));
  const { counts, findings: locFindings } = analyzeLocs(locs, canonical, { legalSlugs: opts.legalSlugs ?? LEGAL_SLUGS });
  findings.push(...locFindings);

  const picked = pickLocs(locs, opts.maxPerKind ?? 0);
  const rows = await mapPool(picked, opts.concurrency ?? 4, async (loc) => {
    // URL host lạ đã FAIL ở trên; tải thử trên --base vẫn có ích (biết trang có tồn tại không) nên không bỏ.
    const res = await request(onBase(loc, base));
    return { loc, kind: kindOf(loc), problems: pageProblems(loc, res, robots) };
  });
  const failed = rows.filter((r) => r.problems.length);
  for (const r of failed.slice(0, MAX_FAIL_LINES)) {
    const u = new URL(r.loc);
    findings.push(finding('pages', 'FAIL', `${u.pathname}${u.search}: ${r.problems.join('; ')}`));
  }
  if (failed.length > MAX_FAIL_LINES) findings.push(finding('pages', 'FAIL', `… và ${failed.length - MAX_FAIL_LINES} URL hỏng khác`));
  const perKind = {};
  for (const r of rows) {
    perKind[r.kind] ??= { checked: 0, failed: 0 };
    perKind[r.kind].checked += 1;
    if (r.problems.length) perKind[r.kind].failed += 1;
  }
  const breakdown = Object.entries(perKind)
    .map(([kind, n]) => `${kind} ${n.checked - n.failed}/${n.checked}${counts[kind] > n.checked ? ` (mẫu trong ${counts[kind]})` : ''}`)
    .join(', ');
  findings.push(
    finding(
      'pages',
      failed.length ? 'FAIL' : 'PASS',
      `${rows.length - failed.length}/${rows.length} URL đạt (200, canonical trùng URL, không noindex, robots không chặn): ${breakdown || 'không có URL'}`,
    ),
  );
  return { base, canonical, counts, checked: rows.length, findings };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dòng lệnh

const HELP = `Dùng: node scripts/ci/sitemap-guard/index.mjs --base <url> [tuỳ chọn]
  --base <url>           Máy chủ web cần kiểm (vd http://localhost:3000, https://tubutree.com). Bắt buộc.
  --canonical <origin>   Host canonical mong đợi trong sitemap/canonical (mặc định = --base). Dùng khi chạy bản dựng cục bộ.
  --max-per-kind <n>     Lấy mẫu n URL mỗi loại nhiều trang (sản phẩm, danh mục, nhãn, gian hàng, chiến dịch). 0 = tất cả (mặc định).
  --concurrency <n>      Số yêu cầu song song (mặc định 4).
  --timeout <ms>         Hết giờ mỗi yêu cầu (mặc định 20000).
  --json                 In báo cáo JSON.
  --strict               WARN cũng làm mã thoát 1.
  --help                 In hướng dẫn này.`;

const originOf = (value, flag) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${flag} phải là URL tuyệt đối (đang là '${value}')`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${flag} phải là http(s) (đang là '${value}')`);
  return url.origin;
};

const intOf = (value, flag, min) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`${flag} phải là số nguyên >= ${min} (đang là '${value}')`);
  return n;
};

/** Tham số dòng lệnh -> tuỳ chọn của runGuard. Ném lỗi khi sai (mã thoát 2). */
export function parseArgs(argv) {
  const opts = { json: false, strict: false, help: false, maxPerKind: 0, concurrency: 4, timeout: 20_000 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    const value = () => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${flag} cần giá trị`);
      i += 1;
      return next;
    };
    if (flag === '--base') opts.base = originOf(value(), flag);
    else if (flag === '--canonical') opts.canonical = originOf(value(), flag);
    else if (flag === '--max-per-kind') opts.maxPerKind = intOf(value(), flag, 0);
    else if (flag === '--concurrency') opts.concurrency = intOf(value(), flag, 1);
    else if (flag === '--timeout') opts.timeout = intOf(value(), flag, 1);
    else if (flag === '--json') opts.json = true;
    else if (flag === '--strict') opts.strict = true;
    else if (flag === '--help' || flag === '-h') opts.help = true;
    else throw new Error(`tham số lạ: ${arg}`);
  }
  if (!opts.help && !opts.base) throw new Error('thiếu --base');
  return opts;
}

export function summarize(findings) {
  const count = (level) => findings.filter((f) => f.level === level).length;
  return { pass: count('PASS'), warn: count('WARN'), fail: count('FAIL') };
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
  const report = await runGuard(opts);
  const summary = summarize(report.findings);
  if (opts.json) console.log(JSON.stringify({ ...report, summary }, null, 2));
  else {
    const order = { FAIL: 0, WARN: 1, PASS: 2 };
    for (const f of [...report.findings].sort((a, b) => order[a.level] - order[b.level])) console.log(`${f.level.padEnd(4)}  [${f.check}] ${f.message}`);
    console.log(`\n${report.base}, canonical ${report.canonical}, ${report.checked} URL đã tải: ${summary.pass} PASS, ${summary.warn} WARN, ${summary.fail} FAIL`);
    if (summary.fail) console.log('KẾT LUẬN: CHƯA ĐẠT — sửa mọi FAIL trước khi nộp sitemap cho Google.');
    else if (summary.warn && opts.strict) console.log('KẾT LUẬN: CHƯA ĐẠT (--strict, còn WARN).');
    else console.log('KẾT LUẬN: ĐẠT.');
  }
  return summary.fail || (opts.strict && summary.warn) ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
