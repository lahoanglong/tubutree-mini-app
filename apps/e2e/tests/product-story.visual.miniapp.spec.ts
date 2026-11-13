import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './support/mock-api';
import { CATALOG, mockDiscovery, productDetail } from './support/discovery-mocks';
import { SAMPLES, hideFixed, routeStoryImages, visualEnabled, visualFile } from './support/story-visual';

/**
 * Ảnh chụp Mini App 375px của dải câu chuyện với ảnh sản phẩm thật (chỉ chạy khi có STORY_SHOT_DIR và STORY_IMG_DIR, xem support/story-visual.ts).
 * Kiểm tự động trong ca: không tràn ngang, khung sân khấu có ảnh đã tải (không rỗng), mỗi thẻ chương bấm xong phải sáng. Còn lại xem ảnh bằng mắt.
 * Khung toàn màn nay chỉ còn ở Reel Trang chủ, do w42a-home-story-reel.*.spec.ts phủ, nên không chụp ở đây.
 */
test.use({ viewport: { width: 375, height: 812 } });
test.skip(!visualEnabled(), 'cần STORY_SHOT_DIR và STORY_IMG_DIR');

for (const sample of SAMPLES) {
  test(`Mini 375px: ${sample.key}`, async ({ page, api }) => {
    const slug = `visual-${sample.key}`;
    const ids = sample.variations.map((_, i) => `vis-${sample.key}-${i}`);
    mockDiscovery(api);
    api.get('/products/:slug', () => ({
      ...productDetail(CATALOG[0]!.slug)!,
      slug,
      brand: sample.brand,
      name: sample.name,
      images: sample.images,
      thumbnail: sample.images[0],
      ingredients: sample.ingredients,
      variations: sample.variations.map((v, i) => ({ id: ids[i]!, sku: `VIS-${i}`, name: v.name, attributes: {}, retailPrice: v.price, salePrice: null, stock: 20 })),
      storyConfig: sample.build(ids),
    }));
    await routeStoryImages(page);
    await page.goto(`/product/${slug}`);
    const story = page.getByTestId('product-story');
    await expect(story).toBeVisible({ timeout: 20_000 });
    await story.scrollIntoViewIfNeeded();

    const stage = story.getByTestId('story-stage');
    await expect.poll(() => stage.locator('.tubu-story-product img, img.tubu-story-product').first().evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    mkdirSync(visualFile(), { recursive: true });
    await page.screenshot({ path: path.join(visualFile(), `mini-375-${sample.key}-page.png`), fullPage: false });
    await story.evaluate((el) => void ((el as HTMLElement).style.display = 'none'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(visualFile(), `mini-375-${sample.key}-before.png`), fullPage: false });
    await story.evaluate((el) => void ((el as HTMLElement).style.display = ''));
    await hideFixed(page);
    const shot = (name: string) => story.screenshot({ path: path.join(visualFile(), `mini-375-${sample.key}-${name}.png`), animations: 'disabled' });
    await shot('1');
    await stage.screenshot({ path: path.join(visualFile(), `mini-375-${sample.key}-stage.png`), animations: 'disabled' });
    const hud = story.getByTestId('story-hud');
    if (await hud.count()) await hud.screenshot({ path: path.join(visualFile(), `mini-375-${sample.key}-hud.png`), animations: 'disabled' });

    const arc = story.getByTestId('story-arc-item');
    if ((await arc.count()) > 1) {
      await arc.nth(1).click();
      await page.waitForTimeout(400);
      await shot('arc-2');
    }
    // Mọi chương hiện sẵn dưới dạng thẻ: bấm từng thẻ, thẻ phải sáng rồi mới chụp.
    const cards = story.getByTestId('story-step-card');
    const n = await cards.count();
    for (let i = 1; i < n; i += 1) {
      await cards.nth(i).click();
      await expect(cards.nth(i)).toHaveAttribute('aria-current', 'step');
      await page.waitForTimeout(500);
      await shot(`step-${i + 1}`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
