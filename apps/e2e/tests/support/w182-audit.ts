import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import { tourEntries, type TourEntry } from './tour';
import type { W182Findings } from './w182-probe';

/**
 * W182: danh sách màn và khổ cho nghiệm thu cuối. Một nguồn cho hai chế độ:
 * - kiểm toán (`W182_SHOTS` = thư mục): mọi màn khách × mọi khổ, ghi nhật ký JSONL + ảnh, KHÔNG làm đỏ;
 * - guard (không có biến): các màn chính × hai khổ hẹp, khẳng định không tràn ngang và vùng chạm đủ 44px.
 */
export const SHOTS = process.env.W182_SHOTS;
export const PHASE = process.env.W182_PHASE ?? 'before';

/** Màn quản trị/nhân sự/đối tác nặng và bí danh chuyển hướng: không phải màn mua sắm của khách. */
const SKIPPED = new Set(['/admin', '/admin/community', '/staff', '/my-payroll', '/brand-owner', '/recycle/desk', '/feed/leaderboard', '/refill']);

/** Màn chính của hành trình mua: guard chạy trên các màn này. */
const MAIN = new Set([
  '/',
  '/browse',
  '/product/:slug',
  '/cart',
  '/checkout',
  '/orders',
  '/order/:code',
  '/profile',
  '/offers',
  '/vouchers',
  '/rewards',
  '/recycle',
  '/game',
  '/loyalty',
  '/wallet',
]);

export interface ScreenSize {
  width: number;
  height: number;
}

export const MINI_SIZES_AUDIT: ScreenSize[] = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
];
export const MINI_SIZES_GUARD: ScreenSize[] = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
];

export const WEB_SIZES_AUDIT: ScreenSize[] = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];
export const WEB_SIZES_GUARD: ScreenSize[] = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
];

export function auditEntries(): TourEntry[] {
  return tourEntries().filter((e) => !SKIPPED.has(e.key) && (SHOTS ? true : MAIN.has(e.key)));
}

export function slugOf(key: string): string {
  return key.replace(/^\/+|\/+$/g, '').replace(/\//g, '__').replace(/[^\w.\-@%]+/g, '_') || 'index';
}

/** Màn có đo CLS (Trang chủ, PDP). */
export function measuresCls(key: string): boolean {
  return key === '/' || key === '/product/:slug';
}

export function shotPath(app: 'miniapp' | 'web', key: string, size: ScreenSize, tag: string): string {
  const dir = path.join(SHOTS!, PHASE, app);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${slugOf(key)}__${size.width}${tag}.jpg`);
}

export function record(app: 'miniapp' | 'web', entry: TourEntry, size: ScreenSize, p: W182Findings, cls?: { cls: number; sources: string[] }): void {
  if (!SHOTS) return;
  const dir = path.join(SHOTS, PHASE);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, `${app}.jsonl`), `${JSON.stringify({ app, key: entry.key, name: entry.name, width: size.width, height: size.height, cls: cls?.cls, clsSources: cls?.sources, ...p })}\n`);
}

/** Ghi nhận lỗi tải trang (không dựng được màn) để bảng kiểm toán không bỏ sót màn hỏng hẳn. */
export function recordFailure(app: 'miniapp' | 'web', entry: TourEntry, size: ScreenSize, error: string): void {
  if (!SHOTS) return;
  const dir = path.join(SHOTS, PHASE);
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, `${app}-failures.jsonl`), `${JSON.stringify({ app, key: entry.key, width: size.width, error })}\n`);
}

export async function shootJpeg(page: Page, file: string, fullPage: boolean, maxHeight = 2600): Promise<void> {
  if (!fullPage) {
    await page.screenshot({ path: file, type: 'jpeg', quality: 70, scale: 'css' });
    return;
  }
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
  await page.screenshot({ path: file, type: 'jpeg', quality: 70, scale: 'css', fullPage: true, clip: { x: 0, y: 0, width, height: Math.min(Math.max(height, 400), maxHeight) } });
}
