import { test, expect } from '@playwright/test';

/**
 * Web: HTML của Trang chủ tải trước hai bản Inter dùng nhiều nhất (400 và 600), và đường dẫn đó là đúng tệp mà @font-face của design-tokens trỏ tới
 * (cùng URL nên trình duyệt không tải trùng). Phục vụ qua `next start` nên đây là bản build thật.
 */
test('Trang chủ: preload phông Inter 400 và 600, tệp phục vụ được và trùng với @font-face trong CSS', async ({ request, baseURL }) => {
  const html = await (await request.get('/')).text();
  const links = [...html.matchAll(/<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin="anonymous"\/?>/g)].map((m) => m[1]!);
  expect(links.map((l) => l.replace(/^\/_next\/static\/media\/(inter-\d+)\.[0-9a-f]+\.woff2$/, '$1')).sort()).toEqual(['inter-400', 'inter-600']);
  for (const href of links) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
    expect(res.headers()['content-type'], href).toMatch(/font\/woff2|application\/octet-stream/);
  }
  const cssHref = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]!);
  const css = (await Promise.all(cssHref.map(async (h) => (await request.get(new URL(h, baseURL).toString())).text()))).join('\n');
  for (const href of links) expect(css, `${href} phải là tệp mà @font-face đang dùng`).toContain(href.replace('/_next/', ''));
});
