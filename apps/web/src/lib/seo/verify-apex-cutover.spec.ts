import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as table from '@/lib/legacy-wp-redirects';
import {
  analyzeSitemap,
  checkApexVhost,
  checkRobots,
  checkSecurityHeaders,
  checkSitemapXml,
  extractCanonical,
  extractImgUrls,
  findBadHosts,
  findRuleCycles,
  followRedirects,
  hostProblem,
  imgFindings,
  parseArgs,
  runDryRun,
} from '../../../../../scripts/cutover/verify-apex-cutover.mjs';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const read = (p: string) => readFileSync(`${ROOT}${p}`, 'utf8');
const APEX = 'https://tubutree.com';
type Finding = { check: string; level: string; message: string };
const levels = (findings: Finding[]) => findings.map((f) => f.level);
const fails = (findings: Finding[]) => findings.filter((f) => f.level === 'FAIL').map((f) => f.message);

/** Máy chủ giả: `routes` = đường dẫn (kèm query) -> [status, location?]. */
const fakeServer = (routes: Record<string, [number, string?]>) => async (url: URL) => {
  const hit = routes[url.pathname + url.search];
  return hit ? { status: hit[0], location: hit[1] ?? null } : { status: 404, location: null };
};

describe('followRedirects — đi theo chuyển hướng, bắt vòng lặp', () => {
  it('A → B → A là vòng lặp; dừng ngay khi gặp lại URL cũ', async () => {
    const calls: string[] = [];
    const request = async (url: URL) => {
      calls.push(url.pathname);
      return fakeServer({ '/a/': [301, '/b/'], '/b/': [301, '/a/'] })(url);
    };
    const { steps, flags } = await followRedirects({ base: APEX, path: '/a/', request });
    expect(flags.loop).toBe(true);
    expect(calls).toEqual(['/a/', '/b/']);
    expect(steps).toHaveLength(2);
  });

  it('chuỗi dài quá số chặng tối đa thì báo tooMany; một chặng 301 tới trang 200 thì không cờ nào', async () => {
    const long = await followRedirects({ base: APEX, path: '/1', maxHops: 3, request: fakeServer({ '/1': [301, '/2'], '/2': [301, '/3'], '/3': [301, '/4'], '/4': [301, '/5'] }) });
    expect(long.flags.tooMany).toBe(true);
    const ok = await followRedirects({ base: APEX, path: '/product/x/', request: fakeServer({ '/product/x/': [301, '/san-pham/x'], '/san-pham/x': [200] }) });
    expect(ok.flags).toEqual({});
    expect(ok.steps.map((s) => s.status)).toEqual([301, 200]);
  });

  it('chuyển sang origin khác thì dừng và cắm cờ external (không đi theo sang host lạ)', async () => {
    const r = await followRedirects({ base: APEX, path: '/blog/', request: fakeServer({ '/blog/': [301, 'https://blog.tubutree.com/blog/'] }) });
    expect(r.flags.external).toBe(true);
    expect(r.steps).toHaveLength(1);
  });
});

describe('findRuleCycles — vòng lặp ngay trong bảng luật (không gọi mạng)', () => {
  it('a → b → a là một vòng; c → d (d không có luật) thì không', () => {
    const rules: Record<string, string> = { '/a': '/b', '/b': '/a', '/c': '/d' };
    const resolve = (p: string) => {
      const to = rules[p.replace(/\/+$/, '') || '/'];
      return to ? { kind: 'redirect' as const, status: 301 as const, location: to } : null;
    };
    expect(findRuleCycles(resolve, ['/a/', '/b/', '/c/'])).toEqual([['/a', '/b', '/a']]);
  });

  it('bảng chuyển hướng WordPress thật không có vòng nào', () => {
    const sources = [...Object.keys(table.LEGACY_PAGE_REDIRECTS), ...Object.keys(table.LEGACY_PRODUCT_REDIRECTS).map((s) => `/product/${s}`)];
    expect(findRuleCycles(table.resolveLegacyWpPath, sources)).toEqual([]);
  });
});

describe('checkSitemapXml — XML hợp lệ và đúng cấu trúc sitemap', () => {
  const ok = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://tubutree.com/</loc><changefreq>daily</changefreq></url>
<url><loc>https://tubutree.com/san-pham?category=c1&amp;x=1</loc><lastmod>2026-11-20T10:00:00.000Z</lastmod></url>
</urlset>`;

  it('sitemap đúng: không lỗi, trả mọi <loc> đã giải &amp;', () => {
    const r = checkSitemapXml(ok);
    expect(r.errors).toEqual([]);
    expect(r.locs).toEqual(['https://tubutree.com/', 'https://tubutree.com/san-pham?category=c1&x=1']);
  });

  it.each([
    ['thẻ không đóng', ok.replace('</urlset>', '')],
    ['đóng sai thẻ', ok.replace('</changefreq>', '</lastmod>')],
    ['& trần (không phải thực thể)', ok.replace('&amp;x=1', '&x=1')],
    ['"<" lạc trong chữ', ok.replace('daily', 'da<ily')],
    ['gốc không phải urlset/sitemapindex', ok.replace(/urlset/g, 'pages')],
    ['thiếu xmlns sitemap', ok.replace(' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"', '')],
    ['<url> thiếu <loc>', ok.replace('<loc>https://tubutree.com/</loc>', '')],
    ['hai phần tử gốc', `${ok}\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`],
    ['chuỗi rỗng', ''],
    ['trang HTML thay vì XML', '<!doctype html><html><body>404</body></html>'],
  ])('%s → có lỗi', (_name, xml) => {
    expect(checkSitemapXml(xml).errors.length).toBeGreaterThan(0);
  });
});

describe('hostProblem / findBadHosts — URL không thuộc host canonical', () => {
  it('đúng host canonical (https://tubutree.com) thì không lỗi', () => {
    expect(hostProblem('https://tubutree.com/san-pham/x', APEX)).toBeNull();
    expect(hostProblem('https://tubutree.com/', APEX)).toBeNull();
  });

  it.each([
    ['http://localhost:3000/san-pham/x', /cục bộ/],
    ['https://127.0.0.1/x', /cục bộ/],
    ['https://staging.tubutree.com/x', /staging/],
    ['https://tubutree-dev.vercel.app/x', /staging/],
    ['https://app.tubutree.com/x', /khác host canonical/],
    ['http://tubutree.com/x', /khác host canonical/],
    ['https://www.tubutree.com/x', /khác host canonical/],
    ['/san-pham/x', /không phải URL tuyệt đối/],
  ])('%s → lỗi', (url, reason) => {
    expect(hostProblem(url, APEX)).toMatch(reason);
  });

  it('findBadHosts trả từng URL hỏng kèm lý do', () => {
    expect(findBadHosts(['https://tubutree.com/a', 'http://localhost/b'], APEX)).toEqual([{ url: 'http://localhost/b', reason: expect.stringMatching(/cục bộ/) }]);
  });
});

describe('analyzeSitemap — đủ sản phẩm, danh mục, chiến dịch; không host lạ', () => {
  const locs = ['https://tubutree.com/', 'https://tubutree.com/san-pham/a', 'https://tubutree.com/san-pham?category=c1', 'https://tubutree.com/chien-dich/sale-11'];

  it('đủ cả ba nhóm, đúng host: không FAIL, không WARN', () => {
    const r = analyzeSitemap(locs, APEX);
    expect(r.counts).toEqual({ total: 4, products: 1, categories: 1, campaigns: 1 });
    expect(levels(r.findings).filter((l) => l !== 'PASS')).toEqual([]);
  });

  it('thiếu sản phẩm hoặc danh mục là FAIL; thiếu chiến dịch là WARN (có thể không có chiến dịch nào đang chạy)', () => {
    expect(fails(analyzeSitemap(locs.filter((l) => !l.includes('/san-pham/')), APEX).findings).join()).toMatch(/sản phẩm/);
    expect(fails(analyzeSitemap(locs.filter((l) => !l.includes('category=')), APEX).findings).join()).toMatch(/danh mục/);
    const noCampaign = analyzeSitemap(locs.filter((l) => !l.includes('/chien-dich/')), APEX).findings;
    expect(fails(noCampaign)).toEqual([]);
    expect(noCampaign.some((f) => f.level === 'WARN' && /chien-dich/.test(f.message))).toBe(true);
  });

  it('--allow-no-campaigns: 0 chiến dịch không còn WARN, PASS ghi rõ cờ; thiếu sản phẩm/danh mục vẫn FAIL', () => {
    const noCampaignLocs = locs.filter((l) => !l.includes('/chien-dich/'));
    const allowed = analyzeSitemap(noCampaignLocs, APEX, { allowNoCampaigns: true }).findings;
    expect(levels(allowed)).toEqual(['PASS']);
    expect(allowed[0]!.message).toMatch(/0 chiến dịch \(--allow-no-campaigns\)/);
    expect(fails(analyzeSitemap(noCampaignLocs.filter((l) => !l.includes('/san-pham/')), APEX, { allowNoCampaigns: true }).findings).join()).toMatch(/sản phẩm/);
    expect(levels(analyzeSitemap(locs, APEX, { allowNoCampaigns: true }).findings)).toEqual(['PASS']);
  });

  it('một URL localhost hay app.* trong sitemap là FAIL; URL trùng là WARN', () => {
    const bad = analyzeSitemap([...locs, 'http://localhost:3000/san-pham/b', 'https://app.tubutree.com/san-pham/c'], APEX);
    expect(fails(bad.findings).join()).toMatch(/2 URL/);
    const dup = analyzeSitemap([...locs, locs[1]!], APEX);
    expect(dup.findings.some((f) => f.level === 'WARN')).toBe(true);
  });
});

describe('checkRobots', () => {
  const good = 'User-Agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin/\nDisallow: /gio-hang\n\nSitemap: https://tubutree.com/sitemap.xml\n';
  it('robots chuẩn: không FAIL', () => {
    expect(fails(checkRobots(good, APEX))).toEqual([]);
  });
  it('thiếu Sitemap, Sitemap trỏ host khác, chặn cả site, hay không chặn /admin: FAIL', () => {
    expect(fails(checkRobots(good.replace(/Sitemap:.*\n/, ''), APEX)).join()).toMatch(/Sitemap/);
    expect(fails(checkRobots(good.replace('https://tubutree.com/sitemap', 'https://app.tubutree.com/sitemap'), APEX)).join()).toMatch(/Sitemap/);
    expect(fails(checkRobots(`${good}Disallow: /\n`, APEX)).join()).toMatch(/chặn toàn bộ/);
    expect(fails(checkRobots(good.replace(/Disallow: \/admin\/?\n/g, ''), APEX)).join()).toMatch(/\/admin/);
  });
});

describe('checkSecurityHeaders', () => {
  const full: Record<string, string> = {
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=()',
    'content-security-policy-report-only': "default-src 'self'",
  };
  const drop = (k: string) => Object.fromEntries(Object.entries(full).filter(([key]) => key !== k));

  it('đủ header: không FAIL, không WARN', () => {
    expect(levels(checkSecurityHeaders(full, { https: true })).filter((l) => l !== 'PASS')).toEqual([]);
  });
  it('thiếu HSTS trên https, thiếu nosniff, thiếu chống nhúng khung: FAIL', () => {
    expect(fails(checkSecurityHeaders(drop('strict-transport-security'), { https: true })).join()).toMatch(/Strict-Transport-Security/);
    expect(fails(checkSecurityHeaders(drop('x-content-type-options'), { https: true })).join()).toMatch(/nosniff/);
    expect(fails(checkSecurityHeaders(drop('x-frame-options'), { https: true })).join()).toMatch(/khung/);
    // Thay X-Frame-Options bằng CSP frame-ancestors là hợp lệ.
    expect(fails(checkSecurityHeaders({ ...drop('x-frame-options'), 'content-security-policy': "frame-ancestors 'none'" }, { https: true }))).toEqual([]);
    // http (chạy thử cục bộ) thì không đòi HSTS.
    expect(fails(checkSecurityHeaders(drop('strict-transport-security'), { https: false }))).toEqual([]);
  });
  it('HSTS quá ngắn hay lộ x-powered-by: WARN', () => {
    expect(levels(checkSecurityHeaders({ ...full, 'strict-transport-security': 'max-age=300' }, { https: true }))).toContain('WARN');
    expect(levels(checkSecurityHeaders({ ...full, 'x-powered-by': 'Next.js' }, { https: true }))).toContain('WARN');
  });
});

describe('đọc HTML: canonical và ảnh /img', () => {
  it('lấy canonical (thứ tự thuộc tính bất kỳ) và URL ảnh đổi cỡ (src, srcset, đã giải &amp;)', () => {
    const html =
      '<head><link href="https://tubutree.com/san-pham/a" rel="canonical"/></head><img srcSet="https://api.tubutree.com/api/img?w=320&amp;u=https%3A%2F%2Fx%2Fa.jpg 320w, https://api.tubutree.com/api/img?w=640&amp;u=https%3A%2F%2Fx%2Fa.jpg 640w" src="/logo.png">';
    expect(extractCanonical(html)).toBe('https://tubutree.com/san-pham/a');
    expect(extractImgUrls(html)).toEqual(['https://api.tubutree.com/api/img?w=320&u=https%3A%2F%2Fx%2Fa.jpg', 'https://api.tubutree.com/api/img?w=640&u=https%3A%2F%2Fx%2Fa.jpg']);
    expect(extractCanonical('<html></html>')).toBeNull();
  });
});

describe('imgFindings — /api/img chọn định dạng theo Accept', () => {
  const PDP = 'https://tubutree.com/san-pham/a';
  const html = '<img src="https://api.tubutree.com/api/img?w=320&amp;u=https%3A%2F%2Fx%2Fa.jpg">';
  const AVIF = Buffer.from('\0\0\0\x1cftypavif\0\0\0\0', 'latin1');
  const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
  const JPEG = Buffer.from('\xff\xd8\xff\xe0\0\x10JFIF\0\x01\x01\0\0\x01', 'latin1');
  const cacheHeaders = { vary: 'Accept', 'cache-control': 'public, max-age=31536000, immutable' };
  type Body = { type: string; body: Buffer };
  /** Máy chủ giả: `pick(accept)` trả loại + thân ảnh; ghi lại mọi Accept đã gửi. */
  const imgServer = (pick: (accept: string) => Body, seen: string[] = []) => async (_url: URL, init?: { headers?: Record<string, string> }) => {
    const accept = init?.headers?.accept ?? '';
    seen.push(accept);
    const { type, body } = pick(accept);
    return { status: 200, headers: { ...cacheHeaders, 'content-type': type }, location: null, body };
  };
  // Như pickFormat ở apps/api/src/modules/catalog/image-resize.ts: có image/avif thì AVIF, có image/webp thì WebP, còn lại JPEG.
  const negotiating = (accept: string): Body =>
    accept.includes('image/avif') ? { type: 'image/avif', body: AVIF } : accept.includes('image/webp') ? { type: 'image/webp', body: WEBP } : { type: 'image/jpeg', body: JPEG };

  it('máy chủ trả AVIF cho trình duyệt nhận AVIF và WebP cho trình duyệt chỉ nhận WebP: không FAIL', async () => {
    const seen: string[] = [];
    const findings = await imgFindings(imgServer(negotiating, seen), html, PDP, APEX);
    expect(fails(findings)).toEqual([]);
    expect(levels(findings)).toContain('PASS');
    expect(seen.some((a) => a.includes('image/avif'))).toBe(true);
    expect(seen.some((a) => a.includes('image/webp') && !a.includes('image/avif'))).toBe(true);
  });

  it('WebP cho mọi Accept vẫn đạt', async () => {
    expect(fails(await imgFindings(imgServer(() => ({ type: 'image/webp', body: WEBP })), html, PDP, APEX))).toEqual([]);
  });

  it('JPEG cho mọi Accept, hay nhãn AVIF mà thân là WebP: FAIL', async () => {
    expect(fails(await imgFindings(imgServer(() => ({ type: 'image/jpeg', body: JPEG })), html, PDP, APEX)).length).toBeGreaterThan(0);
    expect(fails(await imgFindings(imgServer(() => ({ type: 'image/avif', body: WEBP })), html, PDP, APEX)).length).toBeGreaterThan(0);
  });

  it('chỉ nhận WebP mà vẫn được AVIF: FAIL (Safari cũ không đọc được)', async () => {
    expect(fails(await imgFindings(imgServer(() => ({ type: 'image/avif', body: AVIF })), html, PDP, APEX)).join()).toMatch(/webp/i);
  });
});

describe('checkApexVhost — vhost Apache của apex', () => {
  const vhost = read('ops/vietnix-vhost-apex.conf.cutover');
  it('bản trong repo: không FAIL', () => {
    expect(fails(checkApexVhost(vhost))).toEqual([]);
  });
  it('bỏ HSTS, đảo uploads ra sau ProxyPass /, hay proxy sang host khác 127.0.0.1: FAIL', () => {
    expect(fails(checkApexVhost(vhost.replace(/Header always set Strict-Transport-Security[^\n]*\n/, ''))).join()).toMatch(/Strict-Transport-Security/);
    const moved = vhost
      .replace(/^\s*ProxyPass \/wp-content\/uploads\/ !\s*$/m, '')
      .replace(/^(\s*ProxyPass \/ http:\/\/127\.0\.0\.1:14000\/.*)$/m, '$1\n    ProxyPass /wp-content/uploads/ !');
    expect(fails(checkApexVhost(moved)).join()).toMatch(/uploads/);
    expect(fails(checkApexVhost(vhost.replace('ProxyPass / http://127.0.0.1:14000/', 'ProxyPass / http://staging.internal:14000/'))).join()).toMatch(/127\.0\.0\.1/);
  });
});

describe('parseArgs', () => {
  it('mặc định chạy thật trên https://tubutree.com; --dry-run không cần mạng; canonical mặc định theo --base', () => {
    expect(parseArgs([])).toMatchObject({ base: APEX, canonical: APEX, dryRun: false });
    expect(parseArgs(['--dry-run'])).toMatchObject({ dryRun: true, canonical: APEX });
    expect(parseArgs(['--base', 'http://localhost:3122', '--canonical', 'https://app.tubutree.com'])).toMatchObject({ base: 'http://localhost:3122', canonical: 'https://app.tubutree.com' });
    expect(parseArgs(['--base', 'https://tubutree.com/'])).toMatchObject({ base: APEX, canonical: APEX });
  });
  it('--allow-no-campaigns mặc định tắt, bật được cùng --strict', () => {
    expect(parseArgs([]).allowNoCampaigns).toBe(false);
    expect(parseArgs(['--allow-no-campaigns', '--strict'])).toMatchObject({ allowNoCampaigns: true, strict: true });
  });
  it('tham số lạ hoặc URL hỏng thì ném lỗi', () => {
    expect(() => parseArgs(['--bogus'])).toThrow();
    expect(() => parseArgs(['--base', 'khong-phai-url'])).toThrow();
    expect(() => parseArgs(['--sample'])).toThrow();
  });
});

describe('runDryRun — kiểm cục bộ trước D-Day (bảng luật, vhost, header Next), không gọi mạng', () => {
  it('repo hiện tại: không FAIL ở bảng chuyển hướng, vhost và header', async () => {
    const report = await runDryRun({ ...parseArgs(['--dry-run', '--no-build']), table, root: ROOT });
    expect(report.findings.filter((f) => f.level === 'FAIL')).toEqual([]);
    expect(new Set(report.findings.map((f) => f.check))).toEqual(new Set(['redirects', 'vhost', 'headers']));
  });

  it('bảng luật có vòng lặp thì dry-run FAIL', async () => {
    const looped = {
      ...table,
      resolveLegacyWpPath: (p: string) =>
        p.replace(/\/+$/, '') === '/shop' ? { kind: 'redirect' as const, status: 301 as const, location: '/shop/' } : table.resolveLegacyWpPath(p),
    };
    const report = await runDryRun({ ...parseArgs(['--dry-run', '--no-build']), table: looped, root: ROOT });
    expect(report.findings.some((f) => f.check === 'redirects' && f.level === 'FAIL')).toBe(true);
  });
});
