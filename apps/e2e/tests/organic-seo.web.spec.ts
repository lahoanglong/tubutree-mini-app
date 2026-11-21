import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { summarizeOpeningHours } from '../../../packages/app-core/src/waste-hours';
import { withSharedConfigLock } from './support/shared-config-lock';

/**
 * SEO organic của web trên API thật (DB tạm của web-gate.sh): sitemap phủ đủ sản phẩm và danh mục đang bán, robots chặn trang riêng tư,
 * JSON-LD của PDP khớp đúng số liệu API (không bịa sao), Trang chủ có Organization + WebSite và HTML gọn, /doi-rac khai FAQPage đúng
 * phần đang hiển thị và chỉ khi chương trình bật. Gọi HTTP như bot; phần cần đọc DOM dùng trình duyệt tắt JS để chỉ thấy HTML máy chủ.
 */
const API = `http://localhost:${process.env.E2E_API_PORT}/api`;
const HOME_HTML_MAX = 245_000;

type Ld = Record<string, unknown>;
const ldBlocks = (html: string): Ld[] =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Ld);
const pathOf = (loc: string) => {
  const u = new URL(loc);
  return `${u.pathname}${u.search}`;
};

async function apiJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(`${API}${path}`);
  expect(res.status(), path).toBe(200);
  return (await res.json()) as T;
}

interface CategoryNode {
  id: string;
  productCount?: number;
  children?: CategoryNode[];
}
const flatten = (nodes: CategoryNode[], seen = new Set<string>()): CategoryNode[] =>
  nodes.flatMap((n) => (seen.has(n.id) ? [] : (seen.add(n.id), [n, ...flatten(n.children ?? [], seen)])));

async function activeProductSlugs(request: APIRequestContext): Promise<string[]> {
  const slugs: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const { data } = await apiJson<{ data: { slug: string }[] }>(request, `/products?limit=100&page=${page}`);
    slugs.push(...data.map((p) => p.slug));
    if (data.length < 100) break;
  }
  return slugs;
}

test.describe('SEO organic (sitemap, robots, JSON-LD, FAQ)', () => {
  test('sitemap.xml: mọi sản phẩm đang bán, mọi danh mục còn hàng, các landing công khai; không trang riêng tư', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1]!.replace(/&amp;/g, '&')));

    for (const p of ['/', '/doi-rac', '/doi-rac/quy-dinh', '/vuon-xanh', '/gioi-thieu', '/san-pham']) expect(locs, p).toContain(p);
    for (const p of ['/gio-hang', '/thanh-toan', '/don', '/admin', '/tai-khoan', '/dang-nhap']) {
      expect(locs.filter((l) => l === p || l.startsWith(`${p}/`)), p).toEqual([]);
    }

    const slugs = await activeProductSlugs(request);
    expect(slugs.length).toBeGreaterThan(0);
    const productLocs = new Set(locs.filter((l) => l.startsWith('/san-pham/')).map((l) => decodeURIComponent(l.slice('/san-pham/'.length))));
    expect(slugs.filter((s) => !productLocs.has(s))).toEqual([]);

    const selling = flatten(await apiJson<CategoryNode[]>(request, '/categories')).filter((c) => (c.productCount ?? 0) > 0);
    for (const c of selling) expect(locs, c.id).toContain(`/san-pham?category=${encodeURIComponent(c.id)}`);
    expect(locs.filter((l) => l.startsWith('/san-pham?category=')).length).toBe(selling.length);
  });

  test('robots.txt chặn giỏ, thanh toán, quản trị và trỏ về sitemap; /don để ngỏ cho bot đọc noindex', async ({ request, baseURL }) => {
    const txt = await (await request.get(`${baseURL}/robots.txt`)).text();
    for (const p of ['/gio-hang', '/thanh-toan', '/admin']) expect(txt).toContain(`Disallow: ${p}\n`);
    expect(txt).not.toMatch(/Disallow: \/doi-rac\n/);
    expect(txt).not.toMatch(/Disallow: \/don\/?\n/);
    expect(txt).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/);
  });

  test('PDP: Product + Offer VND theo tồn kho thật + BreadcrumbList; AggregateRating chỉ khi API có đánh giá hiển thị, đúng số', async ({ request, baseURL }) => {
    const slugs = (await activeProductSlugs(request)).slice(0, 12);
    let checked = 0;
    for (const slug of slugs) {
      const api = await apiJson<{ name: string; ratingAvg: number; reviewCount: number; variations: { stock: number }[]; fulfiller?: { kind: string } }>(
        request,
        `/products/${encodeURIComponent(slug)}`,
      );
      const res = await request.get(`${baseURL}/san-pham/${encodeURIComponent(slug)}`);
      expect(res.status(), slug).toBe(200);
      const blocks = ldBlocks(await res.text());
      type Offer = { '@type': string; priceCurrency: string; availability: string; itemCondition?: string; offers?: Offer[] };
      const product = blocks.find((b) => b['@type'] === 'Product') as { '@id': string; url: string; name: string; offers: Offer; aggregateRating?: Ld } | undefined;
      expect(product, slug).toBeTruthy();
      expect(product!.name).toBe(api.name);
      expect(product!['@id']).toBe(`${product!.url}#product`);
      expect(product!.offers.priceCurrency).toBe('VND');
      if (api.variations.some((v) => v.stock > 0)) expect(product!.offers.availability, slug).toBe('https://schema.org/InStock');
      // Nhiều phân loại: AggregateOffer kèm đúng một Offer mỗi phân loại, tình trạng theo tồn của chính phân loại đó.
      if (api.variations.length > 1) {
        expect(product!.offers['@type'], slug).toBe('AggregateOffer');
        expect(product!.offers.offers, slug).toHaveLength(api.variations.length);
        product!.offers.offers!.forEach((o, i) => {
          expect(o, slug).toMatchObject({ '@type': 'Offer', priceCurrency: 'VND', itemCondition: 'https://schema.org/NewCondition' });
          if (api.fulfiller?.kind !== 'UNAVAILABLE') {
            expect(o.availability, slug).toBe(api.variations[i]!.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock');
          }
        });
      } else {
        expect(product!.offers, slug).toMatchObject({ '@type': 'Offer', itemCondition: 'https://schema.org/NewCondition' });
      }
      if (api.reviewCount >= 1) {
        expect(product!.aggregateRating, slug).toEqual({ '@type': 'AggregateRating', ratingValue: api.ratingAvg, reviewCount: api.reviewCount, bestRating: 5, worstRating: 1 });
      } else {
        expect(product!.aggregateRating, slug).toBeUndefined();
      }
      const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList') as { itemListElement: { item?: string }[] } | undefined;
      expect(crumbs?.itemListElement.at(-1)?.item, slug).toMatch(new RegExp(`/san-pham/${encodeURIComponent(slug)}$`));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  test('/san-pham: hub và danh mục có một @graph CollectionPage + ItemList + BreadcrumbList cùng URL với canonical và og:url; trang sắp xếp (noindex) không có', async ({
    request,
    baseURL,
  }) => {
    const selling = flatten(await apiJson<CategoryNode[]>(request, '/categories')).filter((c) => (c.productCount ?? 0) > 0);
    expect(selling.length).toBeGreaterThan(0);
    const category = `/san-pham?category=${encodeURIComponent(selling[0]!.id)}`;
    type Node = { '@type': string; '@id'?: string; url?: string; breadcrumb?: { '@id': string }; mainEntity?: { itemListElement: { position: number; url: string }[] } };
    for (const path of ['/san-pham', category]) {
      const res = await request.get(`${baseURL}${path}`);
      expect(res.status(), path).toBe(200);
      const html = await res.text();
      const attr = (re: RegExp) => re.exec(html)?.[1]?.replace(/&amp;/g, '&');
      const canonical = attr(/<link rel="canonical" href="([^"]+)"/);
      expect(canonical, path).toBeTruthy();
      expect(pathOf(canonical!), path).toBe(path);
      expect(attr(/<meta property="og:url" content="([^"]+)"/), path).toBe(canonical);
      const blocks = ldBlocks(html);
      expect(blocks, path).toHaveLength(1);
      const graph = blocks[0]!['@graph'] as Node[];
      const page = graph.find((n) => n['@type'] === 'CollectionPage');
      const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList');
      expect(page?.url, path).toBe(canonical);
      expect(page?.breadcrumb?.['@id'], path).toBe(crumbs?.['@id']);
      const items = page?.mainEntity?.itemListElement ?? [];
      // Hub liệt kê kệ Bán chạy (có thể trống trên DB gate chưa có đơn); danh mục còn hàng thì có ít nhất một món.
      if (path === category) expect(items.length, path).toBeGreaterThan(0);
      items.forEach((it, i) => {
        expect(it.position, path).toBe(i + 1);
        expect(pathOf(it.url), path).toMatch(/^\/san-pham\/[^/?]+$/);
      });
    }
    expect(ldBlocks(await (await request.get(`${baseURL}${category}&sort=newest`)).text())).toEqual([]);
  });

  test('verify-apex-cutover --base trên chính bản build này: robots, sitemap, canonical, JSON-LD, header không có FAIL', async ({ baseURL }) => {
    test.setTimeout(120_000);
    // Canonical mong đợi là NEXT_PUBLIC_SITE_URL của bản build (web-gate.sh không đặt nên là mặc định của lib/site.ts), không đọc lại từ
    // chính robots/sitemap. Bỏ redirects (DB gate không có sản phẩm WordPress cũ nên đích 404), img (ảnh seed trỏ host ngoài) và edge
    // (http trên localhost): ba nhóm đó chỉ có nghĩa trên host thật.
    const canonical = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://app.tubutree.com').origin;
    const script = path.resolve(__dirname, '../../../scripts/cutover/verify-apex-cutover.mjs');
    const run = spawnSync(process.execPath, [script, '--base', baseURL!, '--canonical', canonical, '--skip', 'redirects,img,edge', '--json'], { encoding: 'utf8', timeout: 100_000 });
    const report = JSON.parse(run.stdout) as { findings: { check: string; level: string; message: string }[] };
    console.log(report.findings.map((f) => `${f.level} [${f.check}] ${f.message}`).join('\n'));
    expect(report.findings.filter((f) => f.level === 'FAIL')).toEqual([]);
    expect(run.status).toBe(0);
    expect(new Set(report.findings.map((f) => f.check))).toEqual(new Set(['robots', 'sitemap', 'pages']));
  });

  test(`Trang chủ: Organization + WebSite, HTML dưới ${HOME_HTML_MAX} B`, async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/`);
    expect(res.status()).toBe(200);
    const body = await res.body();
    expect(body.length).toBeLessThan(HOME_HTML_MAX);
    const graph = ldBlocks(body.toString('utf8')).flatMap((b) => (Array.isArray(b['@graph']) ? (b['@graph'] as Ld[]) : [b]));
    expect(graph.map((n) => n['@type'])).toEqual(expect.arrayContaining(['Organization', 'WebSite']));
    console.log(`HTML Trang chủ: ${body.length} B`);
  });

  test('/doi-rac: FAQPage đúng phần hiển thị trong HTML máy chủ, chỉ nêu cách giao đang mở và giờ kho thật', async ({ browser, request, baseURL }) => {
    // Dài hơn thời gian chờ khoá (160 giây) cộng phần đọc trang: ca admin giữ khoá tới 150 giây khi máy tải nặng.
    test.setTimeout(240_000);
    // admin-all-tabs bật thử cờ waste.enabled trên cùng DB gate: chờ ca đó trả cờ xong mới đọc cờ và trang, kẻo so trang dựng lúc cờ tắt với cờ đang bật.
    const { waste, warehouses, shown, blocks } = await withSharedConfigLock('waste.enabled', async () => {
      const { waste } = await apiJson<{ waste: { enabled: boolean; dropoff: boolean; mailin: boolean; pickup: boolean } }>(request, '/config/public');
      // Route công khai: không cần đăng nhập.
      const warehouses = await apiJson<{ name: string; openingHours: Record<string, { open: string; close: string }[]> }[]>(request, '/waste/warehouses');
      expect(Array.isArray(warehouses)).toBe(true);

      const ctx = await browser.newContext({ javaScriptEnabled: false });
      try {
        const page = await ctx.newPage();
        await page.goto(`${baseURL}/doi-rac`);
        const shown = await page.locator('main details').evaluateAll((els) =>
          els.map((d) => ({ q: d.querySelector('summary')!.textContent!.trim(), a: d.querySelector('p')!.textContent!.trim() })),
        );
        const blocks = await page.locator('script[type="application/ld+json"]').evaluateAll((els) => els.map((s) => JSON.parse(s.textContent!)));
        return { waste, warehouses, shown, blocks };
      } finally {
        await ctx.close();
      }
    });
    const faq = blocks.find((b) => b['@type'] === 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] } | undefined;

    if (!waste.enabled) {
      expect(faq).toBeUndefined();
      expect(shown).toEqual([]);
      return;
    }
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(faq!.mainEntity.map((e) => ({ q: e.name, a: e.acceptedAnswer.text }))).toEqual(shown);
    const all = JSON.stringify(shown);
    if (!waste.mailin) expect(all).not.toMatch(/tự gửi|hãng vận chuyển|phí ship/);
    if (!waste.pickup) expect(all).not.toMatch(/Thu kèm đơn|người giao|tài xế|bưu tá/);
    if (waste.dropoff) {
      for (const w of warehouses) {
        const hours = summarizeOpeningHours(w.openingHours);
        if (hours.length > 0) expect(all).toContain(hours.join('; '));
      }
    }
  });
});
