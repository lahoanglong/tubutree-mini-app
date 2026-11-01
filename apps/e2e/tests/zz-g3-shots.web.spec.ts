import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './support/mock-api';

// Tạm (G3, không commit): chụp PDP web 375 và 1280 cho sản phẩm >= 2 phân loại đang Giờ vàng.
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const OUT = process.env.G3_SHOTS_DIR ?? '/tmp/g3-shots';

interface Detail {
  slug: string;
  variations: { id: string; stock: number; retailPrice: number; salePrice: number | null }[];
}

async function multi(request: APIRequestContext): Promise<Detail | null> {
  const res = await request.get(`${API_ORIGIN}/api/products?limit=50`).catch(() => null);
  if (!res?.ok()) return null;
  const slugs = ((await res.json()) as { data?: { slug: string }[] }).data?.map((x) => x.slug) ?? [];
  for (const slug of slugs) {
    const r = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
    const d = r?.ok() ? ((await r.json()) as Detail) : null;
    if (d && d.variations.length >= 2) return d;
  }
  return null;
}

const review = (id: string, rating: number) => ({
  id, rating, author: `Khách ${id}`, avatar: null, comment: `Nhận xét ${id}: dùng rất ổn, mùi dễ chịu.`, images: [], videoUrl: null,
  verifiedPurchase: true, createdAt: '2026-09-01T00:00:00.000Z',
});

for (const [name, viewport] of [['web375', { width: 375, height: 812 }], ['web1280', { width: 1280, height: 800 }]] as const) {
  test(`chụp PDP ${name}`, async ({ page, api, request }) => {
    const p = await multi(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào từ 2 phân loại');
    const first = p!.variations.find((v) => v.stock > 0)!;
    api.get('/flash-sales/active', [
      {
        itemId: 'f1', variationId: first.id, productSlug: p!.slug, flashPrice: Math.round((first.salePrice ?? first.retailPrice) * 0.7),
        retailPrice: first.retailPrice, salePrice: first.salePrice, soldCount: 68, quota: 100, perUserLimit: 3,
        endAt: new Date(Date.now() + 2 * 3_600_000 + 4 * 60_000).toISOString(),
      },
    ]);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p!.slug}`, { variations: p!.variations });
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
    api.get(`/products/${p!.slug}/reviews`, { average: 4.4, count: 27, videoCount: 0, distribution: { '5': 14, '4': 9, '3': 4 }, items: [review('a', 5), review('b', 4), review('c', 3)] });
    api.get('/me/wishlist/ids', []);
    await page.setViewportSize(viewport);
    await page.goto(`/san-pham/${p!.slug}`);
    await expect(page.locator('[data-section="pdp-reviews"]')).toBeVisible();
    await expect(page.getByTestId('flash-price-bar')).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  });
}
