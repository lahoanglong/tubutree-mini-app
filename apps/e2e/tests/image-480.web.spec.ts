import { deflateSync, crc32 } from 'zlib';
import { expect, test, type MockApi } from './support/mock-api';
import { CATALOG, mockDiscovery, toCard } from './support/discovery-mocks';
import { mockCampaigns } from './support/campaign-mocks';

/**
 * Chromium chọn ứng viên srcset nhỏ nhất ≥ bề rộng hiển thị × DPR. Ô rail 128–148px ở 412@2.625 cần 336–389px: phải rơi vào bản 480 (trước đây là 640).
 * `/api/img` bị chặn và trả PNG nhiễu nên không cần API/mạng thật.
 */
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625 });

function noisePng(size = 160): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    head.copy(out, 4);
    out.writeUInt32BE(crc32(head), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size, 90);
  for (let y = 0; y < size; y++) raw[y * row] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const withImages = CATALOG.map((p, i) => ({ ...p, thumbnail: `https://content.pancake.vn/2-26/img480-${i}.jpg` }));

function mockImages(api: MockApi): void {
  mockDiscovery(api, { tree: true });
  api.get('/products', ({ call }) => {
    const limit = Number(call.query.get('limit') ?? '20');
    const page = Number(call.query.get('page') ?? '1');
    return { data: withImages.slice((page - 1) * limit, page * limit).map(toCard), meta: { page, limit, total: withImages.length } };
  });
  api.get('/flash-sales/active', () => {
    const now = Date.now();
    return withImages.slice(4, 8).map((p, i) => ({
      itemId: `fi-${p.id}`, variationId: `v-${p.id}`, productSlug: p.slug, productName: p.name, variationName: null, thumbnail: p.thumbnail,
      flashPrice: 59_000 + i * 1_000, retailPrice: p.basePrice, salePrice: p.salePrice, soldCount: 10 + i, quota: 50,
      endAt: new Date(now + 3_600_000).toISOString(), serverNow: new Date(now).toISOString(),
    }));
  });
  mockCampaigns(api, { home: [], offers: [] });
}

test('rail Trang chủ 412@2.625: ảnh ô 128–148px chọn bản /img?w=480', async ({ page, api }) => {
  mockImages(api);
  await page.route('**/api/img?**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: noisePng() }));
  await page.goto('/');
  await expect(page.locator('[data-ds="product-tile"]').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle');
  await page.locator('[data-ds="product-tile"] img').first().scrollIntoViewIfNeeded();
  const picks = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('[data-ds="product-tile"] img'))
      .filter((img) => img.currentSrc.includes('/img?') && img.getBoundingClientRect().width >= 120 && img.getBoundingClientRect().width <= 156)
      .map((img) => ({ w: Math.round(img.getBoundingClientRect().width), width: new URL(img.currentSrc).searchParams.get('w') })),
  );
  expect(picks.length, 'phải có ảnh rail 128–148px đi qua /img').toBeGreaterThan(0);
  for (const p of picks) expect(p.width, `ô ${p.w}px`).toBe('480');
});
