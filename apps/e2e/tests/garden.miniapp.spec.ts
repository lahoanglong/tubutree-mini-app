import type { Garden, GameProfile } from '../../miniapp/src/services/game-api';
import { test, expect, makeUser, mockSession, reply, type MockApi } from './support/mock-api';

/**
 * Zalo Mini App E2E — Vườn Xanh (apps/miniapp/src/pages/game.tsx, route /game).
 * Route NestJS: game.controller.ts (GET /game/profile, /game/garden…, POST /game/tree/water,
 * /game/tree/buy với header Idempotency-Key, /game/garden/plot/:id/water).
 */

const PROFILE: GameProfile = {
  totalSeeds: 340,
  streakDays: 5,
  treeStage: 2,
  treeHealth: 'HEALTHY',
  streakFreezes: 1,
  lastDewAt: null,
  lastCheckInAt: null,
  ecoImpact: { progress: 40, target: 100, treeType: 'Cây Sưa Đỏ', treesPlanted: 3 },
  treePointsPrice: 300,
  spinCostPoints: 10,
};

const GARDEN: Garden = {
  plots: [
    { id: 'plot-home', slot: 1, isHome: true, treeType: 'Cây Sưa Đỏ', speciesId: null, progress: 40, target: 100, treeStage: 2, treesPlanted: 3, treeHealth: 'HEALTHY' },
    { id: 'plot-2', slot: 2, isHome: false, treeType: 'Cây Lim Xanh', speciesId: null, progress: 30, target: 60, treeStage: 1, treesPlanted: 0, treeHealth: 'HEALTHY' },
  ],
  maxPlots: 4,
  nextUnlock: { slot: 3, seedCost: 500 },
};

/** Giữ request đang bay đủ lâu để cú chạm thứ hai chắc chắn đến khi lần đầu chưa xong. */
const slow = <T>(value: T, ms = 400) => async () => {
  await new Promise((r) => setTimeout(r, ms));
  return value;
};

function mockGame(api: MockApi, profile: GameProfile = PROFILE) {
  mockSession(api, makeUser({ id: 'user-game', fullName: 'Người chơi E2E', pointsBalance: 900 }));
  api.get('/game/profile', profile);
  api.get('/game/quiz/today', []);
  api.get('/game/leaderboard', []);
  api.get('/game/missions', []);
  api.get('/game/forest', { count: 0, plantedCount: 0, trees: [] });
  api.get('/game/community', { goal: null, myDrops: 0, pct: 0 });
  api.get('/game/collection', []);
  api.get('/game/season', null);
  api.get('/game/season/leaderboard', []);
  api.get('/game/friends', []);
  api.get('/game/garden', GARDEN);
  api.get('/me/loyalty', { pointsBalance: 900, redeemablePoints: 900, redeemableTotal: 900, tier: null, nextTier: null, tiers: [] });
  api.allowUnmocked('GET /game/season-pass', 'POST /events');
}

test.describe('Vườn Xanh', () => {
  test('hiển thị trạng thái vườn từ API: tiến độ cây, giọt nước, chuỗi ngày và lô đất', async ({ page, api }) => {
    mockGame(api);
    await page.goto('/game');

    await expect(page.getByText('Cây Sưa Đỏ').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('progressbar', { name: 'Tiến độ cây' })).toHaveAttribute('aria-valuenow', '40');
    await expect(page.getByText(/🔥 5 ngày/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Nhận nước hôm nay/ })).toBeVisible();

    await page.getByText('Vườn', { exact: true }).first().click();
    await expect(page.getByRole('button', { name: /Góp quỹ trồng cây \(/ })).toBeVisible();
    await expect(page.getByText('Lô đất của bạn (2/4)')).toBeVisible();
    await expect(page.getByText('Lô 2 · Cây Lim Xanh')).toBeVisible();
  });

  test('chạm đúp "Tưới hết" chỉ gửi một request (drops = toàn bộ số giọt) và hiện tiến độ mới', async ({ page, api }) => {
    mockGame(api, { ...PROFILE, lastCheckInAt: new Date().toISOString() });
    api.post('/game/tree/water', slow({ progress: 60, target: 100, harvested: false, treesPlanted: 3 }));
    await page.goto('/game');

    const water = page.getByRole('button', { name: /Tưới hết/ });
    await expect(water).toBeEnabled({ timeout: 15_000 });
    // Hai click cùng một tick: chỉ khoá đồng bộ mới chặn được, `disabled` chưa kịp áp dụng.
    await water.evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });

    await expect(page.getByText(/Đã tưới · 60\/100/)).toBeVisible();
    expect(api.callsTo('POST', '/game/tree/water')).toHaveLength(1);
    expect(api.callsTo('POST', '/game/tree/water')[0]!.body).toEqual({ drops: 340 });
  });

  test('góp quỹ trồng cây: hộp xác nhận, một request kèm Idempotency-Key dù chạm đúp, báo thành công', async ({ page, api }) => {
    mockGame(api);
    api.post(
      '/game/tree/buy',
      slow({ certificateCode: 'CERT-E2E-1', treeType: 'Cây Sưa Đỏ', cost: 300, pointsUsed: 300, pointsUsedConverted: 0 }),
    );
    await page.goto('/game');

    await page.getByText('Vườn', { exact: true }).first().click({ timeout: 15_000 });
    await page.getByRole('button', { name: /Góp quỹ trồng cây \(/ }).click();
    await expect(page.getByText('Góp quỹ trồng cây?')).toBeVisible();
    expect(api.callsTo('POST', '/game/tree/buy')).toHaveLength(0);

    // React vẽ lại đồng bộ sau click nên nút bị khoá/`loading` ngay; gọi hai lần handler đã chụp từ trước
    // mô phỏng hai cú chạm lọt vào trước lần vẽ lại — chỉ khoá `inFlight` trong TreeActions còn chặn được.
    await page.getByRole('button', { name: 'Xác nhận' }).evaluate((el) => {
      const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
      const onClick = (el as unknown as Record<string, { onClick: (e: unknown) => void }>)[propsKey!]!.onClick;
      const ev = { preventDefault() {}, stopPropagation() {} };
      onClick(ev);
      onClick(ev);
    });

    await expect(page.getByText(/Đã góp 1 cây vào quỹ trồng cây/)).toBeVisible();
    await expect(page.getByText(/CERT-E2E-1/)).toBeVisible();
    await expect(page.getByText('Góp quỹ trồng cây?')).toBeHidden();

    const calls = api.callsTo('POST', '/game/tree/buy');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers['idempotency-key']).toMatch(/\S{8,}/);
  });

  test('góp quỹ thất bại: hộp ở lại, báo lỗi, "Xác nhận" gửi lại cùng Idempotency-Key', async ({ page, api }) => {
    mockGame(api);
    let attempt = 0;
    api.post('/game/tree/buy', () => {
      attempt += 1;
      if (attempt === 1) return reply(400, { message: 'Không đủ Điểm Xanh để góp cây.' });
      return { certificateCode: 'CERT-E2E-2', treeType: 'Cây Sưa Đỏ', cost: 300, pointsUsed: 300, pointsUsedConverted: 0 };
    });
    await page.goto('/game');

    await page.getByText('Vườn', { exact: true }).first().click({ timeout: 15_000 });
    await page.getByRole('button', { name: /Góp quỹ trồng cây \(/ }).click();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByText('Không đủ Điểm Xanh để góp cây.')).toBeVisible();
    await expect(page.getByText('Góp quỹ trồng cây?')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Xác nhận' })).toBeEnabled();
    await page.getByRole('button', { name: 'Xác nhận' }).click();
    await expect(page.getByText(/Đã góp 1 cây vào quỹ trồng cây/)).toBeVisible();

    const calls = api.callsTo('POST', '/game/tree/buy');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
  });

  test('tưới lô đất phụ gọi đúng lô; chạm đúp vẫn một request', async ({ page, api }) => {
    mockGame(api);
    api.post('/game/garden/plot/:id/water', slow({ progress: 50, target: 60, harvested: false, treesPlanted: 0, revivedFromDead: false }));
    await page.goto('/game');

    await page.getByText('Vườn', { exact: true }).first().click({ timeout: 15_000 });
    const water = page.getByRole('button', { name: 'Tưới', exact: true });
    await expect(water).toBeVisible();
    await water.evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });

    await expect(page.getByText(/Đã tưới lô · 50\/60/)).toBeVisible();
    const calls = api.callsTo('POST', '/game/garden/plot/:id/water');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/game/garden/plot/plot-2/water');
  });

  test('khách mới: điểm danh nhận 65💧, tưới hết thu hoạch cây mầm +2.000 Điểm Xanh, rồi còn câu đố để kiếm nước', async ({ page, api }) => {
    let checkedIn = false;
    let harvested = false;
    mockGame(api);
    api.get('/game/profile', () => ({
      ...PROFILE,
      totalSeeds: harvested ? 5 : checkedIn ? 65 : 0,
      streakDays: checkedIn ? 1 : 0,
      lastCheckInAt: checkedIn ? new Date().toISOString() : null,
      dailyLoginSeeds: 15,
      dewSeeds: 15,
      firstCheckinBonus: checkedIn ? 0 : 50,
      ecoImpact: { progress: harvested ? 5 : 0, target: harvested ? 300 : 60, treeType: 'Cây Dứa', treesPlanted: harvested ? 1 : 0 },
    }));
    api.get('/game/quiz/today', [{ id: 'q1', question: 'Cây cần gì?', options: ['Nước', 'Đá'], category: 'cay', difficulty: 1, waterReward: 8 }]);
    api.post('/me/daily-check-in', () => {
      checkedIn = true;
      return {
        points: null,
        water: { seedsEarned: 65, streakDays: 1, totalSeeds: 65, streakFrozeUsed: false, bonusNote: '' },
        alreadyDone: false,
        pending: [],
      };
    });
    api.post('/game/tree/water', () => {
      harvested = true;
      return { progress: 5, target: 300, harvested: true, treesPlanted: 1, reward: { points: 2000 } };
    });
    await page.goto('/game');

    await page.getByRole('button', { name: 'Điểm danh nhận 65💧' }).click({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Tưới hết (65💧)' }).click();
    await expect(page.getByText('+2.000 Điểm Xanh')).toBeVisible();
    await expect(page.getByText('Cây tiếp theo cần 300💧')).toBeVisible();
    expect(api.callsTo('POST', '/game/tree/water')[0]!.body).toEqual({ drops: 65 });
    await page.getByRole('button', { name: 'Tuyệt vời!' }).click();

    await page.getByRole('button', { name: 'Kiếm thêm nước' }).click();
    await expect(page.getByText('Làm câu đố (còn 1 câu)')).toBeVisible();
  });

  test('profile lỗi 500: hiện thông báo lỗi kèm nút thử lại, không sập; thử lại thì phục hồi', async ({ page, api }) => {
    mockGame(api);
    let fail = true;
    api.get('/game/profile', () => (fail ? reply(500, { message: 'Lỗi nội bộ' }) : PROFILE));
    await page.goto('/game');

    await expect(page.getByText('Máy chủ đang bận, thử lại nhé.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Nhận nước hôm nay/ })).toHaveCount(0);

    fail = false;
    await page.getByRole('button', { name: /Thử lại/ }).click();
    await expect(page.getByRole('button', { name: /Nhận nước hôm nay/ })).toBeVisible();
  });
});
