import { test, expect } from './support/mock-api';
import { PILOT_SLUG, mockPilotProduct } from './support/pilot-mocks';

/**
 * Zalo Mini App E2E - chip lọc đánh giá hỏi máy chủ.
 *
 * Danh sách đầy đủ chỉ có 100 đánh giá mới nhất. Sản phẩm 120 đánh giá 5 sao mới + 3 đánh giá 1 sao cũ: trước đây chip
 * "1 sao" lọc trên 100 dòng đó và báo "Không có đánh giá khớp bộ lọc." dù phân bố sao ghi 3. Nay chip gửi `?rating=1` (hoặc
 * `?media=photo|video`) và vẽ đúng dòng máy chủ trả. API giả ở đây trả theo tham số như API thật.
 */
const review = (id: string, rating: number, extra: Record<string, unknown> = {}) => ({
  id,
  rating,
  comment: `Nhận xét ${id}`,
  images: [] as string[],
  videoUrl: null as string | null,
  createdAt: '2026-09-01T00:00:00.000Z',
  author: `Khách ${id}`,
  verifiedPurchase: true,
  ...extra,
});
const NEWEST = Array.from({ length: 100 }, (_, i) => review(`moi${i}`, 5));
const OLD_ONE_STAR = [review('cu1', 1), review('cu2', 1, { images: ['https://res.cloudinary.com/tubu/image/upload/v1/cu2.jpg'] }), review('cu3', 1)];
const SUMMARY = { average: 4.9, count: 123, videoCount: 0, distribution: { '5': 120, '1': 3 } };

test.describe('Zalo Mini App E2E - lọc đánh giá theo sao ở máy chủ', () => {
  test.beforeEach(({ api }) => {
    mockPilotProduct(api);
    api.get('/products/:slug/reviews', ({ call }) => {
      const rating = call.query.get('rating');
      const media = call.query.get('media');
      if (rating) return { ...SUMMARY, items: OLD_ONE_STAR.filter((r) => r.rating === Number(rating)), nextCursor: null };
      if (media === 'photo') return { ...SUMMARY, items: OLD_ONE_STAR.filter((r) => r.images.length > 0), nextCursor: null };
      return { ...SUMMARY, items: NEWEST, nextCursor: 'c-moi99' };
    });
  });

  test('chip "1 sao" gửi rating=1 và hiện đủ 3 đánh giá 1 sao cũ; "Có ảnh" gửi media=photo; "Tất cả" trở lại danh sách mới nhất', async ({ page, api }) => {
    await page.goto(`/product/${PILOT_SLUG}`);
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    await reviews.scrollIntoViewIfNeeded();
    await expect(reviews.getByRole('heading', { name: 'Đánh giá (123)' })).toBeVisible({ timeout: 15_000 });
    await expect(reviews.getByText('Nhận xét moi0')).toBeVisible();
    await expect(reviews.getByRole('button', { name: 'Xem thêm đánh giá' })).toBeVisible();

    await reviews.getByRole('button', { name: '1 sao', exact: true }).click();
    await expect(reviews.getByText('Nhận xét cu1')).toBeVisible();
    await expect(reviews.getByText('Nhận xét cu3')).toBeVisible();
    await expect(reviews.getByText('Không có đánh giá khớp bộ lọc.')).toHaveCount(0);
    await expect(reviews.getByText('Nhận xét moi0')).toHaveCount(0);
    await expect(reviews.getByRole('button', { name: 'Xem thêm đánh giá' })).toHaveCount(0);
    await expect(reviews.getByRole('heading', { name: 'Đánh giá (123)' })).toBeVisible();
    expect(api.callsTo('GET', '/products/:slug/reviews').map((c) => c.query.toString())).toContain('rating=1');

    await reviews.getByRole('button', { name: 'Có ảnh', exact: true }).click();
    await expect(reviews.getByText('Nhận xét cu2')).toBeVisible();
    await expect(reviews.getByText('Nhận xét cu1')).toHaveCount(0);
    expect(api.callsTo('GET', '/products/:slug/reviews').map((c) => c.query.toString())).toContain('media=photo');

    await reviews.getByRole('button', { name: 'Tất cả', exact: true }).click();
    await expect(reviews.getByText('Nhận xét moi0')).toBeVisible();
  });

  test('chip "3 sao" máy chủ trả rỗng: báo "Không có đánh giá khớp bộ lọc."', async ({ page }) => {
    await page.goto(`/product/${PILOT_SLUG}`);
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    await reviews.scrollIntoViewIfNeeded();
    await expect(reviews.getByText('Nhận xét moi0')).toBeVisible({ timeout: 15_000 });
    await reviews.getByRole('button', { name: '3 sao', exact: true }).click();
    await expect(reviews.getByText('Không có đánh giá khớp bộ lọc.')).toBeVisible();
  });
});

/**
 * "Xem thêm đánh giá": mỗi trang máy chủ kèm `nextCursor`; bấm hết dòng đã tải thì gọi trang kế với `cursor` (cùng chip), nối vào
 * cuối, dòng đang hiện giữ nguyên; đổi chip quay về trang đầu. API giả trả trang nhỏ (8 rồi 4 dòng) để thấy chỗ nối sau 1 lần bấm.
 */
test.describe('Zalo Mini App E2E - Xem thêm đánh giá (phân trang con trỏ)', () => {
  const FIRST = Array.from({ length: 8 }, (_, i) => review(`t1-${i}`, 5));
  const SECOND = Array.from({ length: 4 }, (_, i) => review(`t2-${i}`, 4));
  const PAGED = { average: 4.7, count: 12, videoCount: 0, distribution: { '5': 8, '4': 4 } };

  test.beforeEach(({ api }) => {
    mockPilotProduct(api);
    api.get('/products/:slug/reviews', ({ call }) => {
      const cursor = call.query.get('cursor');
      const rating = call.query.get('rating');
      if (rating === '4') return cursor ? { ...PAGED, items: [], nextCursor: null } : { ...PAGED, items: SECOND, nextCursor: null };
      if (cursor === 'c-t1-7') return { ...PAGED, items: SECOND, nextCursor: null };
      return { ...PAGED, items: FIRST, nextCursor: 'c-t1-7' };
    });
  });

  test('bấm "Xem thêm đánh giá" tải trang kế bằng cursor, nối vào cuối, giữ dòng cũ; hết trang thì ẩn nút; đổi chip về trang đầu', async ({ page, api }) => {
    await page.goto(`/product/${PILOT_SLUG}`);
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    await reviews.scrollIntoViewIfNeeded();
    await expect(reviews.getByText('Nhận xét t1-0')).toBeVisible({ timeout: 15_000 });
    const rows = reviews.getByText(/^Nhận xét t\d-\d$/);
    await expect(rows).toHaveCount(5);
    const more = reviews.getByRole('button', { name: 'Xem thêm đánh giá' });

    const queries = () => api.callsTo('GET', '/products/:slug/reviews').map((c) => c.query.toString());
    expect(queries().filter((q) => q.includes('cursor'))).toEqual([]);
    await more.click();
    await expect(reviews.getByText('Nhận xét t2-0')).toBeVisible();
    expect(queries().filter((q) => q.includes('cursor'))).toEqual(['cursor=c-t1-7']);
    await expect(rows).toHaveCount(10);
    await expect(reviews.getByText('Nhận xét t1-0')).toBeVisible();
    await more.click();
    await expect(rows).toHaveCount(12);
    await expect(rows.last()).toHaveText('Nhận xét t2-3');
    await expect(more).toHaveCount(0);
    await expect(reviews.getByRole('heading', { name: 'Đánh giá (12)' })).toBeVisible();

    await reviews.getByRole('button', { name: '4 sao', exact: true }).click();
    await expect(rows).toHaveCount(4);
    await reviews.getByRole('button', { name: 'Tất cả', exact: true }).click();
    await expect(rows).toHaveCount(5);
    await expect(more).toBeVisible();
  });
});
