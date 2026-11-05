import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from './support/mock-api';
import { seedDatabaseUrl } from './support/a11y-db';
import { writableTempDb } from './support/waste-db';
import { SAMPLES, hideFixed, routeStoryImages, visualEnabled, visualFile } from './support/story-visual';

/**
 * Ảnh chụp web 375px và 1280px của dải câu chuyện với ảnh sản phẩm thật (chỉ chạy khi có STORY_SHOT_DIR và STORY_IMG_DIR, xem support/story-visual.ts).
 * Trang chi tiết dựng ở phía máy chủ từ API thật nên dữ liệu mẫu ghi thẳng vào DB tạm của web-gate.sh (không bao giờ vào DB khác) trước lượt vào trang đầu tiên.
 * Kiểm tự động trong ca: không tràn ngang, ảnh sân khấu đã tải. Còn lại xem ảnh bằng mắt.
 */
test.skip(!visualEnabled(), 'cần STORY_SHOT_DIR và STORY_IMG_DIR');

const CANDIDATES = ['mat-ong-rung-bhnong', 'granola-hat-sokfram', 'bot-rau-ma-sokfram', 'nuoc-rua-chen-fuwa3e', 'nuoc-giat-fuwa3e', 'arabica-cau-dat-le-plateau', 'serum-duong-am-visante'];
const slugOf = new Map<string, { slug: string; variationIds: string[] }>();

test.beforeAll(async () => {
  const url = seedDatabaseUrl();
  if (!writableTempDb(url)) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { PrismaClient } = require(path.resolve(__dirname, '../../api/node_modules/@prisma/client')) as { PrismaClient: new (o: unknown) => any };
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const used = new Set<string>();
    const all: { slug: string; variations: { id: string }[] }[] = await prisma.product.findMany({ where: { isActive: true }, include: { variations: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
    const rank = (slug: string) => (CANDIDATES.includes(slug) ? CANDIDATES.indexOf(slug) : CANDIDATES.length);
    const ordered = [...all].sort((a, b) => rank(a.slug) - rank(b.slug));
    for (const sample of SAMPLES) {
      const p = ordered.find((x) => !used.has(x.slug) && x.variations.length >= 1);
      if (!p) continue;
      // Seed chỉ có tối đa 2 phân loại mỗi sản phẩm: thiếu thì thêm vào DB tạm để vòng cung có đủ số mục như bản mẫu.
      for (let i = p.variations.length; i < sample.variations.length; i += 1) {
        const v = await prisma.variation.create({ data: { productId: (await prisma.product.findUnique({ where: { slug: p.slug } })).id, sku: `STORY-VIS-${p.slug}-${i}`.slice(0, 60), name: sample.variations[i]!.name, attributes: {}, retailPrice: sample.variations[i]!.price, stock: 20 } });
        p.variations.push({ id: v.id });
      }
      const ids = p.variations.slice(0, sample.variations.length).map((v) => v.id);
      await prisma.product.update({ where: { slug: p.slug }, data: { name: sample.name, brand: sample.brand, images: sample.images, thumbnail: sample.images[0], storyConfig: sample.build(ids) } });
      for (const [i, v] of sample.variations.entries()) await prisma.variation.update({ where: { id: ids[i] }, data: { name: v.name, stock: 20 } });
      used.add(p.slug);
      slugOf.set(sample.key, { slug: p.slug, variationIds: ids });
    }
  } finally {
    await prisma.$disconnect();
  }
});

const VIEWPORTS = [
  { tag: '375', width: 375, height: 812 },
  { tag: '1280', width: 1280, height: 900 },
] as const;

for (const sample of SAMPLES) {
  for (const vp of VIEWPORTS) {
    test(`Web ${vp.tag}px: ${sample.key}`, async ({ page, api, request }) => {
      const hit = slugOf.get(sample.key);
      test.skip(!hit, 'DB e2e chưa có sản phẩm mẫu hoặc không phải DB tạm');
      const slug = hit!.slug;
      const origin = `http://localhost:${process.env.E2E_API_PORT}`;
      const res = await request.get(`${origin}/api/products/${slug}`);
      expect(res.ok()).toBe(true);
      api.get('/flash-sales/active', []);
      api.get('/config/public', { freeshipThreshold: 350000, subscribeDiscountPct: 0.12 });
      api.get(`/products/${slug}`, await res.json());
      api.get(`/products/${slug}/related`, []);
      api.get(`/products/${slug}/bought-together`, []);
      api.get('/products/for-you', []);
      api.get('/products', { data: [], meta: { page: 1, limit: 12, total: 0 } });
      api.get(`/products/${slug}/reviews`, { average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
      api.get('/me/wishlist/ids', []);
      await routeStoryImages(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/san-pham/${slug}`);

      const story = page.locator('[data-section="pdp-story"]').locator('visible=true');
      await expect(story).toHaveCount(1);
      await story.scrollIntoViewIfNeeded();
      await expect.poll(() => story.locator('.tubu-story-product').first().evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      mkdirSync(visualFile(), { recursive: true });
      const base = (name: string) => path.join(visualFile(), `web-${vp.tag}-${sample.key}-${name}.png`);
      await page.screenshot({ path: base('page') });
      const setSections = (display: string) => page.evaluate((d) => document.querySelectorAll<HTMLElement>('[data-section="pdp-story"]').forEach((el) => void (el.style.display = d)), display);
      await setSections('none');
      await page.waitForTimeout(200);
      await page.screenshot({ path: base('before') });
      await setSections('');
      await story.scrollIntoViewIfNeeded();

      const sentinels = story.locator('.tubu-story-sentinel');
      const total = (await sentinels.first().isVisible().catch(() => false)) ? await sentinels.count() : 0;
      for (let i = 0; i < total; i += 1) {
        await sentinels.nth(i).evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(500);
        await expect(story.getByTestId('story-step-chip').nth(i)).toHaveAttribute('aria-current', 'step');
        const pinned = await story.getByTestId('story-stage').evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight;
        });
        expect(pinned, `sân khấu còn ghim trong khung nhìn ở bước ${i + 1}`).toBe(true);
        await page.screenshot({ path: base(`scrub-${i + 1}`) });
      }
      await story.scrollIntoViewIfNeeded();
      await hideFixed(page);
      await shoot(story, base);
      await openFullscreen(page, story, base);
    });
  }
}

async function shoot(story: import('@playwright/test').Locator, base: (n: string) => string): Promise<void> {
  const page = story.page();
  await story.screenshot({ path: base('1'), animations: 'disabled' });
  const arc = story.getByTestId('story-arc-item');
  if ((await arc.count()) > 1) {
    await arc.nth(1).click();
    await page.waitForTimeout(400);
    await story.screenshot({ path: base('arc-2'), animations: 'disabled' });
  }
  const chips = story.getByTestId('story-step-chip');
  const n = await chips.count();
  for (let i = 1; i < n; i += 1) {
    await chips.nth(i).click();
    await page.waitForTimeout(500);
    await story.screenshot({ path: base(`step-${i + 1}`), animations: 'disabled' });
  }
}

/** Khung toàn màn: cuộn qua từng mốc, mỗi mốc phải đổi chip và sân khấu vẫn nằm trong khung nhìn (bản chạy trên điện thoại cũng dùng khung này). */
async function openFullscreen(page: import('@playwright/test').Page, story: import('@playwright/test').Locator, base: (n: string) => string): Promise<void> {
  await story.getByTestId('pdp-story-open').click();
  const dialog = page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: base('full-open') });
  const sentinels = dialog.locator('.tubu-story-sentinel');
  const total = await sentinels.count();
  for (let i = 0; i < total; i += 1) {
    await sentinels.nth(i).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await expect(dialog.getByTestId('story-step-chip').nth(i)).toHaveAttribute('aria-current', 'step');
    await page.screenshot({ path: base(`full-scrub-${i + 1}`) });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}
