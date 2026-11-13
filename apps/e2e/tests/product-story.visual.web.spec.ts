import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator } from '@playwright/test';
import type { ProductStoryConfig } from '@tubutree/shared-types';
import { test, expect } from './support/mock-api';
import { seedDatabaseUrl } from './support/a11y-db';
import { writableTempDb } from './support/waste-db';
import { SAMPLES, hideFixed, routeStoryImages, visualEnabled, visualFile } from './support/story-visual';

/**
 * Ảnh chụp web 375px và 1280px của dải câu chuyện nội tuyến (Split-Card, W133) với ảnh sản phẩm thật (chỉ chạy khi có STORY_SHOT_DIR và STORY_IMG_DIR, xem support/story-visual.ts).
 * Trang chi tiết dựng ở phía máy chủ từ API thật nên dữ liệu mẫu ghi thẳng vào DB tạm của web-gate.sh (không bao giờ vào DB khác) trước lượt vào trang đầu tiên.
 * Kiểm tự động trong ca: không tràn ngang, ảnh sân khấu đã tải, số thẻ chương, chú thích HUD và chip điểm nhấn khớp cấu hình mẫu (chú thích chỉ đè lên ảnh tách nền, ảnh poster thì thành chip dưới ảnh),
 * bố cục một cột (ảnh trên chương) ở 375px và hai cột (chương trái, ảnh phải) ở 1280px, bấm thẻ chương và mục vòng cung đổi đúng mục đang chọn. Không có ảnh chụp để so: không có baseline nào trong repo, còn lại xem ảnh bằng mắt.
 * Trang sản phẩm không còn khung toàn màn nên không còn ảnh `scrub-*` (cuộn qua mốc) và `full-*` (khung toàn màn) như bản cũ.
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
      await expectStructure(story, sample.build(hit!.variationIds), vp.width >= 1024);

      mkdirSync(visualFile(), { recursive: true });
      const base = (name: string) => path.join(visualFile(), `web-${vp.tag}-${sample.key}-${name}.png`);
      await page.screenshot({ path: base('page') });
      const setSections = (display: string) => page.evaluate((d) => document.querySelectorAll<HTMLElement>('[data-section="pdp-story"]').forEach((el) => void (el.style.display = d)), display);
      await setSections('none');
      await page.waitForTimeout(200);
      await page.screenshot({ path: base('before') });
      await setSections('');
      await story.scrollIntoViewIfNeeded();

      await hideFixed(page);
      await shoot(story, base);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.getByRole('dialog', { name: 'Câu chuyện sản phẩm' })).toHaveCount(0);
    });
  }
}

/** Số thẻ chương, chú thích HUD và chip điểm nhấn phải khớp cấu hình mẫu; hướng bố cục theo bề rộng (một cột dưới 56rem, hai cột từ đó). */
async function expectStructure(story: Locator, config: ProductStoryConfig, wide: boolean): Promise<void> {
  const steps = config.scenes.flatMap((s) => (s.kind === 'ingredient_assembly' ? s.steps : []));
  const hud = config.scenes.flatMap((s) => (s.kind === 'hud_callouts' ? [s] : []))[0];
  // Mẫu không đặt imageFrame nên khung theo ảnh: có ảnh tách nền (cutoutUrl) thì chú thích đè lên ảnh, không thì poster thành chip dưới ảnh.
  const overlay = Boolean(config.cutoutUrl);
  await expect(story.getByTestId('story-step-card')).toHaveCount(steps.length);
  await expect(story.getByTestId('story-callout')).toHaveCount(overlay && hud ? hud.points.length : 0);
  await expect(story.getByTestId('story-point')).toHaveCount(!overlay && hud ? hud.points.length : 0);
  if (!overlay) await expect(story.getByTestId('story-layer')).toHaveCount(0);
  if (steps.length === 0) return;
  await expect(story.getByTestId('story-step-card').first()).toHaveAttribute('aria-current', 'step');
  const g = await story.evaluate((el) => {
    const box = (selector: string) => {
      const r = el.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return { stage: box('[data-testid="story-stage"]'), card: box('[data-testid="story-step-card"]') };
  });
  if (wide) expect(g.card.x + g.card.w, 'hai cột: thẻ chương nằm bên trái ảnh').toBeLessThanOrEqual(g.stage.x + 1);
  else expect(g.stage.y + g.stage.h, 'một cột: ảnh nằm trên thẻ chương đầu').toBeLessThanOrEqual(g.card.y + 1);
}

async function shoot(story: Locator, base: (n: string) => string): Promise<void> {
  const page = story.page();
  await story.screenshot({ path: base('1'), animations: 'disabled' });
  const arc = story.getByTestId('story-arc-item');
  if ((await arc.count()) > 1) {
    await arc.nth(1).click();
    await expect(arc.nth(1)).toHaveAttribute('aria-checked', 'true');
    await page.waitForTimeout(400);
    await story.screenshot({ path: base('arc-2'), animations: 'disabled' });
  }
  // Mọi chương hiện sẵn dưới dạng thẻ: bấm từng thẻ, thẻ phải sáng rồi mới chụp.
  const cards = story.getByTestId('story-step-card');
  const n = await cards.count();
  for (let i = 1; i < n; i += 1) {
    await cards.nth(i).click();
    await expect(cards.nth(i)).toHaveAttribute('aria-current', 'step');
    await page.waitForTimeout(500);
    await story.screenshot({ path: base(`step-${i + 1}`), animations: 'disabled' });
  }
}
