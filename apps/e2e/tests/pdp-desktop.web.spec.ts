import type { APIRequestContext } from '@playwright/test';
import { expect, makeUser, mockSession, test } from './support/mock-api';

/**
 * Trang sản phẩm web ở khổ máy tính 1280×800: ảnh 440px và thông tin nằm trong một thẻ, cuộn cùng một trang (không cột dính tự cuộn),
 * nên nút "Thêm vào giỏ" nằm TRỌN trong khung nhìn đầu tiên, cả ở ca nặng nhất của việc mua: đã đăng nhập, đang Giờ vàng (thanh giá cao
 * ~136px dưới ảnh), có mã giảm giá, sản phẩm nhiều phân loại (nhiều hàng chip). Phần server của Next gọi API thật nên spec lấy sản phẩm
 * có nhiều phân loại còn hàng nhất trong DB e2e và tự bỏ qua khi DB chưa có; mọi lời gọi từ trình duyệt đi qua mock. Cần API thật:
 * chạy ở CI (web-gate.sh), không chạy ở Mini.
 */
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;
const VIEWPORT = { width: 1280, height: 800 };

interface Detail {
  slug: string;
  variations: { id: string; stock: number; retailPrice: number; salePrice: number | null }[];
}

async function richestProduct(request: APIRequestContext): Promise<Detail | null> {
  const res = await request.get(`${API_ORIGIN}/api/products?limit=20`).catch(() => null);
  if (!res?.ok()) return null;
  const slugs = ((await res.json()) as { data?: { slug: string }[] }).data?.map((x) => x.slug) ?? [];
  const details = await Promise.all(
    slugs.map(async (slug) => {
      const r = await request.get(`${API_ORIGIN}/api/products/${encodeURIComponent(slug)}`).catch(() => null);
      return r?.ok() ? ((await r.json()) as Detail) : null;
    }),
  );
  const inStock = (d: Detail) => d.variations.filter((v) => v.stock > 0).length;
  return details.filter((d): d is Detail => d !== null && inStock(d) > 0).sort((a, b) => inStock(b) - inStock(a))[0] ?? null;
}

test.describe('Web khách: trang sản phẩm khổ máy tính', () => {
  test('nút Thêm vào giỏ nằm trọn trong khung 1280×800 khi đăng nhập + Giờ vàng + mã giảm giá, và không có vùng cuộn dọc riêng trong trang', async ({ page, api, request }) => {
    const p = await richestProduct(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm nào còn hàng');
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
    mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
    // Phân loại đầu tiên còn hàng là phân loại được chọn sẵn: đợt Giờ vàng gắn đúng nó để thanh Giờ vàng hiện dưới ảnh.
    const first = p!.variations.find((v) => v.stock > 0)!;
    api.get('/flash-sales/active', [
      {
        itemId: 'f1',
        variationId: first.id,
        productSlug: p!.slug,
        flashPrice: Math.round((first.salePrice ?? first.retailPrice) * 0.7),
        retailPrice: first.retailPrice,
        salePrice: first.salePrice,
        soldCount: 78,
        quota: 100,
        perUserLimit: 3,
        endAt: new Date(Date.now() + 2 * 3_600_000 + 4 * 60_000).toISOString(),
      },
    ]);
    api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
    api.get(`/products/${p!.slug}`, { variations: p!.variations });
    api.get(`/products/${p!.slug}/related`, []);
    api.get(`/products/${p!.slug}/bought-together`, []);
    api.get('/products/for-you', []);
    api.get(`/products/${p!.slug}/reviews`, { average: 4.6, count: 27, videoCount: 0, distribution: {}, items: [] });
    api.get(`/products/${p!.slug}/reviews/can-review`, { canReview: false });
    api.get('/me/wishlist/ids', []);
    api.get('/affiliate/me', { isAffiliate: false });
    api.get('/me/coupons', [
      { code: 'GIAM20', type: 'AMOUNT', value: 20000, minOrder: 100000, maxDiscount: null, endAt: '2027-01-01T00:00:00.000Z' },
      { code: 'GIAM10', type: 'PERCENT', value: 10, minOrder: 100000, maxDiscount: 30000, endAt: '2027-01-01T00:00:00.000Z' },
    ]);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`/san-pham/${p!.slug}`);

    // Chờ các khối cao nhất của ca nặng dựng xong rồi mới đo, không thì đo lúc trang còn gọn.
    await expect(page.getByTestId('flash-price-bar')).toBeVisible();
    await expect(page.getByRole('button', { name: /Ưu đãi/ })).toBeVisible();
    const add = page.getByRole('button', { name: /Thêm vào giỏ/ }).first();
    await expect(add).toBeVisible();
    // Ratio 1: cả nút nằm trong khung, không chỉ một hàng điểm ảnh chạm mép dưới.
    await expect(add).toBeInViewport({ ratio: 1 });
    const box = (await add.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height);

    const scrollers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('main *'))
        .filter((el) => {
          const overflowY = getComputedStyle(el).overflowY;
          return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight && !el.closest('[role="dialog"]');
        })
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`),
    );
    expect(scrollers).toEqual([]);
  });
});
