import { test, expect } from './support/mock-api';
import { mockDiscovery } from './support/discovery-mocks';
import { mockNoSession } from './support/flash-slot-mocks';

// Tạm (G3, không commit): chụp PDP Mini 375 cho sản phẩm 2 phân loại đang Giờ vàng, khách chưa đăng nhập.
test.use({ viewport: { width: 375, height: 812 } });
const OUT = process.env.G3_SHOTS_DIR ?? '/tmp/g3-shots';
const SLUG = 'nuoc-rua-chen-tubu';

const review = (id: string, rating: number) => ({
  id, rating, author: `Khách ${id}`, avatar: null, comment: `Nhận xét ${id}: dùng rất ổn, mùi dễ chịu.`, images: [], videoUrl: null,
  verifiedPurchase: true, createdAt: '2026-09-01T00:00:00.000Z',
});

test('chụp PDP mini375', async ({ page, api }) => {
  mockDiscovery(api);
  mockNoSession(api);
  const variations = [
    { id: 'v-500', sku: 'S1', name: 'Chai 500ml', attributes: {}, retailPrice: 150_000, salePrice: 120_000, stock: 20 },
    { id: 'v-1l', sku: 'S2', name: 'Chai 1 lít', attributes: {}, retailPrice: 329_000, salePrice: null, stock: 0 },
    { id: 'v-2l', sku: 'S3', name: 'Túi refill 2 lít', attributes: {}, retailPrice: 480_000, salePrice: null, stock: 8 },
  ];
  api.get(`/products/${SLUG}`, {
    id: 'p-nrc', slug: SLUG, brand: 'Tubu', name: 'Nước Rửa Chén Sinh Học Tubu hương sả chanh', shortDesc: 'Rửa sạch dầu mỡ, an toàn cho da tay.', description: 'Nước rửa chén sinh học chiết xuất từ enzyme và dầu thực vật.',
    images: [], thumbnail: null, basePrice: 150_000, salePrice: 120_000, certifications: ['Vegan', 'Không paraben'], ingredients: null, sold: 320, ratingAvg: 4.4, reviewCount: 27, variations,
  });
  api.get('/flash-sales/active', [
    {
      itemId: 'f1', variationId: 'v-500', productSlug: SLUG, productName: 'Nước Rửa Chén', variationName: 'Chai 500ml', thumbnail: null, flashPrice: 84_000, retailPrice: 150_000, salePrice: 120_000,
      soldCount: 68, quota: 100, perUserLimit: 3, endAt: new Date(Date.now() + 2 * 3_600_000 + 4 * 60_000).toISOString(), serverNow: new Date().toISOString(),
    },
  ]);
  api.get(`/products/${SLUG}/reviews`, { average: 4.4, count: 27, videoCount: 0, distribution: { '5': 14, '4': 9, '3': 4 }, items: [review('a', 5), review('b', 4), review('c', 3)] });
  await page.goto(`/product/${SLUG}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('flash-price-bar')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 375, height: 3000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/mini375.png`, fullPage: true });
});
