import type { OrderDTO } from '@tubutree/shared-types';
import { test, expect, makeOrder, reply } from './support/mock-api';
import { PILOT_SLUG, mockPilotProduct } from './support/pilot-mocks';

/**
 * Zalo Mini App E2E - Đánh giá theo từng lần mua (R8).
 *
 * Mỗi lần mua (đơn đã nhận) một đánh giá (reviews.service.ts, khoá unique userId+productId+orderId). Khách mua sản phẩm
 * hai lần: đơn đầu đã đánh giá (đã nhận Điểm Xanh), đơn sau chưa.
 * 1. Chi tiết đơn sau: dòng hiện "Viết đánh giá" → trang sản phẩm mở sẵn form cho đúng đơn đó, nói rõ đơn nào và không
 *    hứa Điểm Xanh (chỉ đánh giá đầu tiên của sản phẩm được thưởng) → POST kèm orderId của đơn sau.
 * 2. Chi tiết đơn đầu: dòng hiện "Sửa đánh giá" → form điền sẵn đánh giá của đơn đó (GET /reviews/:id) → lưu gửi orderId
 *    của đơn đầu.
 * 3. Trang sản phẩm: đánh giá của mình có nhãn "Của bạn", mã đơn và nút sửa riêng.
 * 4. Form mở từ chi tiết đơn chỉ mở một lần: tải lại, quay lại rồi tiến lại trang sản phẩm không tự mở lại.
 * 5. can-review chưa về thì chưa có nút viết/sửa; về ALL_REVIEWED thì chỉ có sửa (không form viết mới thiếu đơn).
 */
test.describe('Zalo Mini App E2E - Đánh giá theo từng lần mua (R8)', () => {
  const DELIVERED_AT = '2026-09-10T08:00:00.000Z';
  const withLine = (order: OrderDTO, line: Partial<OrderDTO['items'][number]>): OrderDTO => ({
    ...order,
    items: order.items.map((it) => ({ ...it, productSlug: PILOT_SLUG, ...line })),
  });
  const FIRST = withLine(
    makeOrder({ code: 'TUBU-R8-001', id: 'ord-r8-1', status: 'DELIVERED', paymentStatus: 'PAID', deliveredAt: DELIVERED_AT }),
    { reviewId: 'rv-1', reviewable: false },
  );
  const SECOND = makeOrder({ code: 'TUBU-R8-002', id: 'ord-r8-2', status: 'DELIVERED', paymentStatus: 'PAID', deliveredAt: DELIVERED_AT });
  const MY_REVIEW = {
    id: 'rv-1',
    orderId: 'ord-r8-1',
    rating: 5,
    comment: 'Lần đầu dùng rất thích',
    images: [],
    videoUrl: null,
    isVisible: true,
  };
  const REWARD_ALREADY_GIVEN =
    'Bạn đã nhận Điểm Xanh cho đánh giá đầu tiên của sản phẩm này, đánh giá lần mua này không cộng thêm điểm.';

  test.beforeEach(async ({ api }) => {
    mockPilotProduct(api);
    api.get('/orders/:code', ({ params }) =>
      [FIRST, SECOND].find((o) => o.code === params.code) ?? reply(404, { message: 'Không tìm thấy đơn hàng' }),
    );
    api.get('/orders/me/returns', []);
    api.get('/products/:slug/reviews', {
      average: 5,
      count: 1,
      videoCount: 0,
      distribution: { '5': 1 },
      items: [
        {
          id: 'rv-1',
          rating: 5,
          comment: MY_REVIEW.comment,
          images: [],
          videoUrl: null,
          createdAt: '2026-09-02T08:00:00.000Z',
          author: 'Nguyễn Văn A',
          avatar: null,
          verifiedPurchase: true,
        },
      ],
    });
    api.get('/products/:slug/reviews/can-review', {
      canReview: true,
      reason: null,
      rewardAvailable: false,
      purchaseCount: 2,
      reviewableOrders: [{ orderId: SECOND.id, code: SECOND.code, deliveredAt: DELIVERED_AT }],
      myReviews: [
        { id: 'rv-1', orderId: FIRST.id, orderCode: FIRST.code, rating: 5, createdAt: '2026-09-02T08:00:00.000Z', isVisible: true },
      ],
    });
    api.get('/reviews/:id', MY_REVIEW);
  });

  test('đơn mua lại: "Viết đánh giá" mở form cho đúng đơn, gửi kèm orderId và không hứa Điểm Xanh', async ({ page, api }) => {
    api.post('/products/:slug/reviews', { ...MY_REVIEW, id: 'rv-2', orderId: SECOND.id, pointsEarned: 0, updated: false });

    await page.goto(`/order/${SECOND.code}`);
    await page.getByText('Viết đánh giá', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/product/${PILOT_SLUG}$`), { timeout: 10_000 });

    await expect(page.getByText(`Đánh giá này cho đơn ${SECOND.code}.`, { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(REWARD_ALREADY_GIVEN)).toBeVisible();
    await expect(page.getByText(/\+\d+ Điểm Xanh/)).toHaveCount(0);

    const posted = api.waitForCall('POST', '/products/:slug/reviews');
    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    expect((await posted).body).toMatchObject({ rating: 5, orderId: SECOND.id });
    await expect(page.getByText('Đã gửi đánh giá của bạn')).toBeVisible({ timeout: 5_000 });
  });

  test('đơn đã đánh giá: "Sửa đánh giá" mở form điền sẵn đánh giá của đúng đơn đó, lưu gửi orderId của đơn đó', async ({ page, api }) => {
    api.post('/products/:slug/reviews', { ...MY_REVIEW, rating: 4, pointsEarned: 10, updated: true });

    await page.goto(`/order/${FIRST.code}`);
    await expect(page.getByText('Viết đánh giá', { exact: true })).toHaveCount(0, { timeout: 10_000 });
    await page.getByText('Sửa đánh giá', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/product/${PILOT_SLUG}$`), { timeout: 10_000 });

    await expect(page.getByPlaceholder(/Chia sẻ cảm nhận/)).toHaveValue(MY_REVIEW.comment, { timeout: 10_000 });
    await expect(page.getByText(`Bạn đang sửa đánh giá cho đơn ${FIRST.code}.`)).toBeVisible();

    await page.getByRole('radio', { name: '4 sao' }).click();
    const posted = api.waitForCall('POST', '/products/:slug/reviews');
    await page.getByRole('button', { name: 'Lưu đánh giá' }).click();
    expect((await posted).body).toMatchObject({ rating: 4, comment: MY_REVIEW.comment, orderId: FIRST.id });
    await expect(page.getByText('Đã cập nhật đánh giá của bạn')).toBeVisible({ timeout: 5_000 });
    expect(api.callsTo('GET', '/reviews/:id').map((c) => c.path)).toContain('/reviews/rv-1');
  });

  test('form mở từ chi tiết đơn chỉ mở một lần: gửi xong, tải lại hay quay lại rồi tiến lại trang sản phẩm không tự mở lại', async ({ page, api }) => {
    api.post('/products/:slug/reviews', { ...MY_REVIEW, id: 'rv-2', orderId: SECOND.id, pointsEarned: 0, updated: false });
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    const form = page.getByRole('radiogroup', { name: 'Số sao' });
    // can-review (mock) vẫn trả đơn sau là còn viết được: còn giữ đơn trong lịch sử thì form tự mở lại ngay khi nó về.
    const formStaysClosed = async () => {
      await expect(reviews.getByRole('button', { name: 'Viết đánh giá' })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await expect(form).toHaveCount(0);
    };

    await page.goto(`/order/${SECOND.code}`);
    await page.getByText('Viết đánh giá', { exact: true }).click();
    await expect(page.getByText(`Đánh giá này cho đơn ${SECOND.code}.`, { exact: false })).toBeVisible({ timeout: 10_000 });
    const historyState = () => page.evaluate(() => (window.history.state as { usr?: Record<string, unknown> } | null)?.usr ?? null);
    expect(await historyState()).not.toHaveProperty('reviewOrderId');

    await page.getByRole('button', { name: 'Gửi đánh giá' }).click();
    await expect(page.getByText('Đã gửi đánh giá của bạn')).toBeVisible({ timeout: 5_000 });

    await page.reload();
    await formStaysClosed();

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/order/${SECOND.code}$`), { timeout: 10_000 });
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/product/${PILOT_SLUG}$`), { timeout: 10_000 });
    await formStaysClosed();
    expect(api.callsTo('POST', '/products/:slug/reviews')).toHaveLength(1);
  });

  test('can-review chưa về thì chưa có nút viết/sửa; về ALL_REVIEWED thì chỉ có "Sửa đánh giá của bạn", lưu gửi kèm đơn', async ({ page, api }) => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    api.get('/products/:slug/reviews/can-review', async () => {
      await answered;
      return {
        canReview: false,
        reason: 'ALL_REVIEWED',
        rewardAvailable: false,
        purchaseCount: 1,
        reviewableOrders: [],
        myReviews: [
          { id: 'rv-1', orderId: FIRST.id, orderCode: FIRST.code, rating: 5, createdAt: '2026-09-02T08:00:00.000Z', isVisible: true },
        ],
      };
    });
    api.post('/products/:slug/reviews', { ...MY_REVIEW, updated: true, pointsEarned: 10 });

    const asked = api.waitForCall('GET', '/products/:slug/reviews/can-review', 15_000);
    await page.goto(`/product/${PILOT_SLUG}`);
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    await expect(reviews.getByText(MY_REVIEW.comment)).toBeVisible({ timeout: 15_000 });
    await expect(reviews.getByRole('button', { name: /Viết đánh giá|Sửa/ })).toHaveCount(0);

    answer();
    await asked;
    await expect(reviews.getByRole('button', { name: 'Sửa đánh giá của bạn' })).toBeVisible({ timeout: 10_000 });
    await expect(reviews.getByRole('button', { name: 'Viết đánh giá' })).toHaveCount(0);

    await reviews.getByRole('button', { name: 'Sửa đánh giá của bạn' }).click();
    await expect(page.getByPlaceholder(/Chia sẻ cảm nhận/)).toHaveValue(MY_REVIEW.comment, { timeout: 10_000 });
    const posted = api.waitForCall('POST', '/products/:slug/reviews');
    await page.getByRole('button', { name: 'Lưu đánh giá' }).click();
    expect((await posted).body).toMatchObject({ orderId: FIRST.id });
  });

  // R5-BUYER-2: admin ẩn đánh giá (isVisible=false) thì nó biến khỏi danh sách công khai; khách phải được nói đang chờ Tubu xem xét.
  test('đánh giá bị Tubu ẩn: nói rõ đang chờ xem xét, form sửa nhắc lại, lưu không báo "Đã cập nhật"', async ({ page, api }) => {
    api.get('/products/:slug/reviews', { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
    api.get('/products/:slug/reviews/can-review', {
      canReview: false,
      reason: 'ALL_REVIEWED',
      rewardAvailable: false,
      purchaseCount: 1,
      reviewableOrders: [],
      myReviews: [
        { id: 'rv-1', orderId: FIRST.id, orderCode: FIRST.code, rating: 5, createdAt: '2026-09-02T08:00:00.000Z', isVisible: false },
      ],
    });
    api.get('/reviews/:id', { ...MY_REVIEW, isVisible: false });
    api.post('/products/:slug/reviews', { ...MY_REVIEW, updated: true, pointsEarned: 0, isVisible: false });

    await page.goto(`/product/${PILOT_SLUG}`);
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    await expect(
      reviews.getByText(`Đánh giá cho đơn ${FIRST.code} của bạn đang được Tubu xem xét nên chưa hiện công khai. Sửa nội dung không làm nó hiện lại.`),
    ).toBeVisible({ timeout: 15_000 });

    await reviews.getByRole('button', { name: 'Sửa đánh giá của bạn' }).click();
    await expect(page.getByText('Đánh giá này đang chờ Tubu xem xét nên chưa hiện công khai. Lưu lại không làm nó hiện.')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Lưu đánh giá' }).click();
    await expect(page.getByText('Đã lưu. Đánh giá của bạn đang được Tubu xem xét nên chưa hiện công khai.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Đã cập nhật đánh giá của bạn')).toHaveCount(0);
  });

  // R5-BUYER-3: can-review lỗi thì khách không thấy nút viết/sửa và không biết vì sao.
  test('can-review lỗi: báo "Chưa kiểm tra được quyền đánh giá" kèm Thử lại; thử lại được thì có nút viết đánh giá', async ({ page, api }) => {
    let failing = true;
    api.get('/products/:slug/reviews/can-review', () =>
      failing
        ? reply(500, { message: 'Internal server error' })
        : { canReview: true, reason: null, rewardAvailable: true, purchaseCount: 1, reviewableOrders: [{ orderId: SECOND.id, code: SECOND.code, deliveredAt: DELIVERED_AT }], myReviews: [] },
    );

    await page.goto(`/product/${PILOT_SLUG}`);
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    await expect(reviews.getByText('Chưa kiểm tra được quyền đánh giá.')).toBeVisible({ timeout: 15_000 });
    await expect(reviews.getByRole('button', { name: 'Viết đánh giá' })).toHaveCount(0);

    failing = false;
    await reviews.getByRole('button', { name: 'Thử lại' }).click();
    await expect(reviews.getByRole('button', { name: 'Viết đánh giá' })).toBeVisible({ timeout: 10_000 });
    await expect(reviews.getByText('Chưa kiểm tra được quyền đánh giá.')).toHaveCount(0);
  });

  test('trang sản phẩm: đánh giá của mình có nhãn "Của bạn", mã đơn và nút sửa riêng; đầu mục vẫn viết được cho đơn mới', async ({ page }) => {
    await page.goto(`/product/${PILOT_SLUG}`);
    const reviews = page.getByRole('region', { name: 'Đánh giá sản phẩm' });
    await expect(reviews.getByText(MY_REVIEW.comment)).toBeVisible({ timeout: 15_000 });
    await expect(reviews.getByText('Của bạn', { exact: true })).toBeVisible();
    await expect(reviews.getByText(`Đơn ${FIRST.code}`)).toBeVisible();
    await expect(reviews.getByRole('button', { name: `Sửa đánh giá đơn ${FIRST.code}` })).toBeVisible();
    await expect(reviews.getByRole('button', { name: 'Viết đánh giá' })).toBeVisible();
  });
});
