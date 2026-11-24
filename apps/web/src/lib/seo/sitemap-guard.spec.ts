import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEGAL_SLUGS as APP_LEGAL_SLUGS } from '@tubutree/app-core/legal-core';
import robots from '@/app/robots';
import {
  DEFAULT_UA,
  LEGAL_SLUGS,
  analyzeLocs,
  headOf,
  headSignals,
  isNoindex,
  kindOf,
  pageProblems,
  parseArgs,
  parseRobots,
  pickLocs,
  robotsVerdict,
  runGuard,
  sameUrl,
  withRetry,
  type GuardResponse,
} from '../../../../../scripts/ci/sitemap-guard/index.mjs';

const SCRIPT = fileURLToPath(new URL('../../../../../scripts/ci/sitemap-guard/index.mjs', import.meta.url));
const SITE = 'https://tubutree.com';
const LEGAL_LOCS = LEGAL_SLUGS.map((s) => `${SITE}/chinh-sach/${s}`);
const fails = (findings: { level: string; message: string }[]) => findings.filter((f) => f.level === 'FAIL').map((f) => f.message);

/** robots.txt như Next in từ đối tượng của app/robots.ts (một nhóm `*`). */
function robotsText(): string {
  const rule = robots().rules as { userAgent: string; allow: string[]; disallow: string[] }[];
  return rule.map((r) => [`User-agent: ${r.userAgent}`, ...r.allow.map((a) => `Allow: ${a}`), ...r.disallow.map((d) => `Disallow: ${d}`)].join('\n')).join('\n\n');
}

const page = (canonical: string | null, extra = ''): string =>
  `<!doctype html><html><head><title>t</title>${canonical ? `<link rel="canonical" href="${canonical}"/>` : ''}${extra}</head><body></body></html>`;
const ok = (body: string, headers: Record<string, string> = {}): GuardResponse => ({ status: 200, headers, location: null, body });
const sitemapXml = (locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l.replace(/&/g, '&amp;')}</loc></url>`).join('')}</urlset>`;

describe('danh sách trang chính sách', () => {
  it('trùng LEGAL_SLUGS của app-core (5 trang của hồ sơ Bộ Công Thương)', () => {
    expect([...LEGAL_SLUGS]).toEqual([...APP_LEGAL_SLUGS]);
    expect(LEGAL_SLUGS).toHaveLength(5);
  });
});

describe('robots.txt — luật khớp dài nhất như Google', () => {
  it('đọc đúng robots.txt thật của web: trang riêng tư bị chặn, trang công khai dưới tiền tố riêng tư được mở lại', () => {
    const rules = parseRobots(robotsText());
    expect(rules.disallow).toContain('/admin');
    for (const p of ['/gio-hang', '/thanh-toan', '/admin', '/admin/don', '/tai-khoan']) expect(robotsVerdict(p, rules).allowed, p).toBe(false);
    for (const p of ['/', '/san-pham', '/san-pham?category=abc', '/chinh-sach/doi-tra', '/cong-dong', '/doi-rac/quy-dinh']) {
      expect(robotsVerdict(p, rules).allowed, p).toBe(true);
    }
  });

  it('chỉ lấy nhóm `*`; dòng User-agent liền nhau là một nhóm; Disallow trống không chặn; chú thích bị bỏ', () => {
    const rules = parseRobots(['User-agent: Bingbot', 'Disallow: /', '', 'User-agent: foo', 'User-agent: *', 'Disallow: /a # chú thích', 'Disallow:', 'Allow: /a/b'].join('\n'));
    expect(rules).toEqual({ allow: ['/a/b'], disallow: ['/a'] });
  });

  it('có nhóm Googlebot thì Googlebot chỉ theo nhóm đó, bỏ qua `*` (như Google)', () => {
    const text = ['User-agent: *', 'Disallow: /a', '', 'User-agent: Googlebot', 'Disallow: /b'].join('\n');
    expect(parseRobots(text)).toEqual({ allow: [], disallow: ['/b'] });
    expect(parseRobots(text, 'bingbot')).toEqual({ allow: [], disallow: ['/a'] });
  });

  it('dài hơn thắng, bằng nhau thì Allow thắng; hỗ trợ `*` và `$`', () => {
    const rules = { allow: ['/x/ok', '/same'], disallow: ['/x', '/same', '/*.pdf$', '/q?*sort='] };
    expect(robotsVerdict('/x/ok/1', rules)).toEqual({ allowed: true, rule: 'Allow: /x/ok' });
    expect(robotsVerdict('/x/no', rules)).toEqual({ allowed: false, rule: 'Disallow: /x' });
    expect(robotsVerdict('/same', rules).allowed).toBe(true);
    expect(robotsVerdict('/doc/a.pdf', rules).allowed).toBe(false);
    expect(robotsVerdict('/doc/a.pdf?x=1', rules).allowed).toBe(true);
    expect(robotsVerdict('/q?page=2&sort=new', rules).allowed).toBe(false);
    expect(robotsVerdict('/khac', rules)).toEqual({ allowed: true, rule: null });
  });
});

describe('tín hiệu của trang', () => {
  it('isNoindex: noindex/none, cả dạng có tên bot; index,follow thì không', () => {
    for (const v of ['noindex', 'noindex, follow', 'NOINDEX,NOFOLLOW', 'none', 'googlebot: noindex', 'googlebot:noindex']) expect(isNoindex(v), v).toBe(true);
    for (const v of ['index, follow', 'max-image-preview:large', 'max-snippet:50, noarchive', '', null, undefined]) expect(isNoindex(v), String(v)).toBe(false);
  });

  it('isNoindex: chỉ thị có tên bot khác (bingbot: noindex) không áp cho Googlebot; tên bot áp cho các chỉ thị sau nó', () => {
    expect(isNoindex('bingbot: noindex')).toBe(false);
    expect(isNoindex('bingbot: noindex, nofollow')).toBe(false);
    expect(isNoindex('bingbot: nofollow, googlebot: noindex')).toBe(true);
    expect(isNoindex('noindex, bingbot: nofollow')).toBe(true);
  });

  it('sameUrl: trùng hẳn đường dẫn (`/` cuối là URL khác: middleware 308 nó), phân biệt host và query', () => {
    expect(sameUrl(`${SITE}/gioi-thieu`, `${SITE}/gioi-thieu`)).toBe(true);
    expect(sameUrl(`${SITE}/gioi-thieu/`, `${SITE}/gioi-thieu`)).toBe(false);
    expect(sameUrl(SITE, `${SITE}/`)).toBe(true);
    expect(sameUrl(`${SITE}/san-pham?category=a`, `${SITE}/san-pham?category=a`)).toBe(true);
    expect(sameUrl(`${SITE}/san-pham?category=a`, `${SITE}/san-pham`)).toBe(false);
    expect(sameUrl('https://app.tubutree.com/gioi-thieu', `${SITE}/gioi-thieu`)).toBe(false);
    expect(sameUrl('khong-phai-url', `${SITE}/`)).toBe(false);
  });

  it('kindOf phân loại theo đường dẫn', () => {
    expect(kindOf(`${SITE}/`)).toBe('home');
    expect(kindOf(`${SITE}/chinh-sach/bao-mat`)).toBe('legal');
    expect(kindOf(`${SITE}/san-pham/nuoc-giat`)).toBe('product');
    expect(kindOf(`${SITE}/san-pham?category=c1`)).toBe('category');
    expect(kindOf(`${SITE}/san-pham`)).toBe('static');
    expect(kindOf(`${SITE}/brand/sokfarm`)).toBe('brand');
    expect(kindOf(`${SITE}/s/chi-lan`)).toBe('storefront');
    expect(kindOf(`${SITE}/chien-dich/tet`)).toBe('campaign');
    expect(kindOf(`${SITE}/gioi-thieu`)).toBe('static');
  });

  it('pageProblems: trang đạt không có lỗi; canonical tương đối được hiểu theo URL của trang', () => {
    const rules = parseRobots(robotsText());
    expect(pageProblems(`${SITE}/gioi-thieu`, ok(page(`${SITE}/gioi-thieu`)), rules)).toEqual([]);
    expect(pageProblems(`${SITE}/gioi-thieu`, ok(page('/gioi-thieu')), rules)).toEqual([]);
    expect(pageProblems(`${SITE}/san-pham?category=c1`, ok(page(`${SITE}/san-pham?category=c1`)), rules)).toEqual([]);
  });

  it('pageProblems bắt từng lỗi: chuyển hướng, 404, lỗi mạng, thiếu/lệch canonical, noindex (meta và header), robots chặn', () => {
    const rules = parseRobots(robotsText());
    const loc = `${SITE}/gioi-thieu`;
    expect(pageProblems(loc, { status: 308, headers: {}, location: '/gioi-thieu-moi', body: '' }, rules)[0]).toMatch(/308 chuyển hướng → \/gioi-thieu-moi/);
    expect(pageProblems(loc, { status: 404, headers: {}, location: null, body: '' }, rules)).toEqual(['HTTP 404']);
    expect(pageProblems(loc, { status: 0, headers: {}, location: null, body: '', error: 'ECONNREFUSED' }, rules)).toEqual(['lỗi mạng (ECONNREFUSED)']);
    expect(pageProblems(loc, ok(page(null)), rules)).toEqual(['không có <link rel="canonical"> trong <head>']);
    expect(pageProblems(loc, ok(page(`${loc}/`)), rules)).toEqual([`canonical ${loc}/ khác URL của sitemap`]);
    expect(pageProblems(loc, ok(page(`${SITE}/`)), rules)).toEqual([`canonical ${SITE}/ khác URL của sitemap`]);
    expect(pageProblems(loc, ok(page('https://app.tubutree.com/gioi-thieu')), rules)[0]).toMatch(/khác URL/);
    expect(pageProblems(`${SITE}/san-pham?category=c1`, ok(page(`${SITE}/san-pham`)), rules)[0]).toMatch(/khác URL/);
    expect(pageProblems(loc, ok(page(loc, '<meta name="robots" content="noindex, follow"/>')), rules)).toEqual(['<meta name="robots" content="noindex, follow">']);
    expect(pageProblems(loc, ok(page(loc, '<meta name="googlebot" content="none"/>')), rules)).toEqual(['<meta name="googlebot" content="none">']);
    expect(pageProblems(loc, ok(page(loc), { 'x-robots-tag': 'noindex, nofollow' }), rules)).toEqual(['X-Robots-Tag: noindex, nofollow']);
    expect(pageProblems(`${SITE}/gio-hang`, ok(page(`${SITE}/gio-hang`)), rules)).toEqual(['robots.txt chặn (Disallow: /gio-hang)']);
  });

  it('chỉ đọc <head> như Google: canonical/noindex ở <body> (metadata theo luồng) không tính; nhiều canonical khác nhau hay meta noindex thứ hai đều bị bắt', () => {
    const rules = parseRobots(robotsText());
    const loc = `${SITE}/gioi-thieu`;
    const streamed = `<!doctype html><html><head><title>t</title></head><body><link rel="canonical" href="${loc}"/></body></html>`;
    expect(pageProblems(loc, ok(streamed), rules)).toEqual(['không có <link rel="canonical"> trong <head>']);
    expect(pageProblems(loc, ok('<html><body>x</body></html>'), rules)).toEqual(['không có <head> (Google không đọc canonical/robots ngoài <head>)']);
    expect(pageProblems(loc, ok(page(loc, `<link rel="canonical" href="${SITE}/"/>`)), rules)).toEqual([`2 canonical khác nhau: ${loc}, ${SITE}/`]);
    expect(pageProblems(loc, ok(page(loc, '<link rel="canonical" href="/gioi-thieu"/>')), rules)).toEqual([]);
    expect(pageProblems(loc, ok(page(loc, '<meta name="robots" content="index"/><meta name="robots" content="noindex"/>')), rules)).toEqual([
      '<meta name="robots" content="noindex">',
    ]);
    expect(pageProblems(loc, ok(page(loc, '<meta name="bingbot" content="noindex"/>')), rules)).toEqual([]);
    expect(pageProblems(loc, ok(page(loc), { 'x-robots-tag': 'bingbot: noindex' }), rules)).toEqual([]);
  });

  it('headOf/headSignals: thẻ <header> không phải <head>; đọc mọi canonical và meta robots/googlebot', () => {
    expect(headOf('<html><header>x</header><body></body></html>')).toBeNull();
    expect(headOf('<html><head data-x="1"><meta name="robots" content="noindex"></head></html>')).toBe('<meta name="robots" content="noindex">');
    expect(headSignals('<link rel="alternate canonical" href="/a"><link href="/b" rel="canonical"><meta name="googlebot" content="none">')).toEqual({
      canonicals: ['/a', '/b'],
      robots: [{ name: 'googlebot', content: 'none' }],
    });
  });

  it('withRetry: thử lại lỗi mạng/429/5xx tối đa 2 lần rồi trả lần cuối; 200 hay 404 thì không thử lại', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const seq = (statuses: number[]) => {
      let i = 0;
      return async (): Promise<GuardResponse> => ({ status: statuses[Math.min(i++, statuses.length - 1)]!, headers: {}, location: null, body: '' });
    };
    expect((await withRetry(seq([502, 0, 200]), { sleep })('u')).status).toBe(200);
    expect(waits).toEqual([1000, 3000]);
    waits.length = 0;
    expect((await withRetry(seq([429, 503, 503, 200]), { sleep })('u')).status).toBe(503);
    expect(waits).toEqual([1000, 3000]);
    waits.length = 0;
    expect((await withRetry(seq([404, 200]), { sleep })('u')).status).toBe(404);
    expect(waits).toEqual([]);
  });
});

describe('analyzeLocs — danh sách URL của sitemap', () => {
  const base = [`${SITE}/`, `${SITE}/gioi-thieu`, ...LEGAL_LOCS];

  it('đủ trang chủ + 5 trang chính sách, đúng host: chỉ PASS; đếm theo loại', () => {
    const { counts, findings } = analyzeLocs([...base, `${SITE}/san-pham/a`, `${SITE}/san-pham?category=c`], SITE);
    expect(fails(findings)).toEqual([]);
    expect(findings).toContainEqual({ check: 'legal', level: 'PASS', message: 'đủ 5 trang chính sách /chinh-sach/*' });
    expect(counts).toEqual({ home: 1, static: 1, legal: 5, product: 1, category: 1 });
  });

  it('thiếu trang chính sách: FAIL kể tên từng trang thiếu', () => {
    const { findings } = analyzeLocs(base.filter((l) => !/doi-tra|bao-mat/.test(l)), SITE);
    const legal = fails(findings);
    expect(legal).toHaveLength(1);
    expect(legal[0]).toContain('thiếu 2/5 trang chính sách: /chinh-sach/bao-mat, /chinh-sach/doi-tra');
  });

  it('URL host lạ (app.*, localhost) và thiếu trang chủ là FAIL; URL trùng là WARN', () => {
    const { findings } = analyzeLocs([...base.slice(1), 'https://app.tubutree.com/gioi-thieu', 'http://localhost:3000/x', `${SITE}/gioi-thieu`], SITE);
    const msgs = fails(findings);
    expect(msgs.some((m) => m.startsWith('2 URL không thuộc https://tubutree.com'))).toBe(true);
    expect(msgs).toContain('không có trang chủ "/"');
    expect(findings.find((f) => f.level === 'WARN')?.message).toMatch(/^1 URL trùng/);
  });
});

describe('pickLocs — lấy mẫu', () => {
  it('giữ mọi trang tĩnh/chính sách/trang chủ, lấy mẫu đều các loại nhiều trang, bỏ trùng; 0 = tất cả', () => {
    const products = Array.from({ length: 30 }, (_, i) => `${SITE}/san-pham/sp-${i}`);
    const locs = [`${SITE}/`, ...LEGAL_LOCS, `${SITE}/gioi-thieu`, ...products, `${SITE}/gioi-thieu`];
    const picked = pickLocs(locs, 3);
    expect(picked.filter((l) => kindOf(l) === 'product')).toEqual([products[0], products[14], products[29]]);
    expect(picked.filter((l) => kindOf(l) !== 'product')).toEqual([`${SITE}/`, ...LEGAL_LOCS, `${SITE}/gioi-thieu`]);
    expect(pickLocs(locs, 0)).toHaveLength(locs.length - 1);
  });
});

describe('runGuard — máy chủ giả', () => {
  const healthy = (extra: Record<string, GuardResponse> = {}, locs?: string[]) => {
    const all = locs ?? [`${SITE}/`, `${SITE}/gioi-thieu`, `${SITE}/san-pham/a`, `${SITE}/san-pham?category=c1`, ...LEGAL_LOCS];
    const routes: Record<string, GuardResponse> = {
      '/robots.txt': ok(robotsText()),
      '/sitemap.xml': ok(sitemapXml(all)),
      ...Object.fromEntries(all.map((l) => [new URL(l).pathname + new URL(l).search, ok(page(l))])),
      ...extra,
    };
    const calls: string[] = [];
    const request = async (url: string): Promise<GuardResponse> => {
      calls.push(url);
      const u = new URL(url);
      return routes[u.pathname + u.search] ?? { status: 404, headers: {}, location: null, body: '' };
    };
    return { request, calls };
  };

  it('site đạt: không FAIL; tải trên --base cùng đường dẫn khi canonical là host khác', async () => {
    const { request, calls } = healthy();
    const report = await runGuard({ base: 'http://localhost:3999', canonical: SITE, request });
    expect(fails(report.findings)).toEqual([]);
    expect(report.checked).toBe(9);
    expect(report.findings.at(-1)).toMatchObject({ check: 'pages', level: 'PASS' });
    expect(report.findings.at(-1)!.message).toMatch(/^9\/9 URL đạt/);
    expect(calls.every((c) => c.startsWith('http://localhost:3999/'))).toBe(true);
    expect(calls).toContain('http://localhost:3999/san-pham?category=c1');
  });

  it('site hỏng: báo từng URL lỗi và trang chính sách thiếu', async () => {
    const locs = [`${SITE}/`, `${SITE}/gioi-thieu`, `${SITE}/cau-chuyen`, `${SITE}/gio-hang`, ...LEGAL_LOCS.slice(0, 4)];
    const { request } = healthy(
      {
        '/gioi-thieu': { status: 301, headers: {}, location: `${SITE}/ve-chung-toi`, body: '' },
        '/cau-chuyen': ok(page(`${SITE}/`)),
      },
      locs,
    );
    const report = await runGuard({ base: SITE, request });
    const msgs = fails(report.findings);
    expect(msgs).toContain(`/gioi-thieu: HTTP 301 chuyển hướng → ${SITE}/ve-chung-toi; sitemap phải khai URL cuối`);
    expect(msgs).toContain(`/cau-chuyen: canonical ${SITE}/ khác URL của sitemap`);
    expect(msgs).toContain('/gio-hang: robots.txt chặn (Disallow: /gio-hang)');
    expect(msgs.some((m) => m.startsWith('thiếu 1/5 trang chính sách: /chinh-sach/thanh-toan'))).toBe(true);
    expect(msgs.some((m) => m.startsWith('5/8 URL đạt'))).toBe(true);
  });

  it('/sitemap.xml không 200: FAIL và dừng; robots.txt thiếu chỉ WARN', async () => {
    const report = await runGuard({ base: SITE, request: async () => ({ status: 404, headers: {}, location: null, body: '' }) });
    expect(report.findings).toEqual([
      { check: 'robots', level: 'WARN', message: '/robots.txt: HTTP 404 (coi như không chặn gì)' },
      { check: 'sitemap', level: 'FAIL', message: '/sitemap.xml: HTTP 404' },
    ]);
    expect(report.checked).toBe(0);
  });

  it('robots.txt lỗi máy chủ (503) là FAIL: Google ngừng cào cả site', async () => {
    const { request } = healthy({ '/robots.txt': { status: 503, headers: {}, location: null, body: '' } });
    const report = await runGuard({ base: SITE, request });
    expect(fails(report.findings)).toEqual(['/robots.txt: HTTP 503 (Google ngừng cào cả site khi robots.txt lỗi máy chủ)']);
  });

  it('sitemapindex hơn 50 sitemap con: WARN, không im lặng bỏ phần sau', async () => {
    const locs = [`${SITE}/`, ...LEGAL_LOCS];
    const children = Array.from({ length: 51 }, (_, i) => `<sitemap><loc>${SITE}/sitemap/${i}.xml</loc></sitemap>`).join('');
    const index = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${children}</sitemapindex>`;
    const { request } = healthy({ '/sitemap.xml': ok(index), '/sitemap/0.xml': ok(sitemapXml(locs)) }, locs);
    const report = await runGuard({ base: SITE, request });
    expect(report.findings).toContainEqual({ check: 'sitemap', level: 'WARN', message: 'sitemapindex có 51 sitemap con, chỉ kiểm 50 cái đầu' });
  });

  it('sitemapindex: đọc từng sitemap con', async () => {
    const locs = [`${SITE}/`, ...LEGAL_LOCS];
    const index = `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${SITE}/sitemap/0.xml</loc></sitemap></sitemapindex>`;
    const { request } = healthy({ '/sitemap.xml': ok(index), '/sitemap/0.xml': ok(sitemapXml(locs)) }, locs);
    const report = await runGuard({ base: SITE, request });
    expect(fails(report.findings)).toEqual([]);
    expect(report.checked).toBe(6);
  });
});

describe('parseArgs', () => {
  it('đọc tham số, cả dạng --x=y; chuẩn hoá về origin', () => {
    expect(parseArgs(['--base', 'http://localhost:3000/', '--canonical=https://tubutree.com/x', '--max-per-kind', '20', '--json'])).toMatchObject({
      base: 'http://localhost:3000',
      canonical: 'https://tubutree.com',
      maxPerKind: 20,
      concurrency: 4,
      json: true,
      strict: false,
    });
    expect(parseArgs(['--base', 'https://x.vn', '--ua', 'curl/8']).ua).toBe('curl/8');
    expect(DEFAULT_UA).toMatch(/Googlebot/);
  });

  it('thiếu --base, URL sai, số sai, tham số lạ: ném lỗi', () => {
    expect(() => parseArgs([])).toThrow('thiếu --base');
    expect(() => parseArgs(['--base', 'tubutree.com'])).toThrow(/URL tuyệt đối/);
    expect(() => parseArgs(['--base', 'ftp://x.vn'])).toThrow(/http\(s\)/);
    expect(() => parseArgs(['--base', 'https://x.vn', '--concurrency', '0'])).toThrow(/>= 1/);
    expect(() => parseArgs(['--base', 'https://x.vn', '--max-per-kind'])).toThrow(/cần giá trị/);
    expect(() => parseArgs(['--base', 'https://x.vn', '--la'])).toThrow(/tham số lạ/);
    expect(parseArgs(['--help']).help).toBe(true);
  });
});

describe('dòng lệnh trên máy chủ HTTP thật', () => {
  const run = promisify(execFile);
  let server: Server;
  let base = '';
  let brokenLegal = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x');
      const locs = [`${SITE}/`, `${SITE}/gioi-thieu`, ...LEGAL_LOCS];
      if (url.pathname === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end(robotsText());
      if (url.pathname === '/sitemap.xml') return res.writeHead(200, { 'content-type': 'application/xml' }).end(sitemapXml(locs));
      if (url.pathname === '/chinh-sach/doi-tra' && brokenLegal) return res.writeHead(307, { location: '/' }).end();
      // Như Next với htmlLimitedBots: UA có "Googlebot" nhận metadata trong <head>, UA khác nhận metadata theo luồng ở <body>.
      const canonical = `<link rel="canonical" href="${SITE}${url.pathname}"/>`;
      const html = /Googlebot/i.test(req.headers['user-agent'] ?? '') ? page(`${SITE}${url.pathname}`) : `<html><head><title>t</title></head><body>${canonical}</body></html>`;
      if (locs.some((l) => new URL(l).pathname === url.pathname)) return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
      return res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('site đạt: mã thoát 0, KẾT LUẬN: ĐẠT', async () => {
    brokenLegal = false;
    const { stdout } = await run(process.execPath, [SCRIPT, '--base', base, '--canonical', SITE], { timeout: 30_000 });
    expect(stdout).toContain('KẾT LUẬN: ĐẠT.');
    expect(stdout).toContain('7/7 URL đạt');
  });

  it('trang chính sách chuyển hướng (fetch không tự đi theo): mã thoát 1, JSON có FAIL đúng URL', async () => {
    brokenLegal = true;
    const err = await run(process.execPath, [SCRIPT, '--base', base, '--canonical', SITE, '--json'], { timeout: 30_000 }).catch((e: { code: number; stdout: string }) => e);
    expect((err as { code: number }).code).toBe(1);
    const report = JSON.parse((err as { stdout: string }).stdout) as { summary: { fail: number }; findings: { level: string; message: string }[] };
    expect(fails(report.findings)).toContain('/chinh-sach/doi-tra: HTTP 307 chuyển hướng → /; sitemap phải khai URL cuối');
    expect(report.summary.fail).toBe(2);
  });

  it('UA không có "Googlebot" nhận metadata ở <body>: canonical không được tính (mã thoát 1)', async () => {
    brokenLegal = false;
    const err = await run(process.execPath, [SCRIPT, '--base', base, '--canonical', SITE, '--ua', 'curl/8', '--json'], { timeout: 30_000 }).catch((e: { code: number; stdout: string }) => e);
    expect((err as { code: number }).code).toBe(1);
    const report = JSON.parse((err as { stdout: string }).stdout) as { findings: { level: string; message: string }[] };
    expect(fails(report.findings)).toContain('/gioi-thieu: không có <link rel="canonical"> trong <head>');
  });

  it('sai tham số: mã thoát 2 kèm hướng dẫn', async () => {
    const err = await run(process.execPath, [SCRIPT], { timeout: 30_000 }).catch((e: { code: number; stderr: string }) => e);
    expect((err as { code: number }).code).toBe(2);
    expect((err as { stderr: string }).stderr).toContain('Dùng: node scripts/ci/sitemap-guard/index.mjs');
  });
});
