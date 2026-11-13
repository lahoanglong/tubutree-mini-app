import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect, test, type MockApi } from './support/mock-api';
import { blockingViolations, runAxe } from './support/axe';

/**
 * Web khách: dải câu chuyện sản phẩm là mục nội tuyến kiểu Split-Card (W133). Ảnh sân khấu một cột, mọi chương luôn hiện thành thẻ bấm được (thẻ đang chọn có aria-current="step"),
 * không còn mốc cuộn, cột ghim hay khung toàn màn trên trang sản phẩm (khung toàn màn chỉ còn cho Reel Trang chủ, spec ở w42a-home-story-reel.web.spec.ts).
 * Phần server của Next gọi API thật nên spec dùng sản phẩm mẫu của seed (dầu gội Pơ Lang): kịch bản mẫu của nó dùng ảnh poster (không có ảnh tách nền) nên sprite nguyên liệu và chú thích
 * không được vẽ đè lên ảnh, điểm nhấn HUD thành dải chip dưới ảnh; mọi lời gọi từ trình duyệt đi qua mock.
 */
const SLUG = 'dau-goi-buoi-po-lang';
const API_ORIGIN = `http://localhost:${process.env.E2E_API_PORT}`;

async function seeded(request: APIRequestContext): Promise<{ variations: { id: string; stock: number }[] } | null> {
  const r = await request.get(`${API_ORIGIN}/api/products/${SLUG}`).catch(() => null);
  return r?.ok() ? ((await r.json()) as { variations: { id: string; stock: number }[] }) : null;
}

function mockPdp(api: MockApi, p: { variations: { id: string; stock: number }[] }): void {
  api.get('/flash-sales/active', []);
  api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
  api.get(`/products/${SLUG}`, { variations: p.variations });
  api.get(`/products/${SLUG}/related`, []);
  api.get(`/products/${SLUG}/bought-together`, []);
  api.get('/products/for-you', []);
  api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
  api.get(`/products/${SLUG}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  api.get('/me/wishlist/ids', []);
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Đo sân khấu, thẻ chương đầu và dải chip trong một lần evaluate để cùng một lần cuộn, không lệch vì ảnh nạp muộn giữa hai lần đo. */
async function layout(story: Locator): Promise<{ stage: Box; card: Box; points: Box | null }> {
  return story.evaluate((el) => {
    const box = (selector: string): Box | null => {
      const node = el.querySelector(selector);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return { stage: box('[data-testid="story-stage"]')!, card: box('[data-testid="story-step-card"]')!, points: box('[data-testid="story-points"]') };
  });
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('Web khách: câu chuyện sản phẩm nội tuyến', () => {
  test('375px: dải ở dưới khối mua nhanh, một bản hiện, ảnh trên rồi tới mọi chương, ảnh poster không bị phủ gì, không tràn ngang, axe sạch, không có khung toàn màn', async ({ page, api, request }) => {
    const p = await seeded(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
    mockPdp(api, p!);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/san-pham/${SLUG}`);

    const stories = page.locator('[data-section="pdp-story"]');
    await expect(stories).toHaveCount(2);
    const story = stories.locator('visible=true');
    await expect(story).toHaveCount(1);
    await story.scrollIntoViewIfNeeded();

    const inInfo = await story.evaluate((el) => !!el.closest('[data-testid="pdp-info"]'));
    expect(inInfo).toBe(true);

    const qty = page.getByRole('button', { name: 'Tăng số lượng' });
    const qtyBox = await qty.boundingBox();
    const storyBox = await story.boundingBox();
    expect(qtyBox && storyBox && storyBox.y > qtyBox.y).toBe(true);

    // Mọi chương cùng hiện (không ẩn chữ sau chip hay mốc cuộn); chương đầu đang chọn.
    const cards = story.getByTestId('story-step-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(3);
    for (const card of await cards.all()) await expect(card).toBeVisible();
    await expect(cards.first()).toHaveAttribute('aria-current', 'step');
    await expect(story.locator('[aria-current="step"]')).toHaveCount(1);

    // Ảnh poster: không sprite, không chú thích, không lớp HUD đè lên ảnh; điểm nhấn là dải chip nằm dưới khung ảnh.
    for (const id of ['story-layer', 'story-callout', 'story-hud']) await expect(story.getByTestId(id)).toHaveCount(0);
    await expect(story.getByTestId('story-stage')).toHaveAttribute('data-frame', 'floating-card');
    await expect(story.getByTestId('story-points').getByTestId('story-point').first()).toBeVisible();
    await expect(story.getByTestId('story-closing')).toBeVisible();

    // Một cột ở 375px: ảnh rồi mới tới các chương, chip dưới ảnh.
    const g = await layout(story);
    expect(g.stage.y + g.stage.h, 'ảnh nằm trên thẻ chương đầu').toBeLessThanOrEqual(g.card.y + 1);
    expect(g.points && g.points.y >= g.stage.y + g.stage.h - 1, 'chip điểm nhấn nằm dưới khung ảnh').toBe(true);

    // Vòng cung phân loại: có từ 2 phân loại thì mỗi phân loại một mục và đúng một mục đang chọn.
    if (p!.variations.length >= 2) {
      await expect(story.getByTestId('story-arc-item')).toHaveCount(p!.variations.length);
      await expect(story.locator('[data-testid="story-arc-item"][aria-checked="true"]')).toHaveCount(1);
    }

    // Bấm thẻ chương thứ hai: thẻ đó thành chương đang chọn, chương đầu vẫn đọc được.
    await cards.nth(1).click();
    await expect(cards.nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(cards.first()).not.toHaveAttribute('aria-current', 'step');
    await expect(cards.first().locator('.tubu-story-step-body')).toBeVisible();

    expect(await noHorizontalScroll(page)).toBe(true);

    await page.evaluate(() => document.fonts.ready);
    const found = await runAxe(page);
    expect(blockingViolations('web', 'Câu chuyện sản phẩm', found)).toEqual([]);

    // Trang sản phẩm không còn khung toàn màn: không nút mở, bấm thẻ không bật hộp thoại.
    await expect(page.getByTestId('pdp-story-open')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toHaveCount(0);
  });

  test('1280px: bản rộng ở đầu phần dưới, chương bên trái và ảnh bên phải, chọn chương không mở khung toàn màn', async ({ page, api, request }) => {
    const p = await seeded(request);
    test.skip(!p, 'DB e2e chưa có sản phẩm mẫu của seed');
    mockPdp(api, p!);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/san-pham/${SLUG}`);

    const stories = page.locator('[data-section="pdp-story"]');
    await expect(stories).toHaveCount(2);
    const story = stories.locator('visible=true');
    await expect(story).toHaveCount(1);
    await story.scrollIntoViewIfNeeded();

    const inInfo = await story.evaluate((el) => !!el.closest('[data-testid="pdp-info"]'));
    expect(inInfo, 'bản rộng nằm ở phần dưới, không nằm trong cột thông tin').toBe(false);

    // Khối Story rộng từ 56rem thì chia hai cột: chương bên trái, ảnh bên phải (khung PDP 1200px trừ đệm còn khoảng 1100px).
    const g = await layout(story);
    expect(g.card.x + g.card.w, 'thẻ chương nằm hẳn bên trái ảnh').toBeLessThanOrEqual(g.stage.x + 1);

    const cards = story.getByTestId('story-step-card');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
    await expect(cards.first()).toHaveAttribute('aria-current', 'step');
    await cards.last().click();
    await expect(cards.last()).toHaveAttribute('aria-current', 'step');
    await expect(story.locator('[aria-current="step"]')).toHaveCount(1);

    await expect(page.getByTestId('pdp-story-open')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});
