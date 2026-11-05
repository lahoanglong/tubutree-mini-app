import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { ProductStoryConfig } from '@tubutree/shared-types';

/**
 * Dữ liệu mẫu cho bộ ảnh chụp câu chuyện sản phẩm (product-story.visual.*.spec.ts): hai sản phẩm thật của Tubu Tree, ảnh lấy từ catalog công khai.
 * Ảnh không nằm trong repo: STORY_SHOT_DIR là thư mục ghi ảnh chụp (không dùng VISUAL_DIR: biến đó kéo cả visual-tour vào lượt chạy); STORY_IMG_DIR trỏ tới thư mục chứa sokfarm-pack.png, sokfarm-cutout.webp, polang-bottle.png; ảnh trả cho trình duyệt qua page.route.
 * Chữ trên màn chỉ lấy từ chữ in trên bao bì trong ảnh, cấu hình chỉ để kiểm hình: nội dung thật do chủ và đối tác duyệt.
 */
export const STORY_IMG_HOST = 'https://assets.story.test';

export const visualEnabled = (): boolean => Boolean(process.env.STORY_SHOT_DIR && process.env.STORY_IMG_DIR);

export interface SampleVariation {
  name: string;
  price: number;
}

export interface StorySample {
  key: string;
  name: string;
  brand: string;
  images: string[];
  variations: SampleVariation[];
  ingredients: { name: string; benefit: string }[];
  /** Cảnh sẽ được dựng với id biến thể thật của sản phẩm (vòng cung cần variationId khớp). */
  build: (variationIds: string[]) => ProductStoryConfig;
}

const img = (file: string): string => `${STORY_IMG_HOST}/${file}`;

export const SAMPLE_ARC_HUD: StorySample = {
  key: 'arc-hud',
  name: 'Đường hoa dừa hữu cơ SOKFARM',
  brand: 'Sokfarm',
  images: [img('sokfarm-pack.png')],
  variations: [
    { name: '300g', price: 125_000 },
    { name: '1kg', price: 360_000 },
    { name: '5kg', price: 1_500_000 },
  ],
  ingredients: [{ name: 'Mật hoa dừa', benefit: 'Hữu cơ, không qua tinh luyện' }],
  build: (ids) => ({
    version: 1,
    enabled: true,
    cutoutUrl: img('sokfarm-cutout.webp'),
    scenes: [
      {
        kind: 'variant_arc',
        items: [
          { variationId: ids[0], label: '300g', ambient: 'amber' },
          { variationId: ids[1], label: '1kg', ambient: 'leaf' },
          { variationId: ids[2], label: '5kg', ambient: 'sand' },
        ],
      },
      {
        kind: 'hud_callouts',
        points: [
          { id: 'h1', xPct: 26, yPct: 30, label: '100% nguyên chất', side: 'left' },
          { id: 'h2', xPct: 74, yPct: 46, label: 'Thơm hương dừa', side: 'right' },
          { id: 'h3', xPct: 26, yPct: 66, label: 'Chế biến nhiệt độ thấp', side: 'left' },
          { id: 'h4', xPct: 74, yPct: 80, label: 'Không qua tinh luyện', side: 'right' },
        ],
        closing: 'Vị ngọt tự nhiên từ hoa dừa',
      },
    ],
  }),
};

export const SAMPLE_ASSEMBLY: StorySample = {
  key: 'assembly',
  name: 'Dầu gội thảo dược PƠ LANG 300g',
  brand: 'Pơ Lang',
  images: [img('polang-bottle.png')],
  variations: [
    { name: 'Bạc hà', price: 180_000 },
    { name: 'Gừng bưởi', price: 180_000 },
  ],
  ingredients: [{ name: 'Cơm quả bơ tươi', benefit: 'Phục hồi cho tóc hư tổn' }],
  build: () => ({
    version: 1,
    enabled: true,
    scenes: [
      {
        kind: 'ingredient_assembly',
        steps: [
          { title: 'Tinh tuyển nguyên liệu', body: 'Chiết xuất từ cơm quả bơ tươi nguyên chất.', layers: [{ id: 'a1', spriteId: 'oil-drop', label: 'Chiết xuất bơ', from: 'top', xPct: 28, yPct: 24, scale: 1.1, rotateDeg: -15 }] },
          { title: 'Giàu vitamin', body: 'Hàm lượng vitamin E, C, B3, B5 vượt trội.', layers: [{ id: 'a2', spriteId: 'water-droplet', label: 'Vitamin', from: 'right', xPct: 74, yPct: 30, scale: 1, rotateDeg: 10 }] },
          { title: 'Phục hồi chuyên sâu', body: 'Dành cho tóc hư tổn.', layers: [{ id: 'a3', spriteId: 'shea-butter', label: 'Dưỡng sâu', from: 'left', xPct: 22, yPct: 58, scale: 1, rotateDeg: 20 }] },
        ],
      },
    ],
  }),
};

export const SAMPLES: StorySample[] = [SAMPLE_ARC_HUD, SAMPLE_ASSEMBLY];

/** Trả ảnh mẫu từ STORY_IMG_DIR cho mọi lời gọi tới STORY_IMG_HOST (mock-api huỷ request ra host ngoài; route đăng ký sau thắng nên khai ở đây là đủ). */
export async function routeStoryImages(page: Page): Promise<void> {
  const dir = process.env.STORY_IMG_DIR ?? '';
  await page.route(`${STORY_IMG_HOST}/**`, async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    try {
      const body = readFileSync(path.join(dir, file));
      await route.fulfill({ status: 200, body, contentType: file.endsWith('.webp') ? 'image/webp' : 'image/png', headers: { 'access-control-allow-origin': '*' } });
    } catch {
      await route.abort();
    }
  });
}

export const visualFile = (...parts: string[]): string => path.join(process.env.STORY_SHOT_DIR ?? '.', ...parts);

/** Ẩn thanh cố định (đầu trang, thanh mua) để ảnh chụp phần tử cao không bị che; chỉ dùng ngay trước khi chụp. */
export async function hideFixed(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const pos = getComputedStyle(el).position;
      if ((pos === 'fixed' || pos === 'sticky') && !el.closest('[data-testid="product-story"], [data-section="pdp-story"]') && !el.querySelector('[data-testid="product-story"], [data-section="pdp-story"]')) el.style.visibility = 'hidden';
    });
  });
}
