#!/usr/bin/env node
// Kiểm D-Day cho cutover apex tubutree.com: MỘT lệnh, chỉ ĐỌC (GET/HEAD công khai, không ghi gì, không đăng nhập). Node >= 22.18 (nạp thẳng .ts của bảng chuyển hướng).
//
//   # Sau khi đổi DNS (hoặc trước đó, nhắm thẳng IP VPS như curl --resolve):
//   node scripts/cutover/verify-apex-cutover.mjs --base https://tubutree.com
//   node scripts/cutover/verify-apex-cutover.mjs --base https://tubutree.com --resolve-ip 14.225.207.177
//   # Trước D-Day, không gọi mạng: bảng chuyển hướng, vhost Apache, header của next.config, robots/sitemap của bản dựng web trong apps/web/.next:
//   node scripts/cutover/verify-apex-cutover.mjs --dry-run
//   # Diễn tập trên bản dựng chạy cục bộ (next start) mà canonical vẫn là host thật của bản dựng:
//   node scripts/cutover/verify-apex-cutover.mjs --base http://localhost:3122 --canonical https://app.tubutree.com
//
// Nhóm kiểm (bỏ nhóm bằng --skip a,b):
//   redirects  URL WordPress cũ (bảng luật + scripts/ops/data/wp-live-urls-20261114.txt): 301 một chặng tới đích trả 2xx, 410 đúng chỗ, 0 vòng lặp, 0 đích 404.
//   robots     /robots.txt: 200, có Sitemap trỏ đúng host canonical, chặn /admin, không chặn cả site.
//   sitemap    /sitemap.xml: XML hợp lệ, gốc urlset/sitemapindex đúng xmlns, có sản phẩm + danh mục (+ /chien-dich/*: WARN nếu không có chiến dịch nào chạy),
//              0 URL localhost/staging/host khác canonical.
//   pages      Trang chủ, /san-pham và vài trang sản phẩm lấy từ sitemap: 200, canonical + og:url đúng host, Product JSON-LD đúng host, giá VND,
//              AggregateRating chỉ khi reviewCount >= 1; header bảo mật (HSTS khi https, nosniff, chống nhúng khung, Referrer/Permissions-Policy, CSP).
//   img        Ảnh /api/img lấy từ chính HTML trang sản phẩm: Accept avif -> 200 AVIF hoặc WebP, Accept chỉ webp -> 200 WebP (đúng chữ ký tệp), Vary: Accept, cache dài.
//   edge       http:// -> https:// và www. -> apex bằng 301/308 (chỉ khi --base là https trên tên miền thật).
// Mã thoát: 0 không có FAIL (WARN vẫn 0, trừ --strict), 1 có FAIL, 2 sai tham số.
// Node in cảnh báo ExperimentalWarning khi nạp tệp .ts: vô hại.
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkRuleTableOffline, classifyChain, defaultInventory, expectedFor, isRedirectStatus, toPathAndSearch } from '../ops/check-cutover-redirects.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_BASE = 'https://tubutree.com';
const DEFAULT_URLS = 'scripts/ops/data/wp-live-urls-20261114.txt';
const DEFAULT_VHOST = 'ops/vietnix-vhost-apex.conf.cutover';
const DEFAULT_BUILD = 'apps/web/.next';
const TABLE_FILE = 'apps/web/src/lib/legacy-wp-redirects.ts';
const NEXT_CONFIG = 'apps/web/next.config.mjs';
const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
const MAX_HOPS = 6;
const HSTS_MIN_SECONDS = 15_552_000;
const UA = 'tubutree-cutover-verify/1';
const CHECKS = ['redirects', 'robots', 'sitemap', 'pages', 'img', 'edge'];

const finding = (check, level, message) => ({ check, level, message });
const trimSlash = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
const sample = (list) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} … (+${list.length - 3})` : list.join(', '));

// ---------------------------------------------------------------------------------------------------------------------------------
// Host

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$|\.(?:local|localhost|internal|lan)$/i;
const STAGING_HOST = /(?:^|[.-])(?:staging|stage|stg|dev|test|uat|preview|sandbox|demo)(?:[.-]|$)|\.(?:vercel\.app|netlify\.app|pages\.dev|trycloudflare\.com|ngrok(?:-free)?\.(?:io|app|dev))$/i;
const IP_HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\])$/i;

/** Host cục bộ/nội bộ hoặc staging (không bao giờ được lọt vào sitemap, canonical hay robots của site thật). */
export const isLocalOrStagingHost = (host) => LOCAL_HOST.test(host) || STAGING_HOST.test(host);

/** Lý do một URL không thuộc host canonical (vd `https://tubutree.com`), hoặc null khi đúng host. */
export function hostProblem(raw, canonicalOrigin) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return 'không phải URL tuyệt đối';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return `giao thức lạ (${url.protocol})`;
  const canonical = new URL(canonicalOrigin).origin;
  if (url.origin === canonical) return null;
  if (LOCAL_HOST.test(url.hostname)) return `host cục bộ/nội bộ (${url.host})`;
  if (STAGING_HOST.test(url.hostname)) return `host staging/thử nghiệm (${url.host})`;
  return `khác host canonical (${url.origin}, mong ${canonical})`;
}

/** Mọi URL không thuộc host canonical, kèm lý do. */
export function findBadHosts(urls, canonicalOrigin) {
  return urls.flatMap((url) => {
    const reason = hostProblem(url, canonicalOrigin);
    return reason ? [{ url, reason }] : [];
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// XML sitemap

const XML_ENTITY = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/y;
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) =>
  s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : NAMED[e],
  );

/** Vị trí `&` không mở một thực thể XML hợp lệ trong `s`, hoặc -1. */
function badAmpersand(s) {
  for (let i = s.indexOf('&'); i >= 0; i = s.indexOf('&', i + 1)) {
    XML_ENTITY.lastIndex = i;
    if (!XML_ENTITY.test(s)) return i;
  }
  return -1;
}

const W3C_DATETIME = /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?)?)?$/;
const OPEN_TAG = /<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
const CLOSE_TAG = /<\/([A-Za-z_][\w:.-]*)\s*>/y;
const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
const MAX_URLS = 50_000;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_ERRORS = 20;

/**
 * Kiểm một sitemap là XML hợp lệ (thẻ cân, một phần tử gốc, thực thể đúng, không "<" lạc) và đúng cấu trúc sitemaps.org (gốc urlset hoặc
 * sitemapindex có xmlns chuẩn, mỗi <url>/<sitemap> đúng một <loc>, tối đa 50.000 URL / 50 MB). Không dùng thư viện XML: đủ cho đầu ra của Next.
 * Trả `{ errors, warnings, locs, root }`; `locs` đã giải thực thể.
 */
export function checkSitemapXml(xml) {
  const errors = [];
  const warnings = [];
  const locs = [];
  if (typeof xml !== 'string' || xml.trim() === '') return { errors: ['tài liệu rỗng'], warnings, locs, root: null };
  if (Buffer.byteLength(xml, 'utf8') > MAX_BYTES) errors.push('lớn hơn 50 MB (giới hạn của sitemap)');
  const s = xml.replace(/^﻿/, '');
  const stack = [];
  let root = null;
  let rootClosed = false;
  let pos = 0;
  let entryLocs = 0;
  let entryIndex = 0;
  let text = '';
  const fail = (msg) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };
  const entryTag = () => (root === 'sitemapindex' ? 'sitemap' : 'url');

  while (pos < s.length && errors.length < MAX_ERRORS) {
    const lt = s.indexOf('<', pos);
    const chunk = lt < 0 ? s.slice(pos) : s.slice(pos, lt);
    if (chunk) {
      if (stack.length === 0 && chunk.trim() !== '') fail(`chữ nằm ngoài phần tử gốc ở vị trí ${pos}`);
      const amp = badAmpersand(chunk);
      if (amp >= 0) fail(`"&" không phải thực thể XML ở vị trí ${pos + amp}`);
      text += chunk;
    }
    if (lt < 0) break;
    pos = lt;
    if (s.startsWith('<?', pos)) {
      const end = s.indexOf('?>', pos);
      if (end < 0) {
        fail('khai báo <?…?> không đóng');
        break;
      }
      if (/^<\?xml[\s?]/i.test(s.slice(pos, pos + 6)) && s.slice(0, pos).trim() !== '') fail('khai báo <?xml?> không đứng đầu tài liệu');
      pos = end + 2;
      continue;
    }
    if (s.startsWith('<!--', pos)) {
      const end = s.indexOf('-->', pos + 4);
      if (end < 0) {
        fail('chú thích <!-- không đóng');
        break;
      }
      pos = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', pos)) {
      const end = s.indexOf(']]>', pos);
      if (end < 0) {
        fail('CDATA không đóng');
        break;
      }
      if (stack.length === 0) fail('CDATA nằm ngoài phần tử gốc');
      text += s.slice(pos + 9, end);
      pos = end + 3;
      continue;
    }
    if (/^<!DOCTYPE/i.test(s.slice(pos, pos + 9))) {
      fail('có <!DOCTYPE> (trang HTML hoặc XML có DTD), không phải sitemap');
      const end = s.indexOf('>', pos);
      pos = end < 0 ? s.length : end + 1;
      continue;
    }
    CLOSE_TAG.lastIndex = pos;
    const close = CLOSE_TAG.exec(s);
    if (close) {
      const name = close[1];
      const top = stack.pop();
      if (top !== name) {
        fail(`thẻ đóng </${name}> không khớp <${top ?? '(không có)'}>`);
        break;
      }
      if (name === 'loc' && stack.length === 2 && stack[1] === entryTag()) locs.push(decodeXml(text.trim()));
      if (name === 'lastmod' && !W3C_DATETIME.test(text.trim())) warnings.push(`lastmod sai định dạng W3C: ${text.trim().slice(0, 40)}`);
      if (name === entryTag() && stack.length === 1) {
        entryIndex += 1;
        if (entryLocs !== 1) fail(`<${name}> thứ ${entryIndex} có ${entryLocs} <loc> (phải đúng 1)`);
      }
      if (stack.length === 0) rootClosed = true;
      text = '';
      pos = CLOSE_TAG.lastIndex;
      continue;
    }
    OPEN_TAG.lastIndex = pos;
    const open = OPEN_TAG.exec(s);
    if (!open) {
      fail(`dấu "<" lạc ở vị trí ${pos}`);
      break;
    }
    const [, name, attrs, selfClose] = open;
    if (badAmpersand(attrs) >= 0) fail(`"&" không phải thực thể XML trong thuộc tính của <${name}>`);
    if (stack.length === 0) {
      if (root !== null || rootClosed) {
        fail(`nhiều phần tử gốc (<${name}> sau </${root}>)`);
        break;
      }
      root = name;
      if (name !== 'urlset' && name !== 'sitemapindex') fail(`phần tử gốc là <${name}>, phải là <urlset> hoặc <sitemapindex>`);
      const ns = [...attrs.matchAll(ATTR)].find((m) => m[1] === 'xmlns');
      if (!ns || (ns[3] ?? ns[4]) !== SITEMAP_NS) fail(`<${name}> thiếu xmlns="${SITEMAP_NS}"`);
    }
    if (stack.length === 1 && name === entryTag()) entryLocs = 0;
    if (name === 'loc' && stack.length === 2 && stack[1] === entryTag()) entryLocs += 1;
    text = '';
    if (!selfClose) stack.push(name);
    else if (stack.length === 0) rootClosed = true;
    pos = OPEN_TAG.lastIndex;
  }
  if (stack.length > 0 && errors.length === 0) fail(`thẻ chưa đóng: <${stack.join('> <')}>`);
  if (root === null && errors.length === 0) fail('không có phần tử gốc');
  if (locs.length > MAX_URLS) fail(`${locs.length} URL, quá 50.000 (phải tách sitemapindex)`);
  return { errors, warnings, locs, root };
}

const PRODUCT_PATH = /^\/san-pham\/[^/?#]+\/?$/;
const CAMPAIGN_PATH = /^\/chien-dich\/[^/?#]+\/?$/;
const isProductUrl = (loc) => {
  try {
    return PRODUCT_PATH.test(new URL(loc).pathname);
  } catch {
    return false;
  }
};

/** Phân loại URL của sitemap theo đường dẫn (bất kể host) và xếp FAIL/WARN: thiếu sản phẩm/danh mục, URL host lạ, trùng, thiếu chiến dịch. */
export function analyzeSitemap(locs, canonicalOrigin) {
  const findings = [];
  const counts = { total: locs.length, products: 0, categories: 0, campaigns: 0 };
  const seen = new Set();
  const duplicates = [];
  let home = false;
  for (const loc of locs) {
    if (seen.has(loc)) duplicates.push(loc);
    seen.add(loc);
    let url;
    try {
      url = new URL(loc);
    } catch {
      continue;
    }
    if (url.pathname === '/' && !url.search) home = true;
    if (PRODUCT_PATH.test(url.pathname)) counts.products += 1;
    else if (url.pathname === '/san-pham' && url.searchParams.get('category')) counts.categories += 1;
    else if (CAMPAIGN_PATH.test(url.pathname)) counts.campaigns += 1;
  }
  const bad = findBadHosts(locs, canonicalOrigin);
  if (bad.length) findings.push(finding('sitemap', 'FAIL', `${bad.length} URL không thuộc ${new URL(canonicalOrigin).origin}: ${sample(bad.map((b) => `${b.url} (${b.reason})`))}`));
  if (counts.products === 0) findings.push(finding('sitemap', 'FAIL', 'không có trang sản phẩm /san-pham/<slug> nào'));
  if (counts.categories === 0) findings.push(finding('sitemap', 'FAIL', 'không có trang danh mục /san-pham?category=<id> nào'));
  if (counts.campaigns === 0) findings.push(finding('sitemap', 'WARN', 'không có /chien-dich/* (đúng nếu không có chiến dịch nào đang chạy có trang riêng; kiểm ở admin)'));
  if (!home) findings.push(finding('sitemap', 'WARN', 'không có trang chủ "/"'));
  if (duplicates.length) findings.push(finding('sitemap', 'WARN', `${duplicates.length} URL trùng: ${sample(duplicates)}`));
  if (!findings.some((f) => f.level === 'FAIL')) {
    findings.push(finding('sitemap', 'PASS', `${counts.total} URL: ${counts.products} sản phẩm, ${counts.categories} danh mục, ${counts.campaigns} chiến dịch, đúng host`));
  }
  return { counts, findings };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// robots.txt, header, HTML

/** robots.txt: có Sitemap đúng host canonical, chặn /admin, không có `Disallow: /` (chặn cả site). */
export function checkRobots(text, canonicalOrigin) {
  const findings = [];
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim());
  const sitemaps = lines.filter((l) => /^sitemap\s*:/i.test(l)).map((l) => l.replace(/^sitemap\s*:\s*/i, ''));
  if (sitemaps.length === 0) findings.push(finding('robots', 'FAIL', 'thiếu dòng Sitemap:'));
  for (const url of sitemaps) {
    const reason = hostProblem(url, canonicalOrigin);
    if (reason) findings.push(finding('robots', 'FAIL', `Sitemap: ${url} — ${reason}`));
    else if (new URL(url).pathname !== '/sitemap.xml') findings.push(finding('robots', 'WARN', `Sitemap trỏ ${url}, không phải /sitemap.xml`));
  }
  if (lines.some((l) => /^disallow\s*:\s*\/$/i.test(l))) findings.push(finding('robots', 'FAIL', 'có "Disallow: /" — chặn toàn bộ site khỏi công cụ tìm kiếm'));
  if (!lines.some((l) => /^disallow\s*:\s*\/admin\/?$/i.test(l))) findings.push(finding('robots', 'FAIL', 'không chặn /admin'));
  if (!findings.some((f) => f.level === 'FAIL')) findings.push(finding('robots', 'PASS', `Sitemap ${sitemaps.join(', ')}; chặn /admin`));
  return findings;
}

const headerOf = (headers, name) => {
  const v = headers?.[name] ?? headers?.[name.toLowerCase()];
  return Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : undefined;
};

/** Header bảo mật của một trang HTML. `https` = trang phục vụ qua https (khi đó bắt buộc HSTS). `where` ghi vào lời báo. */
export function checkSecurityHeaders(headers, { https: isHttps, where = '', check = 'headers' } = {}) {
  const findings = [];
  const at = where ? `${where}: ` : '';
  const hsts = headerOf(headers, 'strict-transport-security');
  if (isHttps) {
    if (!hsts) findings.push(finding(check, 'FAIL', `${at}thiếu Strict-Transport-Security`));
    else {
      const maxAge = Number(/max-age\s*=\s*"?(\d+)/i.exec(hsts)?.[1] ?? 0);
      if (maxAge < HSTS_MIN_SECONDS) findings.push(finding(check, 'WARN', `${at}Strict-Transport-Security max-age=${maxAge} (< ${HSTS_MIN_SECONDS}, 180 ngày)`));
    }
  }
  if ((headerOf(headers, 'x-content-type-options') ?? '').toLowerCase() !== 'nosniff') findings.push(finding(check, 'FAIL', `${at}thiếu X-Content-Type-Options: nosniff`));
  const xfo = (headerOf(headers, 'x-frame-options') ?? '').toUpperCase();
  const csp = headerOf(headers, 'content-security-policy') ?? '';
  if (xfo !== 'DENY' && xfo !== 'SAMEORIGIN' && !/frame-ancestors/i.test(csp)) {
    findings.push(finding(check, 'FAIL', `${at}thiếu chống nhúng khung (X-Frame-Options DENY/SAMEORIGIN hoặc CSP frame-ancestors)`));
  }
  if (!headerOf(headers, 'referrer-policy')) findings.push(finding(check, 'WARN', `${at}thiếu Referrer-Policy`));
  if (!headerOf(headers, 'permissions-policy')) findings.push(finding(check, 'WARN', `${at}thiếu Permissions-Policy`));
  if (!csp && !headerOf(headers, 'content-security-policy-report-only')) findings.push(finding(check, 'WARN', `${at}thiếu Content-Security-Policy (cả bản Report-Only)`));
  if (headerOf(headers, 'x-powered-by')) findings.push(finding(check, 'WARN', `${at}lộ X-Powered-By: ${headerOf(headers, 'x-powered-by')}`));
  if (findings.length === 0) findings.push(finding(check, 'PASS', `${at}đủ header bảo mật${isHttps ? ' (gồm HSTS)' : ''}`));
  return findings;
}

const decodeHtmlAttr = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attrsOf = (tag) =>
  Object.fromEntries([...tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), decodeHtmlAttr(m[2] ?? m[3] ?? '')]));

/** href của `<link rel="canonical">` đầu tiên, hoặc null. */
export function extractCanonical(html) {
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if ((a.rel ?? '').toLowerCase().split(/\s+/).includes('canonical') && a.href) return a.href;
  }
  return null;
}

/** content của `<meta property|name="...">` đầu tiên, hoặc null. */
export function extractMeta(html, key) {
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    if ((a.property ?? a.name) === key && a.content !== undefined) return a.content;
  }
  return null;
}

/** Các khối JSON-LD đọc được, `@graph` trải phẳng (khối hỏng bị bỏ). */
export function extractJsonLd(html) {
  return [...String(html).matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((m) => {
    try {
      const data = JSON.parse(m[1]);
      return Array.isArray(data?.['@graph']) ? data['@graph'] : [data];
    } catch {
      return [];
    }
  });
}

/**
 * URL ảnh đổi cỡ (`…/img?…&u=…`) trong src/srcset của `<img>`, `<source>`, `<link>`, đã giải &amp;, theo thứ tự xuất hiện, không trùng.
 * `pageUrl` (tuỳ chọn) để giải đường dẫn tương đối; không có thì chỉ lấy URL tuyệt đối.
 */
export function extractImgUrls(html, pageUrl) {
  const out = [];
  for (const m of String(html).matchAll(/<(?:img|source|link)\b[^>]*>/gi)) {
    const a = attrsOf(m[0]);
    for (const key of ['srcset', 'imagesrcset', 'src']) {
      if (!a[key]) continue;
      const candidates = key === 'src' ? [a[key]] : a[key].split(',').map((part) => part.trim().split(/\s+/)[0]);
      for (const c of candidates) {
        try {
          const u = pageUrl ? new URL(c, pageUrl) : new URL(c);
          if (/\/img$/.test(u.pathname) && u.searchParams.has('u') && !out.includes(u.href)) out.push(u.href);
        } catch {
          /* đường dẫn tương đối khi không có pageUrl: không phải ảnh đổi cỡ đọc được */
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Chuyển hướng

/**
 * Đi theo chuyển hướng bằng tay từ `path+search` trên `base`, dùng `request(url) -> { status, location }` (tiêm được để test). Trả `{ steps, flags }`
 * cùng dạng `classifyChain` của scripts/ops/check-cutover-redirects.mjs: `loop` khi gặp lại một URL đã đi, `tooMany` khi quá `maxHops`, `external`
 * khi chuyển sang origin khác (không đi theo sang host lạ).
 */
export async function followRedirects({ base, path: start, search = '', request, maxHops = MAX_HOPS }) {
  const baseUrl = new URL(base);
  const steps = [];
  const seen = new Set();
  let current = new URL(start + search, baseUrl);
  for (let i = 0; i <= maxHops; i += 1) {
    if (seen.has(current.href)) return { steps, flags: { loop: true } };
    seen.add(current.href);
    const res = await request(current);
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

/** Vòng lặp ngay trong bảng luật: đi theo đích (cùng origin) của từng nguồn; mỗi vòng trả một lần, dạng `[a, b, …, a]`. */
export function findRuleCycles(resolve, sources, maxDepth = 20) {
  const cycles = [];
  const keys = new Set();
  for (const source of sources) {
    const trail = [trimSlash(source)];
    let current = source;
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const r = resolve(current);
      if (!r || r.kind !== 'redirect' || /^[a-z][a-z0-9+.-]*:/i.test(r.location) || r.location.startsWith('//')) break;
      const target = toPathAndSearch(r.location);
      if (!target) break;
      const next = trimSlash(target.path);
      const at = trail.indexOf(next);
      if (at >= 0) {
        const cycle = [...trail.slice(at), next];
        const key = [...new Set(cycle)].sort().join('|');
        if (!keys.has(key)) {
          keys.add(key);
          cycles.push(cycle);
        }
        break;
      }
      trail.push(next);
      current = target.path;
    }
  }
  return cycles;
}

function redirectSources(table) {
  return [
    ...Object.keys(table.LEGACY_PAGE_REDIRECTS ?? {}),
    ...Object.keys(table.LEGACY_FILE_REDIRECTS ?? {}),
    ...Object.keys(table.LEGACY_PRODUCT_REDIRECTS ?? {}).map((slug) => `/product/${slug}`),
  ];
}

function readUrlList(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map(toPathAndSearch)
    .filter(Boolean);
}

function uniqueInputs(list) {
  const seen = new Set();
  return list.filter((u) => {
    const key = u.path + u.search;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Lấy đều `n` phần tử (giữ đầu và cuối) để mẫu phủ cả trang, sản phẩm lẫn blog; n = 0 thì lấy hết. */
export function evenSample(list, n) {
  if (!n || n >= list.length) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * (list.length - 1)) / Math.max(1, n - 1))]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// vhost Apache

/** Kiểm tĩnh vhost apex (ops/vietnix-vhost-apex.conf.cutover): host, HSTS, http/www -> https apex, uploads trước ProxyPass /, Next ở 127.0.0.1. */
export function checkApexVhost(text) {
  const findings = [];
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const conf = lines.join('\n');
  const names = lines.filter((l) => /^Server(Name|Alias)\s/i.test(l)).flatMap((l) => l.split(/\s+/).slice(1));
  if (!names.includes('tubutree.com')) findings.push(finding('vhost', 'FAIL', 'không có ServerName tubutree.com'));
  const odd = names.filter((n) => isLocalOrStagingHost(n));
  if (odd.length) findings.push(finding('vhost', 'FAIL', `ServerName/ServerAlias có host cục bộ/staging: ${odd.join(', ')}`));
  if (!/^Header\s+always\s+set\s+Strict-Transport-Security\s+"?max-age=\d+/im.test(conf)) findings.push(finding('vhost', 'FAIL', 'thiếu Header always set Strict-Transport-Security'));
  if (!/^RewriteRule\s+\S+\s+https:\/\/tubutree\.com\$1\s+\[[^\]]*R=301/im.test(conf)) {
    findings.push(finding('vhost', 'FAIL', 'thiếu chuyển http:// và www về https://tubutree.com (RewriteRule … [R=301])'));
  }
  const uploadsAt = lines.findIndex((l) => /^ProxyPass\s+\/wp-content\/uploads\/\s+!$/.test(l));
  const rootAt = lines.findIndex((l) => /^ProxyPass\s+\/\s+\S+/.test(l));
  if (rootAt < 0) findings.push(finding('vhost', 'FAIL', 'không có ProxyPass / (web Next)'));
  else {
    const target = lines[rootAt].split(/\s+/)[2] ?? '';
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(target)) findings.push(finding('vhost', 'FAIL', `ProxyPass / phải trỏ web Next ở http://127.0.0.1:<cổng>/, đang là ${target}`));
    if (uploadsAt < 0) findings.push(finding('vhost', 'FAIL', 'thiếu "ProxyPass /wp-content/uploads/ !" (ảnh WordPress phục vụ từ đĩa)'));
    else if (uploadsAt > rootAt) findings.push(finding('vhost', 'FAIL', '"ProxyPass /wp-content/uploads/ !" phải đứng TRƯỚC "ProxyPass /" (Apache lấy luật khớp đầu tiên)'));
  }
  for (const l of lines.filter((x) => /^ProxyPass\s/.test(x))) {
    const target = l.split(/\s+/)[2] ?? '';
    if (target !== '!' && !/^https?:\/\/127\.0\.0\.1[:/]/.test(target)) findings.push(finding('vhost', 'WARN', `ProxyPass tới host ngoài máy: ${l}`));
  }
  if (!findings.some((f) => f.level === 'FAIL')) findings.push(finding('vhost', 'PASS', 'ServerName tubutree.com, HSTS, http/www → https apex 301, uploads trước ProxyPass /, Next ở 127.0.0.1'));
  return findings;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Tham số

const HELP = `Dùng: node scripts/cutover/verify-apex-cutover.mjs [tuỳ chọn]

Kiểm D-Day cutover apex (chỉ đọc). Mặc định chạy thật trên ${DEFAULT_BASE}.

Tuỳ chọn:
  --base URL          host cần kiểm (mặc định ${DEFAULT_BASE}); chỉ lấy origin
  --canonical URL     host canonical mà sitemap/canonical/robots phải dùng (mặc định = --base; --dry-run mặc định ${DEFAULT_BASE})
  --resolve-ip IP     kết nối tới IP này nhưng giữ Host/SNI của --base (như curl --resolve), áp cho host của --base và www.<host>
  --dry-run           không gọi mạng: bảng chuyển hướng, vhost, header next.config, robots/sitemap trong bản dựng web
  --no-build          (dry-run) bỏ phần bản dựng web
  --build-dir DIR     (dry-run) thư mục bản dựng Next (mặc định ${DEFAULT_BUILD})
  --vhost FILE        (dry-run) vhost Apache của apex (mặc định ${DEFAULT_VHOST})
  --urls FILE         danh sách URL WordPress cũ, mỗi dòng một URL/đường dẫn (mặc định ${DEFAULT_URLS})
  --sample N          chỉ kiểm N URL chuyển hướng lấy đều trong danh sách (mặc định 0 = tất cả)
  --pages N           số trang sản phẩm lấy từ sitemap để kiểm canonical/JSON-LD/header (mặc định 5; 0 = không kiểm trang sản phẩm)
  --skip LIST         bỏ nhóm kiểm, cách nhau bằng dấu phẩy: ${CHECKS.join(',')}
  --concurrency N     số request song song (mặc định 4)
  --timeout MS        thời gian chờ mỗi request (mặc định 15000)
  --strict            WARN cũng làm thoát mã 1
  --json              in kết quả dạng JSON
  -h, --help          in trợ giúp này
Mã thoát: 0 không có FAIL, 1 có FAIL, 2 sai tham số.`;

const originOf = (value, flag) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${flag} không phải URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${flag} phải là http(s): ${value}`);
  return url.origin;
};

export function parseArgs(argv) {
  const opts = {
    base: DEFAULT_BASE,
    canonical: '',
    resolveIp: '',
    dryRun: false,
    build: true,
    buildDir: DEFAULT_BUILD,
    vhost: DEFAULT_VHOST,
    urls: DEFAULT_URLS,
    sample: 0,
    pages: 5,
    skip: [],
    concurrency: 4,
    timeout: 15000,
    strict: false,
    json: false,
    help: false,
  };
  const takes = new Set(['--base', '--canonical', '--resolve-ip', '--build-dir', '--vhost', '--urls', '--sample', '--pages', '--skip', '--concurrency', '--timeout']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-build') opts.build = false;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--json') opts.json = true;
    else if (takes.has(arg)) {
      i += 1;
      const value = argv[i];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} cần một giá trị`);
      if (arg === '--base') opts.base = originOf(value, arg);
      else if (arg === '--canonical') opts.canonical = originOf(value, arg);
      else if (arg === '--resolve-ip') opts.resolveIp = value;
      else if (arg === '--build-dir') opts.buildDir = value;
      else if (arg === '--vhost') opts.vhost = value;
      else if (arg === '--urls') opts.urls = value;
      else if (arg === '--skip') {
        opts.skip = value.split(',').map((s) => s.trim()).filter(Boolean);
        const unknown = opts.skip.filter((s) => !CHECKS.includes(s));
        if (unknown.length) throw new Error(`--skip không biết nhóm: ${unknown.join(', ')} (có: ${CHECKS.join(', ')})`);
      } else {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) throw new Error(`${arg} cần số nguyên không âm`);
        if (arg === '--sample') opts.sample = n;
        else if (arg === '--pages') opts.pages = n;
        else if (arg === '--concurrency') opts.concurrency = Math.max(1, n);
        else opts.timeout = Math.max(1, n);
      }
    } else throw new Error(`Tham số lạ: ${arg}`);
  }
  if (!opts.canonical) opts.canonical = opts.dryRun ? DEFAULT_BASE : opts.base;
  return opts;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dry-run (không gọi mạng)

async function loadTable(root) {
  const file = path.join(root, TABLE_FILE);
  try {
    return await import(pathToFileURL(file).href);
  } catch (err) {
    throw new Error(`Không nạp được ${file} (cần Node >= 22.18 để chạy thẳng .ts): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Bảng luật không gọi mạng: lỗi của từng luật (checkRuleTableOffline trên bảng + danh sách URL WordPress) + vòng lặp. */
function redirectTableFindings(table, root, urlsFile) {
  const findings = [];
  const fromTable = checkRuleTableOffline(table, defaultInventory(table), { requireRule: true });
  const listFile = path.resolve(root, urlsFile);
  const hasList = existsSync(listFile);
  if (!hasList) findings.push(finding('redirects', 'WARN', `không thấy danh sách URL ${urlsFile}`));
  const fromList = hasList ? checkRuleTableOffline(table, uniqueInputs(readUrlList(listFile)), { requireRule: false }) : [];
  const rows = [...fromTable, ...fromList];
  const failed = rows.filter((r) => r.verdict === 'FAIL');
  for (const r of failed.slice(0, 15)) findings.push(finding('redirects', 'FAIL', `${r.path}${r.search}: ${r.reason}`));
  if (failed.length > 15) findings.push(finding('redirects', 'FAIL', `… và ${failed.length - 15} URL hỏng khác`));
  const cycles = findRuleCycles(table.resolveLegacyWpPath, [...redirectSources(table), ...rows.map((r) => r.path)]);
  for (const c of cycles) findings.push(finding('redirects', 'FAIL', `vòng lặp trong bảng luật: ${c.join(' → ')}`));
  if (!failed.length && !cycles.length) {
    const pass = rows.filter((r) => r.verdict === 'PASS').length;
    findings.push(finding('redirects', 'PASS', `bảng luật: ${rows.length} URL (${pass} PASS, ${rows.length - pass} bỏ qua), 0 vòng lặp, 0 chuỗi 2 chặng, mọi đích cùng origin`));
  }
  return findings;
}

async function nextHeaderFindings(root, nextConfig) {
  let config = nextConfig;
  if (!config) {
    try {
      config = (await import(pathToFileURL(path.join(root, NEXT_CONFIG)).href)).default;
    } catch (err) {
      return [finding('headers', 'WARN', `không nạp được ${NEXT_CONFIG}: ${err instanceof Error ? err.message : String(err)}`)];
    }
  }
  const rules = typeof config.headers === 'function' ? await config.headers() : [];
  const main = rules.find((r) => r.headers?.some((h) => h.key.toLowerCase() === 'x-frame-options'));
  if (!main) return [finding('headers', 'FAIL', `${NEXT_CONFIG}: không có nhóm header chung có X-Frame-Options`)];
  const headers = Object.fromEntries(main.headers.map((h) => [h.key.toLowerCase(), h.value]));
  // HSTS do Apache đặt (vhost), không đặt ở Next: kiểm như http.
  const findings = checkSecurityHeaders(headers, { https: false, where: `${NEXT_CONFIG} (${main.source})` });
  if (config.poweredByHeader !== false) findings.push(finding('headers', 'WARN', `${NEXT_CONFIG}: poweredByHeader chưa tắt (lộ X-Powered-By)`));
  return findings;
}

function buildFindings(root, buildDir, canonical) {
  const dir = path.resolve(root, buildDir, 'server/app');
  const robotsFile = path.join(dir, 'robots.txt.body');
  const sitemapFile = path.join(dir, 'sitemap.xml.body');
  if (!existsSync(robotsFile) && !existsSync(sitemapFile)) {
    return [finding('build', 'WARN', `chưa có bản dựng web ở ${buildDir} (chạy next build với NEXT_PUBLIC_SITE_URL=${canonical} rồi dry-run lại, hoặc --no-build)`)];
  }
  const findings = [];
  if (existsSync(robotsFile)) {
    for (const f of checkRobots(readFileSync(robotsFile, 'utf8'), canonical)) findings.push({ ...f, check: 'build', message: `robots.txt dựng sẵn: ${f.message}` });
  }
  if (existsSync(sitemapFile)) {
    const { errors, locs } = checkSitemapXml(readFileSync(sitemapFile, 'utf8'));
    for (const e of errors.slice(0, 5)) findings.push(finding('build', 'FAIL', `sitemap.xml dựng sẵn: ${e}`));
    const bad = findBadHosts(locs, canonical);
    if (bad.length) {
      findings.push(finding('build', 'FAIL', `sitemap.xml dựng sẵn: ${bad.length}/${locs.length} URL không thuộc ${canonical} (${bad[0].reason}) — bản dựng chưa đặt NEXT_PUBLIC_SITE_URL=${canonical}`));
    } else if (!errors.length) {
      // Lúc build không gọi được API nên sitemap dựng sẵn có thể chỉ có trang tĩnh; sản phẩm/danh mục có sau lần dựng lại theo revalidate trên máy thật.
      findings.push(finding('build', 'PASS', `sitemap.xml dựng sẵn: XML hợp lệ, ${locs.length} URL đều thuộc ${canonical}`));
    }
  }
  return findings;
}

/** Dry-run: không gọi mạng. `opts.table` / `opts.nextConfig` / `opts.root` tiêm được để test. */
export async function runDryRun(opts) {
  const root = opts.root ?? REPO_ROOT;
  const table = opts.table ?? (await loadTable(root));
  const canonical = opts.canonical ?? DEFAULT_BASE;
  const findings = [...redirectTableFindings(table, root, opts.urls ?? DEFAULT_URLS)];
  const vhost = opts.vhost ?? DEFAULT_VHOST;
  const vhostFile = path.resolve(root, vhost);
  if (existsSync(vhostFile)) findings.push(...checkApexVhost(readFileSync(vhostFile, 'utf8')));
  else findings.push(finding('vhost', 'FAIL', `không thấy vhost ${vhost}`));
  findings.push(...(await nextHeaderFindings(root, opts.nextConfig)));
  if (opts.build !== false) findings.push(...buildFindings(root, opts.buildDir ?? DEFAULT_BUILD, canonical));
  return { mode: 'dry-run', canonical, findings };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Chạy thật (GET/HEAD)

function makeRequester({ base, resolveIp, timeout }) {
  const baseHost = new URL(base).hostname;
  return (url, { method = 'GET', headers = {}, maxBody = 0 } = {}) =>
    new Promise((resolve) => {
      const secure = url.protocol === 'https:';
      const viaIp = resolveIp && (url.hostname === baseHost || url.hostname === `www.${baseHost}`);
      const done = (res) => resolve(res);
      const failed = (e) => done({ status: 0, headers: {}, location: null, body: Buffer.alloc(0), error: e.message });
      const req = (secure ? https : http).request(
        {
          method,
          host: viaIp ? resolveIp : url.hostname.replace(/^\[|\]$/g, ''),
          port: url.port || (secure ? 443 : 80),
          path: url.pathname + url.search,
          headers: { host: url.host, 'user-agent': UA, accept: '*/*', ...headers },
          ...(secure && !IP_HOST.test(url.hostname) ? { servername: url.hostname } : {}),
          timeout,
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (c) => {
            if (size < maxBody) {
              chunks.push(c);
              size += c.length;
            }
          });
          res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, location: res.headers.location ?? null, body: Buffer.concat(chunks) }));
          res.on('error', failed);
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', failed);
      req.end();
    });
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
const sameUrl = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && trimSlash(x.pathname) === trimSlash(y.pathname) && x.search === y.search;
  } catch {
    return false;
  }
};

/** Một trang HTML: 200, canonical và og:url đúng URL mong đợi trên host canonical, JSON-LD Product (nếu `product`) đúng host, giá VND, không bịa sao. */
async function pageFindings(request, fetchUrl, expectedCanonical, canonical, { product = false, headersCheck = false, https: isHttps = false } = {}) {
  const findings = [];
  const target = new URL(fetchUrl);
  const label = target.pathname + target.search;
  const res = await request(target, { maxBody: 4 * 1024 * 1024, headers: { accept: 'text/html' } });
  if (res.status !== 200) return { findings: [finding('pages', 'FAIL', `${label}: ${statusText(res)}`)], html: '' };
  const html = res.body.toString('utf8');
  const can = extractCanonical(html);
  if (!can) findings.push(finding('pages', 'FAIL', `${label}: không có <link rel="canonical">`));
  else if (hostProblem(can, canonical)) findings.push(finding('pages', 'FAIL', `${label}: canonical ${can} — ${hostProblem(can, canonical)}`));
  else if (!sameUrl(can, expectedCanonical)) findings.push(finding('pages', 'FAIL', `${label}: canonical ${can}, mong ${expectedCanonical}`));
  const og = extractMeta(html, 'og:url');
  if (og && hostProblem(og, canonical)) findings.push(finding('pages', 'FAIL', `${label}: og:url ${og} — ${hostProblem(og, canonical)}`));
  else if (og && can && !sameUrl(og, can)) findings.push(finding('pages', 'WARN', `${label}: og:url ${og} khác canonical ${can}`));
  else if (!og && can) findings.push(finding('pages', 'WARN', `${label}: thiếu og:url (thẻ chia sẻ Zalo/Facebook không trỏ đúng trang)`));
  if (product) {
    const ld = extractJsonLd(html).find((b) => b?.['@type'] === 'Product');
    if (!ld) findings.push(finding('pages', 'FAIL', `${label}: không có JSON-LD Product`));
    else {
      if (hostProblem(ld.url, canonical)) findings.push(finding('pages', 'FAIL', `${label}: Product.url ${ld.url} — ${hostProblem(ld.url, canonical)}`));
      if (ld.offers?.priceCurrency !== 'VND') findings.push(finding('pages', 'FAIL', `${label}: offers.priceCurrency = ${ld.offers?.priceCurrency}, mong VND`));
      const rating = ld.aggregateRating;
      if (rating && !(Number.isInteger(rating.reviewCount) && rating.reviewCount >= 1)) {
        findings.push(finding('pages', 'FAIL', `${label}: AggregateRating với reviewCount ${rating.reviewCount} (không được khai sao khi chưa có đánh giá thật)`));
      }
    }
  }
  if (headersCheck) findings.push(...checkSecurityHeaders(res.headers, { https: isHttps, where: label, check: 'pages' }));
  if (!findings.some((f) => f.level === 'FAIL')) findings.push(finding('pages', 'PASS', `${label}: 200, canonical ${can}${product ? ', Product JSON-LD đúng host' : ''}`));
  return { findings, html };
}

/** Chữ ký tệp: WebP = RIFF....WEBP, AVIF = hộp ftyp nhãn avif/avis. */
function sniffImage(body) {
  if (body.length >= 12 && body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (body.length >= 12 && body.subarray(4, 8).toString('latin1') === 'ftyp' && /^avi[fs]$/.test(body.subarray(8, 12).toString('latin1'))) return 'avif';
  return null;
}

// Máy chủ ưu tiên AVIF khi trình duyệt nhận AVIF, rồi WebP (pickFormat, apps/api/src/modules/catalog/image-resize.ts).
// Hỏi hai kiểu: trình duyệt mới (AVIF hoặc WebP đều đạt) và trình duyệt chỉ nhận WebP (Safari cũ: phải là WebP).
const IMG_PROBES = [
  { accept: 'image/avif,image/webp,image/*;q=0.8', ok: ['avif', 'webp'], label: 'Accept avif' },
  { accept: 'image/webp,image/*;q=0.8', ok: ['webp'], label: 'Accept webp' },
];

export async function imgFindings(request, html, pageUrl, base) {
  const urls = extractImgUrls(html, pageUrl);
  if (urls.length === 0) return [finding('img', 'WARN', 'không thấy ảnh /img?u= trong HTML trang sản phẩm (sản phẩm không có ảnh?)')];
  const target = new URL(urls[0]);
  const findings = [];
  if (!isLocalOrStagingHost(new URL(base).hostname) && isLocalOrStagingHost(target.hostname)) {
    findings.push(finding('img', 'FAIL', `ảnh trỏ host cục bộ/staging ${target.host} (NEXT_PUBLIC_API_BASE_URL của bản dựng sai)`));
  }
  const short = `${target.pathname}?w=${target.searchParams.get('w') ?? '?'}`;
  const got = [];
  let headersChecked = false;
  for (const probe of IMG_PROBES) {
    const res = await request(target, { headers: { accept: probe.accept }, maxBody: 16 });
    const type = String(res.headers?.['content-type'] ?? '');
    if (res.status === 302) {
      findings.push(finding('img', 'WARN', `${short} (${probe.label}): 302 về ảnh gốc (X-Image-Fallback: ${res.headers?.['x-image-fallback'] ?? '?'}) — máy bận, thử lại`));
      continue;
    }
    if (res.status !== 200) {
      findings.push(finding('img', 'FAIL', `${target.href} (${probe.label}): ${statusText(res)}`));
      continue;
    }
    const kind = sniffImage(res.body ?? Buffer.alloc(0));
    if (!kind || !probe.ok.includes(kind) || !type.startsWith(`image/${kind}`)) {
      findings.push(finding('img', 'FAIL', `${short}: ${probe.label} mà nhận ${type || '(không content-type)'}${kind ? ` (tệp ${kind})` : ', không phải tệp AVIF/WebP'}; cần ${probe.ok.join(' hoặc ')}`));
      continue;
    }
    got.push(kind);
    if (headersChecked) continue;
    headersChecked = true;
    if (!/accept/i.test(String(res.headers?.vary ?? ''))) findings.push(finding('img', 'WARN', `${short}: thiếu Vary: Accept (CDN có thể phát AVIF/WebP cho trình duyệt không đọc được)`));
    if (!/max-age=\d{6,}/.test(String(res.headers?.['cache-control'] ?? ''))) findings.push(finding('img', 'WARN', `${short}: Cache-Control ngắn (${res.headers?.['cache-control'] ?? 'không có'})`));
  }
  if (findings.length === 0) findings.push(finding('img', 'PASS', `${target.origin}${short}: 200 ${got.map((k, i) => `${IMG_PROBES[i].label} -> image/${k}`).join(', ')}, Vary: Accept, cache dài`));
  return findings;
}

async function edgeFindings(request, base) {
  const findings = [];
  const host = new URL(base).hostname;
  const expected = `https://${host}/`;
  const plain = await request(new URL(`http://${host}/`), { method: 'HEAD' });
  if (!(plain.status === 301 || plain.status === 308) || plain.location !== expected) {
    findings.push(finding('edge', 'FAIL', `http://${host}/ → ${statusText(plain)} ${plain.location ?? ''} (mong 301/308 → ${expected})`));
  } else findings.push(finding('edge', 'PASS', `http://${host}/ → ${plain.status} ${expected}`));
  if (!host.startsWith('www.')) {
    const www = await request(new URL(`https://www.${host}/`), { method: 'HEAD' });
    if (www.status === 0) findings.push(finding('edge', 'WARN', `https://www.${host}/: ${statusText(www)}`));
    else if (!(www.status === 301 || www.status === 308) || !String(www.location ?? '').startsWith(expected)) {
      findings.push(finding('edge', 'FAIL', `https://www.${host}/ → ${statusText(www)} ${www.location ?? ''} (mong 301/308 → ${expected})`));
    } else findings.push(finding('edge', 'PASS', `https://www.${host}/ → ${www.status} ${www.location}`));
  }
  return findings;
}

/** Chạy thật trên `opts.base` (chỉ GET/HEAD). `opts.request` / `opts.table` / `opts.root` tiêm được để test. */
export async function runLive(opts) {
  const root = opts.root ?? REPO_ROOT;
  const request = opts.request ?? makeRequester(opts);
  const skip = new Set(opts.skip ?? []);
  const base = opts.base;
  const canonical = opts.canonical ?? base;
  const baseHost = new URL(base).hostname;
  const isHttps = new URL(base).protocol === 'https:';
  const findings = [];
  // URL trên host canonical -> cùng đường dẫn trên --base.
  const toFetch = (loc) => {
    const u = new URL(loc);
    return new URL(u.pathname + u.search, base).href;
  };

  if (!skip.has('robots')) {
    const res = await request(new URL('/robots.txt', base), { maxBody: 256 * 1024 });
    if (res.status !== 200) findings.push(finding('robots', 'FAIL', `/robots.txt: ${statusText(res)}`));
    else findings.push(...checkRobots(res.body.toString('utf8'), canonical));
  }

  let locs = [];
  if (!skip.has('sitemap') || !skip.has('pages') || !skip.has('img')) {
    const res = await request(new URL('/sitemap.xml', base), { maxBody: MAX_BYTES });
    if (res.status !== 200) {
      if (!skip.has('sitemap')) findings.push(finding('sitemap', 'FAIL', `/sitemap.xml: ${statusText(res)}`));
    } else {
      const parsed = checkSitemapXml(res.body.toString('utf8'));
      const errors = parsed.errors.map((e) => `/sitemap.xml: ${e}`);
      locs = parsed.locs;
      if (parsed.root === 'sitemapindex') {
        locs = [];
        for (const child of parsed.locs.slice(0, 20)) {
          const sub = await request(new URL(toFetch(child)), { maxBody: MAX_BYTES });
          const subParsed = sub.status === 200 ? checkSitemapXml(sub.body.toString('utf8')) : { errors: [statusText(sub)], locs: [] };
          errors.push(...subParsed.errors.map((e) => `${child}: ${e}`));
          locs.push(...subParsed.locs);
        }
      }
      if (!skip.has('sitemap')) {
        for (const e of errors.slice(0, 5)) findings.push(finding('sitemap', 'FAIL', e));
        if (!/xml/i.test(String(res.headers['content-type'] ?? ''))) findings.push(finding('sitemap', 'WARN', `/sitemap.xml: content-type ${res.headers['content-type'] ?? '(trống)'}`));
        findings.push(...analyzeSitemap(locs, canonical).findings);
      }
    }
  }

  const productLocs = locs.filter(isProductUrl);
  let productHtml = '';
  let productUrl = '';
  if (!skip.has('pages')) {
    findings.push(...(await pageFindings(request, `${base}/`, `${canonical}/`, canonical, { headersCheck: true, https: isHttps })).findings);
    findings.push(...(await pageFindings(request, `${base}/san-pham`, `${canonical}/san-pham`, canonical)).findings);
    const pages = opts.pages ?? 5;
    const picked = pages === 0 ? [] : evenSample(productLocs, pages);
    for (const [i, loc] of picked.entries()) {
      const fetchUrl = toFetch(loc);
      const r = await pageFindings(request, fetchUrl, loc, canonical, { product: true, headersCheck: i === 0, https: isHttps });
      findings.push(...r.findings);
      if (!productHtml && r.html && extractImgUrls(r.html, fetchUrl).length) {
        productHtml = r.html;
        productUrl = fetchUrl;
      }
    }
    if (pages > 0 && productLocs.length === 0) findings.push(finding('pages', 'WARN', 'sitemap không có trang sản phẩm để kiểm canonical/JSON-LD'));
  }

  if (!skip.has('img')) {
    if (!productHtml && productLocs.length) {
      productUrl = toFetch(productLocs[0]);
      productHtml = (await request(new URL(productUrl), { maxBody: 4 * 1024 * 1024, headers: { accept: 'text/html' } })).body.toString('utf8');
    }
    findings.push(...(await imgFindings(request, productHtml, productUrl || base, base)));
  }

  if (!skip.has('redirects')) {
    const table = opts.table ?? (await loadTable(root));
    const listFile = path.resolve(root, opts.urls ?? DEFAULT_URLS);
    const all = uniqueInputs([...defaultInventory(table), ...(existsSync(listFile) ? readUrlList(listFile) : [])]).filter((u) => !table.isWpUploadPath?.(u.path));
    const inputs = evenSample(all, opts.sample ?? 0);
    const rows = await mapPool(inputs, opts.concurrency ?? 4, async (input) => {
      const expected = expectedFor(table.resolveLegacyWpPath(input.path));
      const { steps, flags } = await followRedirects({ base, path: input.path, search: input.search, request: (u) => request(u, { method: 'HEAD' }) });
      return { ...input, flags, steps, ...classifyChain({ expected, steps, flags }) };
    });
    const failed = rows.filter((r) => r.verdict === 'FAIL');
    const warned = rows.filter((r) => r.verdict === 'WARN');
    const loops = rows.filter((r) => r.flags.loop).length;
    const dead = rows.filter((r) => r.steps.at(-1)?.status === 404).length;
    for (const r of failed.slice(0, 15)) findings.push(finding('redirects', 'FAIL', `${r.path}${r.search}: ${r.reason}`));
    if (failed.length > 15) findings.push(finding('redirects', 'FAIL', `… và ${failed.length - 15} URL hỏng khác`));
    if (warned.length) findings.push(finding('redirects', 'WARN', `${warned.length} URL chuyển hướng tạm thời: ${sample(warned.map((r) => `${r.path} (${r.reason})`))}`));
    const summary = `${rows.length}/${all.length} URL WordPress cũ: ${rows.length - failed.length - warned.length} PASS, ${warned.length} WARN, ${failed.length} FAIL; ${loops} vòng lặp, ${dead} đích 404`;
    findings.push(finding('redirects', failed.length ? 'FAIL' : 'PASS', summary));
  }

  if (!skip.has('edge') && isHttps && !isLocalOrStagingHost(baseHost) && !IP_HOST.test(baseHost)) {
    findings.push(...(await edgeFindings(request, base)));
  }

  return { mode: 'live', base, canonical, resolveIp: opts.resolveIp || null, findings };
}

function summarize(findings) {
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
  const report = opts.dryRun ? await runDryRun(opts) : await runLive(opts);
  const summary = summarize(report.findings);
  if (opts.json) console.log(JSON.stringify({ ...report, summary }, null, 2));
  else {
    const order = { FAIL: 0, WARN: 1, PASS: 2 };
    for (const f of [...report.findings].sort((a, b) => order[a.level] - order[b.level])) console.log(`${f.level.padEnd(4)}  [${f.check}] ${f.message}`);
    const where =
      report.mode === 'dry-run' ? `dry-run (không gọi mạng), canonical ${report.canonical}` : `${report.base}${report.resolveIp ? ` qua ${report.resolveIp}` : ''}, canonical ${report.canonical}`;
    console.log(`\n${where}: ${summary.pass} PASS, ${summary.warn} WARN, ${summary.fail} FAIL`);
    if (summary.fail) console.log('KẾT LUẬN: CHƯA ĐẠT — xử lý mọi FAIL trước khi coi cutover là xong.');
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
