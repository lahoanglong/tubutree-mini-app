import { test, expect } from '@playwright/test';

/**
 * Googlebot đọc robots/canonical theo HTML đầu. Ở /san-pham (route động) Next mặc định trả metadata theo luồng, nên khi generateMetadata về
 * sau phần thân (nhãn hoặc danh mục lạ phải hỏi API) thẻ meta rơi vào <body> và bị bỏ qua. Googlebot nằm trong htmlLimitedBots (next.config)
 * nên metadata phải nằm trong <head> với mọi trạng thái. Gọi HTTP thẳng (không trình duyệt) như bot.
 */
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const GOOGLEBOT_UAS = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.139 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
];

function headOf(html: string): string {
  const end = html.indexOf('</head>');
  expect(end, 'HTML có </head>').toBeGreaterThan(0);
  return html.slice(0, end);
}

const ROBOTS_NOINDEX = /<meta name="robots" content="noindex, follow"\s*\/?>/;

for (const ua of GOOGLEBOT_UAS) {
  const kind = ua.includes('Android') ? 'điện thoại' : 'desktop';

  test(`Googlebot ${kind}: noindex nằm trong <head> với từ khoá, nhãn lạ, danh mục lạ`, async ({ request, baseURL }) => {
    for (const path of ['/san-pham?q=dau-goi', '/san-pham?brand=khong-co-nhan-nay-e2e', '/san-pham?category=khong-co-danh-muc-e2e']) {
      const res = await request.get(`${baseURL}${path}`, { headers: { 'user-agent': ua } });
      expect(res.status(), path).toBe(200);
      expect(headOf(await res.text()), path).toMatch(ROBOTS_NOINDEX);
    }
  });

  test(`Googlebot ${kind}: canonical của trang nhãn có thật nằm trong <head>`, async ({ request, baseURL }) => {
    const brands = await request.get(`${API_ORIGIN}/api/brands`).catch(() => null);
    const brand = brands?.ok() ? ((await brands.json()) as { brand: string }[])[0]?.brand : undefined;
    test.skip(!brand, 'DB e2e chưa có nhãn nào');
    const res = await request.get(`${baseURL}/san-pham?brand=${encodeURIComponent(brand!)}`, { headers: { 'user-agent': ua } });
    expect(res.status()).toBe(200);
    const head = headOf(await res.text());
    expect(head).toMatch(/<link rel="canonical" href="[^"]*\/san-pham\?brand=[^"]+"/);
    expect(head).not.toMatch(ROBOTS_NOINDEX);
  });
}
