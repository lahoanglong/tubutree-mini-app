import { expect, reply, test, type MockApi } from './support/mock-api';

/**
 * Web khách: Vườn Xanh (/vuon-xanh), tab Hôm nay. Mọi lời gọi /api/** đi qua mock (fixture `api`).
 * Điểm danh, tưới cây và góp quỹ trồng cây phải gửi đúng một POST dù bấm đúp; góp quỹ kèm Idempotency-Key.
 */

const USER = {
  id: 'u1', fullName: 'Nguyễn Văn An', referralCode: 'AN123', phone: '0912345678', role: 'CUSTOMER',
  pointsBalance: 1681, pointsConvertedBalance: 119, walletBalance: 0,
};

const profile = (over: Record<string, unknown> = {}) => ({
  totalSeeds: 1250, streakDays: 3, treeStage: 1, treeHealth: 'HEALTHY', streakFreezes: 1,
  lastDewAt: null, lastCheckInAt: null,
  ecoImpact: { progress: 600, target: 1000, treeType: 'Cây Sưa', treesPlanted: 2 },
  streakFreezeCost: 80, treePointsPrice: 20000, spinCostPoints: 10,
  ...over,
});

function mockGame(api: MockApi, state: { checkedIn: boolean }) {
  api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
  api.get('/me', () => USER);
  api.get('/config/public', { freeshipThreshold: 500000, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  api.get('/game/profile', () => profile({ lastCheckInAt: state.checkedIn ? new Date().toISOString() : null }));
  api.get('/game/quiz/today', [
    { id: 'q1', question: 'Cây nào hấp thụ nhiều CO₂?', options: ['Sưa', 'Tre', 'Cỏ', 'Rêu'], category: 'cay', difficulty: 2, waterReward: 10 },
  ]);
  api.get('/game/missions', [
    { code: 'REVIEW_3', title: 'Đánh giá 3 sản phẩm', rewardPoints: 30, progress: 3, goal: 3, completed: true, claimed: false },
  ]);
  api.get('/game/forest', { count: 0, plantedCount: 0, trees: [] });
  api.get('/game/season', null);
  api.post('/game/check-in', () => {
    state.checkedIn = true;
    return { seedsEarned: 10, pointsEarned: 0, streakDays: 4, totalSeeds: 1260, streakFrozeUsed: false, bonusNote: '' };
  });
  api.post('/game/tree/water', () => ({ progress: 620, target: 1000, harvested: false, treesPlanted: 2 }));
  api.post('/game/tree/buy', () => ({ certificateCode: 'TT-99', treeType: 'Sưa', cost: 20000, pointsUsed: 20000, pointsUsedConverted: 0 }));
  api.post('/game/missions/REVIEW_3/claim', () => ({ claimed: true, rewardPoints: 30, couponCode: null }));
  api.post('/game/quiz/q1/answer', () => ({ isCorrect: true, correct: 0, waterEarned: 10, explanation: 'Cây sưa lớn chậm nhưng bền' }));
}

test.describe('Web khách: Vườn Xanh', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  test('thẻ vườn, ba tab và các khối của tab Hôm nay hiện đúng số từ API', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh');
    await expect(page.getByRole('heading', { name: 'Vườn Xanh', level: 1 })).toBeVisible();
    await expect(page.getByText('600/1.000💧 · 💧 1.250 · 🔥 3 ngày · 🌳 góp quỹ: 2')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Hôm nay' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Tưới cây (20💧)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Điểm danh chuỗi 3 ngày' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Góp quỹ trồng cây \(20\.000 điểm\)/ })).toBeVisible();
    await page.getByRole('tab', { name: 'Vườn' }).click();
    await expect(page).toHaveURL(/tab=garden/);
    await expect(page.getByRole('button', { name: 'Tưới cây (20💧)' })).toBeHidden();
  });

  test('điểm danh: bấm đúp chỉ gửi một POST, báo kết quả và nút chuyển "Đã điểm danh"', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh');
    await page.getByRole('button', { name: 'Điểm danh', exact: true }).dblclick();
    await expect(page.getByText('+10💧')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đã điểm danh' })).toBeDisabled();
    expect(api.callsTo('POST', '/game/check-in')).toHaveLength(1);
  });

  test('tưới cây: gửi {drops: 20} một lần dù bấm đúp', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh');
    await page.getByRole('button', { name: 'Tưới cây (20💧)' }).dblclick();
    await expect(page.getByText('Đã tưới · 620/1.000💧')).toBeVisible();
    const calls = api.callsTo('POST', '/game/tree/water');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ drops: 20 });
  });

  test('góp quỹ trồng cây: xác nhận hai lần chỉ gửi một POST kèm Idempotency-Key', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh');
    await page.getByRole('button', { name: /Góp quỹ trồng cây/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Góp quỹ trồng cây?' });
    await expect(dialog.getByText('Góp quỹ trồng cây sẽ trừ 20.000 điểm từ Điểm Xanh của bạn.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Xác nhận' }).dblclick();
    await expect(page.getByText(/Đã góp 1 cây vào quỹ trồng cây/)).toBeVisible();
    const calls = api.callsTo('POST', '/game/tree/buy');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['idempotency-key']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  test('quiz: trả lời gửi đúng lựa chọn, hiện "Bạn có biết" và nhiệm vụ đạt có nút nhận thưởng', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh');
    await page.getByRole('button', { name: 'Sưa', exact: true }).click();
    await expect(page.getByText('Chính xác! +10💧')).toBeVisible();
    await expect(page.getByText('Bạn có biết: Cây sưa lớn chậm nhưng bền')).toBeVisible();
    expect(api.callsTo('POST', '/game/quiz/q1/answer')[0]!.body).toEqual({ choice: 0 });
    await page.getByRole('button', { name: 'Nhận thưởng' }).click();
    await expect(page.getByText('Đã nhận +30 Điểm Xanh! 🌿')).toBeVisible();
    expect(api.callsTo('POST', '/game/missions/REVIEW_3/claim')).toHaveLength(1);
  });

  test('khách chưa đăng nhập được mời đăng nhập, không gọi API vườn', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    await page.goto('/vuon-xanh');
    await expect(page.getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
    expect(api.callsTo('GET', '/game/profile')).toHaveLength(0);
  });
});
