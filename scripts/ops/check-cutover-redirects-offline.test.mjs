// Test chế độ --offline của check-cutover-redirects.mjs (kiểm bảng luật, không gọi mạng).
//   node --test scripts/ops/check-cutover-redirects-offline.test.mjs
// Hàm thuần chạy trên bảng giả (Node >= 20). Các ca dùng bảng thật cần Node >= 22.18 (nạp thẳng .ts) và tự bỏ qua trên Node cũ.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRuleTableOffline, defaultInventory, parseArgs } from './check-cutover-redirects.mjs';

const SCRIPT = fileURLToPath(new URL('./check-cutover-redirects.mjs', import.meta.url));
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const HAS_TS = major > 22 || (major === 22 && minor >= 18);

/** Bảng giả: `rules` = đường dẫn đã bỏ dấu "/" cuối -> `{ to }` (301) hoặc `{ gone: true }`; `blog` = các đường dẫn blog. */
const fakeTable = (rules, blog = []) => ({
  resolveLegacyWpPath(pathname) {
    const key = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    const rule = rules[key];
    if (!rule) return null;
    return rule.gone ? { kind: 'gone', status: 410 } : { kind: 'redirect', status: 301, location: rule.to };
  },
  isWpBlogPath: (pathname) => blog.includes(pathname.replace(/\/+$/, '')),
});
const verdictOf = (table, path, opts) => checkRuleTableOffline(table, [{ path, search: '' }], opts)[0];

test('luật hợp lệ: 301 tới đường dẫn cùng origin → PASS; 410 → PASS', () => {
  const t = fakeTable({ '/trang-cu': { to: '/san-pham' }, '/demo': { gone: true } });
  assert.deepEqual(verdictOf(t, '/trang-cu/').verdict, 'PASS');
  assert.equal(verdictOf(t, '/trang-cu/').reason, '301');
  assert.equal(verdictOf(t, '/demo/').verdict, 'PASS');
  assert.equal(verdictOf(t, '/demo/').reason, '410');
});

test('đích có query vẫn hợp lệ nếu đường dẫn đích không có luật', () => {
  const t = fakeTable({ '/product-x': { to: '/san-pham?q=kem+danh+rang' } });
  assert.equal(verdictOf(t, '/product-x/').verdict, 'PASS');
});

test('đích khác origin hoặc dạng //host → FAIL', () => {
  const t = fakeTable({ '/a': { to: 'https://example.com/x' }, '/b': { to: '//example.com/x' }, '/c': { to: 'san-pham' } });
  for (const p of ['/a/', '/b/', '/c/']) {
    const r = verdictOf(t, p);
    assert.equal(r.verdict, 'FAIL', p);
    assert.match(r.reason, /cùng origin/);
  }
});

test('đích trỏ lại chính nó (kể cả khác dấu "/" cuối) → FAIL vòng lặp', () => {
  const t = fakeTable({ '/a': { to: '/a/' }, '/b': { to: '/b' } });
  assert.match(verdictOf(t, '/a/').reason, /vòng lặp/);
  assert.equal(verdictOf(t, '/b/').verdict, 'FAIL');
});

test('đích vẫn còn luật → FAIL chuỗi 2 chặng', () => {
  const t = fakeTable({ '/a': { to: '/b' }, '/b': { to: '/san-pham' } });
  const r = verdictOf(t, '/a/');
  assert.equal(r.verdict, 'FAIL');
  assert.match(r.reason, /chuỗi 2 chặng/);
  assert.equal(verdictOf(t, '/b/').verdict, 'PASS');
});

test('đích là đường dẫn blog (reverse proxy) → FAIL', () => {
  const t = fakeTable({ '/a': { to: '/blog' } }, ['/blog']);
  assert.match(verdictOf(t, '/a/').reason, /blog/);
});

test('URL blog: không có luật → SKIP; vừa có luật vừa là blog → FAIL', () => {
  const t = fakeTable({ '/blog-a': { to: '/san-pham' } }, ['/blog-a', '/blog-b']);
  assert.equal(verdictOf(t, '/blog-b/').verdict, 'SKIP');
  const conflict = verdictOf(t, '/blog-a/');
  assert.equal(conflict.verdict, 'FAIL');
  assert.match(conflict.reason, /vừa có luật/);
});

test('URL không có luật: requireRule=true → FAIL (URL dựng từ bảng phải còn luật); false → PASS', () => {
  const t = fakeTable({});
  assert.equal(verdictOf(t, '/khong-co/', { requireRule: true }).verdict, 'FAIL');
  assert.equal(verdictOf(t, '/khong-co/', { requireRule: false }).verdict, 'PASS');
  assert.equal(verdictOf(t, '/khong-co/').verdict, 'PASS');
});

test('không gọi mạng: hàm thuần chạy khi fetch bị chặn', () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('không được gọi mạng');
  };
  try {
    const t = fakeTable({ '/a': { to: '/san-pham' } });
    assert.equal(verdictOf(t, '/a/').verdict, 'PASS');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('parseArgs nhận --offline, mặc định false', () => {
  assert.equal(parseArgs([]).offline, false);
  assert.equal(parseArgs(['--offline']).offline, true);
  assert.equal(parseArgs(['--offline', '--base', 'https://tubutree.com']).base, 'https://tubutree.com');
});

test('defaultInventory dựng từ các bảng và thêm dấu "/" cuối như WordPress', () => {
  const inv = defaultInventory({ LEGACY_PAGE_REDIRECTS: { '/gioi-thieu': '/' }, LEGACY_FILE_REDIRECTS: { '/sitemap_index.xml': '/sitemap.xml' }, LEGACY_PRODUCT_REDIRECTS: { 'kem-x': '/san-pham/kem-x' }, LEGACY_GONE_EXACT: ['/test'] });
  const paths = inv.map((i) => i.path);
  for (const p of ['/gioi-thieu/', '/sitemap_index.xml/', '/product/kem-x/', '/test/', '/shop/page/2/']) assert.ok(paths.includes(p), p);
});

const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 60000 });

test('CLI --offline trên bảng THẬT: 0 FAIL, thoát 0, dòng tổng kết đúng dạng, không cần mạng (base trỏ cổng đóng)', { skip: !HAS_TS && 'cần Node >= 22.18' }, () => {
  const r = cli('--offline', '--base', 'http://127.0.0.1:1', '--timeout', '1');
  assert.equal(r.status, 0, r.stdout.slice(-400) + r.stderr.slice(-400));
  const last = r.stdout.trim().split('\n').pop() ?? '';
  assert.match(last, /^offline \(bảng luật, không gọi mạng\): \d+ URL, \d+ PASS, 0 WARN, 0 FAIL, \d+ SKIP$/);
});

test('CLI --offline với --urls (danh sách URL WordPress đang index): 0 FAIL', { skip: !HAS_TS && 'cần Node >= 22.18' }, () => {
  const list = fileURLToPath(new URL('./data/wp-live-urls-20261114.txt', import.meta.url));
  const r = cli('--offline', '--urls', list);
  assert.equal(r.status, 0, r.stdout.slice(-600));
  assert.match(r.stdout.trim().split('\n').pop() ?? '', / 0 FAIL, /);
});

test('CLI --offline --json: offline=true, base=null', { skip: !HAS_TS && 'cần Node >= 22.18' }, () => {
  const r = cli('--offline', '--json');
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.offline, true);
  assert.equal(out.base, null);
  assert.equal(out.summary.fail, 0);
});
