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
  api.get('/me/loyalty', { pointsBalance: 100000, redeemablePoints: 100000, redeemableTotal: 100000, tier: null, nextTier: null, tiers: [] });
  api.get('/game/season', null);
  api.get('/game/garden', {
    plots: [
      { id: null, slot: 1, isHome: true, treeType: 'Sưa', speciesId: null, progress: 600, target: 1000, treeStage: 1, treesPlanted: 2, treeHealth: 'HEALTHY' },
      { id: 'p2', slot: 2, isHome: false, treeType: 'Mận', speciesId: null, progress: 5, target: 20, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' },
    ],
    maxPlots: 3,
    nextUnlock: { slot: 3, seedCost: 1200 },
  });
  api.get('/game/collection', [
    { id: 'c1', name: 'Sưa đỏ', rarity: 'LEGENDARY', emoji: '🌳', region: null, owned: true, count: 2, story: null, ecoFact: null },
    { id: 'c2', name: 'Lim xanh', rarity: 'RARE', emoji: '🌲', region: null, owned: false, count: 0, story: null, ecoFact: null },
  ]);
  api.get('/game/community', {
    goal: { id: 'g1', title: 'Rừng Tubu', region: 'Hà Giang', targetDrops: 5000000, currentDrops: 1250000, treesToPlant: 100, status: 'ACTIVE' },
    myDrops: 89000,
    pct: 25,
  });
  api.get('/game/friends', [
    { id: 'f1', nickname: 'Lan', giftedToday: false },
    { id: 'f2', nickname: 'Minh', giftedToday: true },
  ]);
  api.get('/game/leaderboard', [
    { rank: 1, nickname: 'Nhất', streak: 30, treesPlanted: 9 },
    { rank: 2, nickname: 'Nhì', streak: 20, treesPlanted: 7 },
  ]);
  api.get('/game/season/leaderboard', [{ rank: 1, nickname: 'Bạn 1', drops: 2000 }]);
  api.post('/game/garden/unlock', () => ({ id: 'p3', slot: 3, isHome: false, treeType: 'Sồi', speciesId: null, progress: 0, target: 20, treeStage: 0, treesPlanted: 0, treeHealth: 'HEALTHY' }));
  api.post('/game/garden/plot/p2/water', () => ({ progress: 25, target: 20, harvested: true, treesPlanted: 1, revivedFromDead: false, reward: { coupon: 'XANH-123', certificate: 'TT-77' } }));
  api.post('/game/gift/f1', () => ({ amount: 5, recipientId: 'f1' }));
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
    await expect(page.getByRole('button', { name: /Nhận nước hôm nay/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Điểm danh chuỗi 3 ngày' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Góp quỹ trồng cây/ })).toBeHidden();
    await page.getByRole('tab', { name: 'Vườn' }).click();
    await expect(page).toHaveURL(/tab=garden/);
    await expect(page.getByRole('button', { name: /Nhận nước hôm nay/ })).toBeHidden();
    await expect(page.getByRole('button', { name: /Góp quỹ trồng cây \(20\.000 điểm\)/ })).toBeVisible();
  });

  test('điểm danh: bấm đúp chỉ gửi một POST, báo kết quả và nút chuyển "Đã điểm danh"', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh');
    await page.getByRole('button', { name: 'Điểm danh', exact: true }).dblclick();
    await expect(page.getByRole('status').getByText('+10💧')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đã điểm danh' })).toBeDisabled();
    expect(api.callsTo('POST', '/game/check-in')).toHaveLength(1);
  });

  test('tưới hết: gửi {drops: 1250} một lần dù bấm đúp', async ({ page, api }) => {
    mockGame(api, { checkedIn: true });
    await page.goto('/vuon-xanh');
    await page.getByRole('button', { name: 'Tưới hết (1.250💧)' }).dblclick();
    await expect(page.getByText('Đã tưới · 620/1.000💧')).toBeVisible();
    const calls = api.callsTo('POST', '/game/tree/water');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ drops: 1250 });
  });

  test('hết nước: nút chính mở sheet "Kiếm nước", không gọi tưới', async ({ page, api }) => {
    mockGame(api, { checkedIn: true });
    api.get('/game/profile', () => profile({ totalSeeds: 0, lastCheckInAt: new Date().toISOString(), lastDewAt: new Date().toISOString() }));
    await page.goto('/vuon-xanh');
    await page.getByRole('button', { name: 'Kiếm thêm nước' }).click();
    await expect(page.getByRole('dialog', { name: 'Kiếm nước' })).toBeVisible();
    expect(api.callsTo('POST', '/game/tree/water')).toHaveLength(0);
  });

  test('góp quỹ trồng cây: xác nhận hai lần chỉ gửi một POST kèm Idempotency-Key', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh?tab=garden');
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

  test('tab Vườn: lô đất, sổ tay, mục tiêu cộng đồng; mở lô gửi {currency: SEEDS, slot} của lô kế tiếp một lần dù bấm đúp', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh?tab=garden');
    await expect(page.getByRole('heading', { name: 'Lô đất của bạn (2/3)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sổ tay loài cây (1/2)' })).toBeVisible();
    await expect(page.getByText('Bạn đã góp 89.000💧')).toBeVisible();
    await page.getByRole('button', { name: /Mở lô/ }).dblclick();
    await expect(page.getByText('Đã mở lô đất mới 🪴')).toBeVisible();
    const calls = api.callsTo('POST', '/game/garden/unlock');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ currency: 'SEEDS', slot: 3 });
  });

  test('tưới lô tới mức thu hoạch: mở hộp chúc mừng có mã giảm giá và mã đóng góp', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh?tab=garden');
    await page.getByRole('button', { name: 'Tưới', exact: true }).dblclick();
    const dialog = page.getByRole('dialog', { name: 'Thu hoạch thành công!' });
    await expect(dialog.getByText('XANH-123')).toBeVisible();
    await expect(dialog.getByText('TT-77')).toBeVisible();
    const calls = api.callsTo('POST', '/game/garden/plot/p2/water');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toEqual({ drops: 20 });
  });

  test('tab Cộng đồng: xếp hạng, tặng nước gọi đúng bạn một lần, bạn đã tặng hôm nay bị khoá', async ({ page, api }) => {
    mockGame(api, { checkedIn: false });
    await page.goto('/vuon-xanh?tab=community');
    await expect(page.getByRole('heading', { name: 'Chuỗi điểm danh dài nhất' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Xếp hạng góp nước mùa này' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đã tặng hôm nay' })).toBeDisabled();
    await page.getByRole('button', { name: 'Tặng 💧' }).dblclick();
    await expect(page.getByText('Đã tặng 5💧 cho bạn 🎁')).toBeVisible();
    expect(api.callsTo('POST', '/game/gift/f1')).toHaveLength(1);
  });

  test('khách chưa đăng nhập được mời đăng nhập, không gọi API vườn', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    await page.goto('/vuon-xanh');
    await expect(page.getByRole('main').getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
    expect(api.callsTo('GET', '/game/profile')).toHaveLength(0);
  });
});

/**
 * Web khách: Trợ lý AI (/tu-van). Hỏi bằng câu gợi ý và bằng phím Enter, thẻ sản phẩm dẫn tới /san-pham/[slug],
 * lỗi thì có "Thử lại" gửi lại đúng câu cũ, công tắc tắt AI đưa về Trang chủ.
 */
test.describe('Trợ lý AI (/tu-van)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('tubu_web_session', '1');
      } catch {
        // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
      }
    });
  });

  const PRODUCT = {
    id: 'p1', name: 'Nước rửa chén bồ hòn', slug: 'nuoc-rua-chen-bo-hon', brand: 'Tubu', shortDesc: null,
    thumbnail: null, basePrice: 90000, salePrice: 70000,
  };

  function mockAdvisor(api: MockApi, enabled = true) {
    api.post('/auth/refresh', () => ({ accessToken: 'e2e-token', user: USER }));
    api.get('/me', () => USER);
    api.get('/config/public', { freeshipThreshold: 500000, aiAdvisorEnabled: enabled, waste: { enabled: false, dropoff: false, mailin: false, pickup: false } });
  }

  test('bấm câu gợi ý và hỏi bằng Enter gửi đúng body, hiện thẻ sản phẩm dẫn tới trang sản phẩm', async ({ page, api }) => {
    mockAdvisor(api);
    api.post('/ai-advisor/chat', () => ({ reply: 'Bạn thử loại này nhé', products: [PRODUCT] }));
    await page.goto('/tu-van');
    await page.getByRole('button', { name: 'Gợi ý quà tặng sống xanh' }).click();
    await expect(page.getByText('Bạn thử loại này nhé')).toBeVisible();
    expect(api.callsTo('POST', '/ai-advisor/chat')[0]!.body).toEqual({ message: 'Gợi ý quà tặng sống xanh', history: [] });

    await page.getByRole('textbox', { name: 'Nhập câu hỏi' }).fill('Có nước giặt không?');
    await page.getByRole('textbox', { name: 'Nhập câu hỏi' }).press('Enter');
    await expect(page.getByText('Có nước giặt không?')).toBeVisible();
    await expect.poll(() => api.callsTo('POST', '/ai-advisor/chat')).toHaveLength(2);
    expect((api.callsTo('POST', '/ai-advisor/chat')[1]!.body as { history: unknown[] }).history).toHaveLength(2);
    await expect(page.getByRole('link', { name: /Nước rửa chén bồ hòn/ }).first()).toHaveAttribute('href', '/san-pham/nuoc-rua-chen-bo-hon');
  });

  test('lỗi: tin xin lỗi kèm Thử lại, bấm thì gửi lại đúng câu cũ và không nhân đôi tin của bạn', async ({ page, api }) => {
    mockAdvisor(api);
    let n = 0;
    api.post('/ai-advisor/chat', () => (n++ === 0 ? reply(500, { message: 'Hết hạn mức' }) : { reply: 'Ổn rồi', products: [] }));
    await page.goto('/tu-van');
    await page.getByRole('textbox', { name: 'Nhập câu hỏi' }).fill('Xin chào');
    await page.getByRole('button', { name: 'Gửi' }).click();
    await expect(page.getByText('Xin lỗi, mình chưa trả lời được lúc này 🌿')).toBeVisible();
    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect(page.getByText('Ổn rồi')).toBeVisible();
    expect(api.callsTo('POST', '/ai-advisor/chat').map((c) => (c.body as { message: string }).message)).toEqual(['Xin chào', 'Xin chào']);
    await expect(page.getByText('Xin chào', { exact: true })).toHaveCount(1);
  });

  test('khổ điện thoại: dòng "đang soạn" và câu trả lời nằm trên thanh nhập, không bị thanh che', async ({ page, api }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    mockAdvisor(api);
    let answer: () => void = () => {};
    const gate = new Promise<void>((r) => (answer = r));
    api.post('/ai-advisor/chat', async () => {
      await gate;
      return { reply: 'Bạn thử loại này nhé', products: [] };
    });
    await page.goto('/tu-van');
    await page.getByRole('textbox', { name: 'Nhập câu hỏi' }).fill('Xin chào');
    await page.getByRole('button', { name: 'Gửi' }).click();
    const bar = page.getByRole('textbox', { name: 'Nhập câu hỏi' }).locator('xpath=..');
    const status = page.getByRole('status').filter({ hasText: 'Trợ lý đang soạn' });
    await expect(status).toBeVisible();
    const barTop = async () => (await bar.boundingBox())!.y;
    await expect.poll(async () => (await status.boundingBox())!.y + (await status.boundingBox())!.height).toBeLessThanOrEqual(await barTop() + 1);
    answer();
    const reply = page.getByText('Bạn thử loại này nhé');
    await expect(reply).toBeVisible();
    await expect.poll(async () => (await reply.boundingBox())!.y + (await reply.boundingBox())!.height).toBeLessThanOrEqual(await barTop() + 1);
  });

  test('server báo tắt AI: về Trang chủ, không gọi chat', async ({ page, api }) => {
    mockAdvisor(api, false);
    // Trang chủ mở sau khi chuyển hướng gọi nhiều khối không liên quan tới luồng này.
    api.allowUnmocked(
      'GET /me/purchased-items', 'GET /me/subscriptions', 'GET /flash-sales/active', 'GET /flash-sales/upcoming',
      'GET /me/new-customer-offer', 'GET /me/notifications', 'GET /products/for-you', 'GET /me/wishlist/ids',
    );
    await page.goto('/tu-van');
    await expect(page).toHaveURL(/\/$/);
    expect(api.callsTo('POST', '/ai-advisor/chat')).toHaveLength(0);
  });

  test('khách chưa đăng nhập được mời đăng nhập, không gọi chat', async ({ page, api }) => {
    api.post('/auth/refresh', () => reply(401, { message: 'Hết phiên' }));
    api.get('/config/public', { freeshipThreshold: 500000, aiAdvisorEnabled: true });
    await page.goto('/tu-van');
    await expect(page.getByRole('main').getByRole('link', { name: /Đăng nhập/ })).toBeVisible();
    expect(api.callsTo('POST', '/ai-advisor/chat')).toHaveLength(0);
  });
});
