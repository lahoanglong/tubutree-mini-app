import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách: bảng tin cộng đồng và bảng xếp hạng. Mọi lời gọi /api/** từ trình duyệt đi qua mock (fixture `api`).
 * Trang /cong-dong render server cho khách; trong e2e API thật không chạy nên server rơi về rỗng và trình duyệt tự tải qua mock.
 */

const NOW = new Date().toISOString();
const POST = (id: string, author: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'TIP', status: 'APPROVED', title: `Mẹo của ${author}`, body: `Nội dung ${id}`, images: [], meta: null, createdAt: NOW,
  author, avatar: null, badge: null, authorLevel: 1, category: null, productTags: [], tags: [], isPinned: false,
  likeCount: 1, commentCount: 0, liked: false, bestCommentId: null, isOwner: false, ...over,
});

function mockSession(api: MockApi) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: { id: 'u1', fullName: 'Lan', role: 'CUSTOMER', onboarded: true, segments: [] } }));
  api.get('/me', () => ({ id: 'u1', fullName: 'Lan', role: 'CUSTOMER', onboarded: true, segments: [] }));
  api.get('/feed/categories', [{ id: 'c1', slug: 'bep', name: 'Nhà bếp', icon: null }]);
}

test.describe('Web khách: cộng đồng', () => {
  test('khách thấy bản xem trước khi cờ bật: chỉ đọc, chỉ có lối đăng nhập mang returnTo', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    api.get('/config/public', { communityPublicPreview: true });
    api.get('/feed/public-preview', {
      posts: [{ id: 'p1', kind: 'TIP', title: 'Pha nước rửa chén từ vỏ bưởi', snippet: 'Vỏ bưởi ngâm giấm 2 tuần.', image: null, createdAt: NOW, author: 'Lan', badge: null, category: null, isPinned: false, likeCount: 4, commentCount: 2 }],
    });
    await page.goto('/cong-dong');
    await expect(page.getByRole('heading', { name: 'Cộng đồng Vườn Tubu', level: 1 })).toBeVisible();
    await expect(page.getByText('Pha nước rửa chén từ vỏ bưởi')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đăng bài' })).toHaveCount(0);
    const login = page.getByRole('link', { name: 'Đăng nhập với Zalo' });
    await expect(login).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/cong-dong')}`);
  });

  test('khách khi cờ tắt: cổng đăng nhập', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    api.get('/config/public', {});
    await page.goto('/cong-dong');
    await expect(page.getByText('Đăng nhập để xem cộng đồng')).toBeVisible();
  });

  test('đã đăng nhập: danh sách, đổi sắp xếp gửi sort=popular, lọc theo thẻ từ thẻ bài và bỏ lọc', async ({ page, api }) => {
    mockSession(api);
    api.get('/config/public', {});
    api.get('/feed', ({ call }) => {
      if (call.query.get('tag') === 'da-nhay-cam') return { posts: [POST('p3', 'Hà My')], nextCursor: null };
      return { posts: [POST('p1', 'Lan Anh', { tags: [{ slug: 'da-nhay-cam', name: 'da nhạy cảm' }] }), POST('p2', 'Minh Tâm')], nextCursor: null };
    });
    await page.goto('/cong-dong');
    await expect(page.getByRole('link', { name: 'Mẹo của Lan Anh' })).toHaveAttribute('href', '/cong-dong/p1');
    await expect(page.getByRole('link', { name: 'Bảng xếp hạng' })).toHaveAttribute('href', '/cong-dong/xep-hang');

    const popular = api.waitForCall('GET', '/feed');
    await page.getByRole('button', { name: 'Nổi bật' }).click();
    expect((await popular).query.get('sort')).toBe('popular');

    await page.getByRole('link', { name: 'da nhạy cảm' }).click();
    await expect(page).toHaveURL(/\/cong-dong\?tag=da-nhay-cam/);
    await expect(page.getByText('Mẹo của Hà My')).toBeVisible();
    await page.getByRole('button', { name: 'Bỏ lọc thẻ' }).click();
    await expect(page).toHaveURL(/\/cong-dong$/);
    await expect(page.getByText('Mẹo của Lan Anh')).toBeVisible();
  });

  test('đăng một câu hỏi gửi POST /feed đúng thân, báo đã đăng và tải lại bảng tin', async ({ page, api }) => {
    mockSession(api);
    api.get('/config/public', {});
    api.get('/feed', { posts: [], nextCursor: null });
    api.post('/feed', { id: 'p9', status: 'APPROVED' });
    await page.goto('/cong-dong');
    await page.getByRole('button', { name: 'Đăng bài đầu tiên' }).click();
    const dialog = page.getByRole('dialog', { name: 'Đăng bài' });
    await dialog.getByLabel(/Tiêu đề câu hỏi/).fill('Dùng được cho bình sữa không?');
    await dialog.getByLabel('Chia sẻ chi tiết…').fill('Mình muốn hỏi thêm');
    await dialog.getByRole('button', { name: 'Nhà bếp' }).click();
    const sent = api.waitForCall('POST', '/feed');
    await dialog.getByRole('button', { name: 'Đăng', exact: true }).click();
    expect((await sent).body).toEqual({
      kind: 'QUESTION', categoryId: 'c1', title: 'Dùng được cho bình sữa không?', body: 'Mình muốn hỏi thêm', productSlugs: [],
    });
    await expect(page.getByRole('status')).toContainText('Đã đăng bài');
  });

  test('xếp hạng: huy chương ba hạng đầu, điểm uy tín; khách được mời đăng nhập', async ({ page, api }) => {
    mockSession(api);
    api.get('/feed/leaderboard', [
      { author: 'Lan Anh', avatar: null, reputation: 980, level: 4, levelName: 'Cổ thụ' },
      { author: 'Minh Tâm', avatar: null, reputation: 640, level: 3, levelName: 'Cây trưởng thành' },
      { author: 'Hà My', avatar: null, reputation: 410, level: 2, levelName: 'Cây non' },
      { author: 'Quốc Bảo', avatar: null, reputation: 120, level: 2, levelName: 'Cây non' },
    ]);
    await page.goto('/cong-dong/xep-hang');
    await expect(page.getByRole('heading', { name: 'Bảng xếp hạng', level: 1 })).toBeVisible();
    await expect(page.getByText('🥇')).toBeVisible();
    await expect(page.getByText('#4')).toBeVisible();
    await expect(page.getByText('980 điểm uy tín')).toBeVisible();
  });

  test('xếp hạng khi chưa đăng nhập: mời đăng nhập và quay lại đúng trang', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    await page.goto('/cong-dong/xep-hang');
    await expect(page.getByRole('link', { name: /Đăng nhập với Zalo/ })).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/cong-dong/xep-hang')}`);
  });

  test('chi tiết bài: hiện bài và câu trả lời, thả tim, gửi trả lời, báo cáo bình luận', async ({ page, api }) => {
    mockSession(api);
    api.get('/feed/p1', POST('p1', 'Lan Anh', { kind: 'QUESTION', title: 'Rửa bình sữa thế nào?', body: 'Mình cần mẹo rửa bình', commentCount: 1 }));
    api.get('/feed/p1/comments', {
      items: [{ id: 'c1', body: 'Ngâm nước ấm trước', author: 'Hạnh', avatar: null, badge: null, authorLevel: 1, isAccepted: false, createdAt: NOW, isOwner: false }],
      nextCursor: null,
    });
    api.post('/feed/p1/react', { liked: true });
    api.post('/feed/p1/comments', { id: 'c2' });
    api.post('/feed/p1/report', { ok: true });
    await page.goto('/cong-dong/p1');
    await expect(page.getByRole('heading', { name: 'Rửa bình sữa thế nào?' })).toBeVisible();
    await expect(page.getByText('Ngâm nước ấm trước')).toBeVisible();

    const liked = api.waitForCall('POST', '/feed/p1/react');
    await page.getByRole('button', { name: /Lượt thích/ }).click();
    await liked;

    await page.getByLabel('Viết trả lời…').fill('  Cảm ơn bạn  ');
    const commented = api.waitForCall('POST', '/feed/p1/comments');
    await page.getByRole('button', { name: 'Gửi', exact: true }).click();
    expect((await commented).body).toEqual({ body: 'Cảm ơn bạn' });

    await page.getByTestId('comment-row').getByRole('button', { name: 'Báo cáo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Báo cáo' });
    await dialog.getByLabel('Lý do báo cáo…').fill('Spam');
    const reported = api.waitForCall('POST', '/feed/p1/report');
    await dialog.getByRole('button', { name: 'Báo cáo', exact: true }).click();
    expect((await reported).body).toEqual({ targetType: 'COMMENT', targetId: 'c1', reason: 'Spam' });
    await expect(page.getByRole('status')).toContainText('Đã gửi báo cáo');
  });

  test('chi tiết bài của chủ bài: xoá xong về bảng tin', async ({ page, api }) => {
    mockSession(api);
    api.get('/config/public', {});
    api.get('/feed', { posts: [], nextCursor: null });
    api.get('/feed/p1', POST('p1', 'Lan', { isOwner: true }));
    api.get('/feed/p1/comments', { items: [], nextCursor: null });
    api.delete('/feed/p1', { ok: true });
    await page.goto('/cong-dong/p1');
    await page.getByRole('button', { name: 'Xoá', exact: true }).click();
    const removed = api.waitForCall('DELETE', '/feed/p1');
    await page.getByRole('dialog', { name: 'Xoá bài viết này?' }).getByRole('button', { name: 'Xoá', exact: true }).click();
    await removed;
    await expect(page).toHaveURL(/\/cong-dong\?deleted=1$/);
    await expect(page.getByRole('status')).toContainText('Đã xoá bài');
  });

  test('chi tiết bài khi chưa đăng nhập: mời đăng nhập và quay lại đúng bài', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    await page.goto('/cong-dong/p1');
    await expect(page.getByRole('link', { name: /Đăng nhập với Zalo/ })).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/cong-dong/p1')}`);
  });

  test('sự kiện: chọn sự kiện xem bài dự thi, đăng bài dự thi gửi kèm eventId', async ({ page, api }) => {
    mockSession(api);
    const day = 24 * 3600 * 1000;
    api.get('/feed/events', [
      { id: 'e1', title: 'Thử thách vườn xanh', description: 'Khoe góc vườn', coverUrl: null, startAt: new Date(Date.now() - day).toISOString(), endAt: new Date(Date.now() + 5 * day).toISOString(), rewardPoints: 5, status: 'ACTIVE', winnerUserId: null, createdAt: NOW },
    ]);
    api.get('/feed/events/e1/posts', { posts: [POST('p1', 'Lan Anh')], nextCursor: null });
    api.post('/feed', { id: 'p9', status: 'APPROVED' });
    await page.goto('/cong-dong/su-kien');
    await expect(page.getByRole('heading', { name: 'Sự kiện', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: /Thử thách vườn xanh/ }).click();
    await expect(page.getByRole('heading', { name: 'Bài dự thi' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mẹo của Lan Anh' })).toHaveAttribute('href', '/cong-dong/p1');

    await page.getByRole('button', { name: 'Đăng bài dự thi' }).click();
    const dialog = page.getByRole('dialog', { name: 'Đăng bài' });
    await expect(dialog.getByText('Dự thi: Thử thách vườn xanh')).toBeVisible();
    await dialog.getByLabel('Chia sẻ chi tiết…').fill('Góc vườn của mình');
    const sent = api.waitForCall('POST', '/feed');
    await dialog.getByRole('button', { name: 'Đăng', exact: true }).click();
    expect((await sent).body).toMatchObject({ kind: 'SHOWCASE', eventId: 'e1', body: 'Góc vườn của mình' });
    await expect(page.getByRole('status')).toContainText('Đã đăng bài');
  });

  test('sự kiện khi chưa đăng nhập: mời đăng nhập và quay lại đúng trang', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    await page.goto('/cong-dong/su-kien');
    await expect(page.getByRole('link', { name: /Đăng nhập với Zalo/ })).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/cong-dong/su-kien')}`);
  });

  test('học viện: danh sách khoá, mở khoá, đánh dấu đã học gửi đúng bài', async ({ page, api }) => {
    mockSession(api);
    api.get('/academy/courses', [{ id: 'c1', title: 'Khoá bán hàng', description: 'Học cách chốt đơn', coverUrl: null, sortOrder: 1, isPublished: true, lessonCount: 2, completedCount: 0, isCompleted: false }]);
    api.get('/academy/courses/c1', {
      id: 'c1', title: 'Khoá bán hàng', description: 'Học cách chốt đơn', coverUrl: null, isPublished: true, completedLessonIds: [],
      lessons: [
        { id: 'l1', courseId: 'c1', title: 'Giới thiệu', contentType: 'VIDEO', videoUrl: 'https://video.test/1', body: null, sortOrder: 1 },
        { id: 'l2', courseId: 'c1', title: 'Kịch bản', contentType: 'ARTICLE', videoUrl: null, body: 'Bước 1', sortOrder: 2 },
      ],
    });
    api.post('/academy/lessons/l1/complete', { ok: true });
    await page.goto('/hoc-vien');
    await expect(page.getByRole('heading', { name: 'CTV Academy', level: 1 })).toBeVisible();
    await expect(page.getByText('0/2 bài đã học')).toBeVisible();
    await page.getByRole('link', { name: /Khoá bán hàng/ }).click();
    await expect(page).toHaveURL(/\/hoc-vien\/c1$/);
    await expect(page.getByRole('link', { name: 'Mở video bài học' })).toHaveAttribute('href', 'https://video.test/1');
    const sent = api.waitForCall('POST', '/academy/lessons/l1/complete');
    await page.getByRole('button', { name: 'Đánh dấu đã học' }).first().click();
    await sent;
    await expect(page.getByRole('status')).toContainText('Đã đánh dấu hoàn thành bài học!');
  });

  test('học viện khi chưa đăng nhập: mời đăng nhập và quay lại đúng khoá', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'no session' }));
    await page.goto('/hoc-vien/c1');
    await expect(page.getByRole('link', { name: /Đăng nhập với Zalo/ })).toHaveAttribute('href', `/dang-nhap?returnTo=${encodeURIComponent('/hoc-vien/c1')}`);
  });
});
