import type { Page } from '@playwright/test';
import { test, expect, makeUser, mockSession, type MockApi } from './support/mock-api';
import {
  CLAIMABLE_ID,
  collectPageErrors,
  contentHeight,
  dotFacts,
  horizontalOverflow,
  mockRetention,
  ONE_TIME_WITH_CLAIMABLE,
  retentionState,
  shoot,
  type RetentionState,
} from './support/retention-daily';

/**
 * Mini App 360px (gói tubu-retention-daily): nhiệm vụ hằng ngày ở thẻ Nhiệm vụ của Vườn Xanh, hàng Huy hiệu ở Cá nhân và chấm nhắc ở thanh đáy,
 * mỗi thứ sau cờ riêng (engagement.daily_missions_enabled, engagement.badges_enabled). Cờ tắt thì màn như trước. API mock toàn bộ.
 * Ảnh trước/sau lưu ở RETENTION_SHOTS_DIR (mặc định /tmp/review/tubu/shots/waves/tubu-retention-daily).
 */
const VP = { width: 360, height: 780 } as const;
/** Chừa cho lề trên của hàng Huy hiệu và làm tròn khi đo trang dài thêm. */
const PROFILE_GROWTH_SLACK_PX = 16;

const nav = (page: Page) => page.getByRole('navigation');

async function setup(page: Page, api: MockApi, over: Partial<RetentionState> = {}): Promise<{ state: RetentionState; crashed: string[] }> {
  const state = retentionState(over);
  mockSession(api, makeUser({ id: 'u-retention', fullName: 'Nguyễn Văn An' }));
  mockRetention(api, state);
  const crashed = collectPageErrors(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('tubu_garden_hint_seen', '1');
    } catch {
      // không có localStorage: màn vẫn dựng
    }
  });
  await page.setViewportSize(VP);
  return { state, crashed };
}

async function openGarden(page: Page, api: MockApi): Promise<void> {
  await page.goto('/game');
  await expect(page.getByRole('heading', { name: 'Nhiệm vụ' })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => api.callsTo('GET', '/game/daily').length, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function openProfile(page: Page, api: MockApi): Promise<void> {
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Đơn của tôi' })).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => api.callsTo('GET', '/game/badges').length, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

/** "Câu chuyện thương hiệu" là mục con của "Hỗ trợ" (đóng sẵn, panel `hidden`): mở ra mới kiểm có/không được. */
async function openSupport(page: Page): Promise<void> {
  const support = page.getByRole('button', { name: /^Hỗ trợ/ });
  await support.click();
  await expect(support).toHaveAttribute('aria-expanded', 'true');
}

test.describe('Mini App 360px: cờ tắt giữ nguyên màn như trước', () => {
  test('Vườn Xanh và Cá nhân không có nhiệm vụ Hôm nay, huy hiệu hay chấm dù điều kiện chấm đã đủ', async ({ page, api }) => {
    const { crashed } = await setup(page, api, { dailyEnabled: false, badgesEnabled: false, checkedInToday: false, quizPending: true, unread: 3 });

    await openGarden(page, api);
    await expect(page.getByText('Đánh giá 3 sản phẩm')).toBeVisible();
    await expect(page.getByText('Mời 3 bạn bè')).toBeVisible();
    await expect(page.getByTestId('daily-missions')).toHaveCount(0);
    await expect(page.locator('[data-testid^="daily-row-"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Xem nhiệm vụ một lần/ })).toHaveCount(0);
    await expect(page.getByTestId('garden-dot')).toHaveCount(0);
    await expect(page.getByTestId('profile-dot')).toHaveCount(0);
    await expect(nav(page).getByRole('button', { name: 'Vườn Xanh', exact: true })).toBeVisible();
    await expect(nav(page).getByRole('button', { name: 'Cá nhân', exact: true })).toBeVisible();
    expect((await horizontalOverflow(page)).ok).toBe(true);
    await shoot(page, 'mini-garden-before', page.getByRole('heading', { name: 'Nhiệm vụ' }));

    await openProfile(page, api);
    await expect(page.getByTestId('badge-row')).toHaveCount(0);
    await openSupport(page);
    await expect(page.getByText('Câu chuyện thương hiệu', { exact: true })).toBeVisible();
    await expect(page.getByTestId('garden-dot')).toHaveCount(0);
    await expect(page.getByTestId('profile-dot')).toHaveCount(0);
    expect((await horizontalOverflow(page)).ok).toBe(true);
    await shoot(page, 'mini-profile-before', page.getByRole('region', { name: 'Đơn của tôi' }));

    expect(crashed).toEqual([]);
  });
});

test.describe('Mini App 360px: nhiệm vụ hằng ngày', () => {
  test('cờ bật: 3 dòng Hôm nay ở đầu thẻ Nhiệm vụ, nhiệm vụ một lần thu sau một nút, bấm Nhận gửi đúng POST kèm mã thiết bị', async ({ page, api }) => {
    const { crashed } = await setup(page, api, { dailyEnabled: true });
    await openGarden(page, api);

    const section = page.getByTestId('daily-missions');
    await expect(section).toBeVisible();
    await expect(section.locator('[data-testid^="daily-row-"]')).toHaveCount(3);
    for (const id of ['DAILY_QUIZ', 'DAILY_WATER', 'DAILY_STORY']) await expect(page.getByTestId(`daily-row-${id}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Làm nhiệm vụ: Chơi Đố Xanh' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nhận thưởng: Tưới cây' })).toBeVisible();
    await expect(page.getByTestId('daily-row-DAILY_STORY').getByText('Xem một sản phẩm, đã nhận thưởng')).toBeAttached();
    await expect(section.getByText('Xong cả 3 nhiệm vụ: +10 Điểm Xanh')).toBeVisible();

    // Phần Hôm nay đứng ngay dưới tiêu đề thẻ và trên nút thu gọn; nhiệm vụ một lần chưa hiện.
    const toggle = page.getByRole('button', { name: 'Xem nhiệm vụ một lần (2)' });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Đánh giá 3 sản phẩm')).toHaveCount(0);
    await expect(page.getByText('Mời 3 bạn bè')).toHaveCount(0);
    const heading = (await page.getByRole('heading', { name: 'Nhiệm vụ' }).boundingBox())!;
    const secBox = (await section.boundingBox())!;
    const toggleBox = (await toggle.boundingBox())!;
    expect(secBox.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
    expect(secBox.y + secBox.height).toBeLessThanOrEqual(toggleBox.y + 1);
    expect((await horizontalOverflow(page)).ok).toBe(true);
    await shoot(page, 'mini-garden-after', page.getByRole('heading', { name: 'Nhiệm vụ' }));

    await toggle.click();
    await expect(page.getByRole('button', { name: 'Ẩn nhiệm vụ một lần' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Đánh giá 3 sản phẩm')).toBeVisible();
    await expect(page.getByText('Mời 3 bạn bè')).toBeVisible();
    expect((await horizontalOverflow(page)).ok).toBe(true);

    const claim = api.waitForCall('POST', '/game/daily/:id/claim');
    await page.getByRole('button', { name: 'Nhận thưởng: Tưới cây' }).click();
    const call = await claim;
    expect(call.path).toBe(`/game/daily/${CLAIMABLE_ID}/claim`);
    const body = call.body as { deviceId?: unknown };
    expect(Object.keys(body)).toEqual(['deviceId']);
    expect(String(body.deviceId)).toMatch(/^[0-9a-f]{32}$/);
    await expect(page.getByText('Đã nhận +5 💧')).toBeVisible();
    // Làm mới sau khi nhận: dòng đã nhận, không còn nút Nhận và không gửi lần hai.
    await expect(page.getByRole('button', { name: 'Nhận thưởng: Tưới cây' })).toHaveCount(0);
    await expect(page.getByTestId('daily-row-DAILY_WATER').getByText('Tưới cây, đã nhận thưởng')).toBeAttached();
    expect(api.callsTo('POST', '/game/daily/:id/claim')).toHaveLength(1);

    expect(crashed).toEqual([]);
  });
});

test.describe('Mini App 360px: nhiệm vụ một lần đang chờ nhận', () => {
  test('có nhiệm vụ một lần đã xong chưa nhận: phần một lần mở sẵn, không có nút "Xem nhiệm vụ một lần"', async ({ page, api }) => {
    const { crashed } = await setup(page, api, { dailyEnabled: true, oneTime: ONE_TIME_WITH_CLAIMABLE });
    await openGarden(page, api);

    await expect(page.getByTestId('daily-missions')).toBeVisible();
    await expect(page.getByRole('button', { name: /Xem nhiệm vụ một lần/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Ẩn nhiệm vụ một lần/ })).toHaveCount(0);
    await expect(page.getByText('Đánh giá 3 sản phẩm')).toBeVisible();
    await expect(page.getByText('Mời 3 bạn bè')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nhận thưởng', exact: true })).toHaveCount(1);
    expect((await horizontalOverflow(page)).ok).toBe(true);
    expect(crashed).toEqual([]);
  });
});

test.describe('Mini App 360px: hàng Huy hiệu', () => {
  test('cờ bật: 8 chip, ẩn "Câu chuyện thương hiệu", chỉ hàng Huy hiệu làm Cá nhân dài thêm so với cờ tắt', async ({ page, api }) => {
    const { state, crashed } = await setup(page, api, { badgesEnabled: false });

    await openProfile(page, api);
    await expect(page.getByTestId('badge-row')).toHaveCount(0);
    // Đo khi mọi accordion còn đóng, trước khi mở Hỗ trợ.
    const off = await contentHeight(page);
    await openSupport(page);
    await expect(page.getByText('Câu chuyện thương hiệu', { exact: true })).toBeVisible();

    state.badgesEnabled = true;
    await openProfile(page, api);
    const row = page.getByTestId('badge-row');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByRole('heading', { name: 'Huy hiệu' })).toBeVisible();
    await expect(row.getByText('2/8')).toBeVisible();
    const chips = row.getByRole('button');
    await expect(chips).toHaveCount(8);
    // Đã đạt đứng trước; chưa đạt kèm điều kiện trong tên truy cập.
    await expect(chips.nth(0)).toHaveAccessibleName('Đơn đầu tiên, đã đạt');
    await expect(chips.nth(1)).toHaveAccessibleName('Chuỗi 7 ngày, đã đạt');
    await expect(chips.nth(2)).toHaveAccessibleName('Đổi rác 3 lần, chưa đạt. Hoàn tất 3 lần Đổi rác lấy quà.');
    const on = await contentHeight(page);
    const rowHeight = (await row.boundingBox())?.height ?? 0;
    await openSupport(page);
    await expect(page.getByText('Câu chuyện thương hiệu', { exact: true })).toHaveCount(0);

    // Dòng "Câu chuyện thương hiệu" nằm trong Hỗ trợ đóng nên bỏ nó không bù chiều cao: trang chỉ được dài thêm đúng hộp hàng Huy hiệu.
    const delta = on.height - off.height;
    const line = `PROFILE_HEIGHT_MINI360 off=${off.height} on=${on.height} delta=${delta} badgeRow=${rowHeight} (doc ${off.doc}/${on.doc}, zaui ${off.zaui}/${on.zaui})`;
    console.log(line);
    test.info().annotations.push({ type: 'profile-height', description: line });
    expect(delta, line).toBeLessThanOrEqual(rowHeight + PROFILE_GROWTH_SLACK_PX);
    expect((await horizontalOverflow(page)).ok).toBe(true);
    await shoot(page, 'mini-profile-after', page.getByRole('region', { name: 'Đơn của tôi' }));

    await chips.nth(2).click();
    await expect(page.getByText('Hoàn tất 3 lần Đổi rác lấy quà.', { exact: true })).toBeVisible();
    expect(crashed).toEqual([]);
  });
});

const DOT_CASES: { name: string; over: Partial<RetentionState>; garden: boolean; profile: boolean }[] = [
  { name: 'chưa điểm danh và có tin chưa đọc, không đơn đang xử lý: cả hai chấm', over: { checkedInToday: false, unread: 2 }, garden: true, profile: true },
  { name: 'đã điểm danh nhưng Đố Xanh hôm nay chưa làm: chỉ chấm Vườn Xanh', over: { checkedInToday: true, quizPending: true, unread: 0 }, garden: true, profile: false },
  { name: 'đã điểm danh, Đố Xanh đã làm, không tin chưa đọc: không chấm nào', over: { checkedInToday: true, quizPending: false, unread: 0 }, garden: false, profile: false },
  { name: 'có tin chưa đọc nhưng đang có đơn xử lý: số đơn thắng, không chấm Cá nhân', over: { checkedInToday: true, unread: 5, activeOrders: 2 }, garden: false, profile: false },
];

test.describe('Mini App 360px: chấm nhắc thanh đáy khi cờ nhiệm vụ bật', () => {
  for (const c of DOT_CASES) {
    test(c.name, async ({ page, api }) => {
      const { crashed } = await setup(page, api, { dailyEnabled: true, ...c.over });
      await openGarden(page, api);
      await expect.poll(() => api.callsTo('GET', '/me/summary').length, { timeout: 10_000 }).toBeGreaterThan(0);
      await page.waitForTimeout(400);

      const gardenDot = page.getByTestId('garden-dot');
      const profileDot = page.getByTestId('profile-dot');
      const gardenTab = nav(page).getByRole('button', { name: /^Vườn Xanh/ });
      const profileTab = nav(page).getByRole('button', { name: /^Cá nhân/ });

      if (c.garden) {
        await expect(gardenDot).toBeVisible();
        await expect(gardenTab).toHaveAccessibleName('Vườn Xanh, có việc hôm nay');
        const f = await dotFacts(gardenDot);
        console.log(`DOT_MINI garden ${f.width}x${f.height} animation=${f.animationName}`);
        expect(Math.abs(f.width - 8)).toBeLessThan(0.5);
        expect(Math.abs(f.height - 8)).toBeLessThan(0.5);
        expect(f.animationName).toBe('none');
      } else {
        await expect(gardenDot).toHaveCount(0);
        await expect(gardenTab).toHaveAccessibleName('Vườn Xanh');
      }

      if (c.profile) {
        await expect(profileDot).toBeVisible();
        await expect(profileTab).toHaveAccessibleName('Cá nhân, có thông báo chưa đọc');
        const f = await dotFacts(profileDot);
        console.log(`DOT_MINI profile ${f.width}x${f.height} animation=${f.animationName}`);
        expect(Math.abs(f.width - 8)).toBeLessThan(0.5);
        expect(Math.abs(f.height - 8)).toBeLessThan(0.5);
        expect(f.animationName).toBe('none');
      } else {
        await expect(profileDot).toHaveCount(0);
        if (c.over.activeOrders) await expect(profileTab).toHaveAccessibleName(/2 đơn/);
        else await expect(profileTab).toHaveAccessibleName('Cá nhân');
      }
      expect(crashed).toEqual([]);
    });
  }
});

test.describe('Mini App 360px: không tràn ngang khi mọi cờ bật', () => {
  test('Vườn Xanh (mở cả nhiệm vụ một lần) và Cá nhân vừa khổ 360px, kèm chấm', async ({ page, api }) => {
    const { crashed } = await setup(page, api, { dailyEnabled: true, badgesEnabled: true, checkedInToday: false, unread: 4 });

    await openGarden(page, api);
    await expect(page.getByTestId('garden-dot')).toBeVisible();
    await page.getByRole('button', { name: 'Xem nhiệm vụ một lần (2)' }).click();
    await expect(page.getByText('Mời 3 bạn bè')).toBeVisible();
    const garden = await horizontalOverflow(page);
    console.log(`OVERFLOW_MINI360 garden ${JSON.stringify(garden)}`);
    expect(garden.ok, JSON.stringify(garden)).toBe(true);

    await openProfile(page, api);
    await expect(page.getByTestId('badge-row')).toBeVisible();
    await expect(page.getByTestId('profile-dot')).toBeVisible();
    const profile = await horizontalOverflow(page);
    console.log(`OVERFLOW_MINI360 profile ${JSON.stringify(profile)}`);
    expect(profile.ok, JSON.stringify(profile)).toBe(true);
    expect(crashed).toEqual([]);
  });
});
