import { appendFileSync, closeSync, mkdirSync, openSync } from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';

export type VisualApp = 'miniapp' | 'web';

const VIEWPORT = { width: 390, height: 844 };
const FONT_HOSTS = new Set(['h5.zadn.vn', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const fontCache = new Map<string, { status: number; headers: Record<string, string>; body: Buffer }>();

/**
 * Chế độ chụp: khổ 390x844, tắt animation/transition (zmp-ui chuyển trang bằng animation nên ảnh dễ rơi giữa hai trang),
 * và cho phép tải font thật. Font icon của zmp-ui nằm ở h5.zadn.vn, mock-api.ts chặn mọi host ngoài nên icon hiện thành chữ thô `zi_*`.
 */
export async function installVisualMode(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    const css = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
    const add = () => {
      const el = document.createElement('style');
      el.textContent = css;
      (document.head ?? document.documentElement).appendChild(el);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add, { once: true });
  });
  await page.route(
    (url) => FONT_HOSTS.has(url.hostname),
    async (route) => {
      const url = route.request().url();
      try {
        let hit = fontCache.get(url);
        if (!hit) {
          const res = await route.fetch({ timeout: 8000 });
          hit = { status: res.status(), headers: res.headers(), body: await res.body() };
          if (hit.status === 200) fontCache.set(url, hit);
        }
        await route.fulfill(hit);
      } catch {
        await route.abort('blockedbyclient').catch(() => {});
      }
    },
  );
}

/** Chờ trang ổn định: tải xong, font xong, chỉ còn một trang zmp, không toast/sheet/skeleton. Có trần chờ nên không bao giờ treo. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const q = (sel: string) => document.querySelectorAll(sel).length;
        const pages = q('.zaui-page');
        const transient = q('.zaui-toast, .zaui-sheet, .zaui-sheet-backdrop, [class*="skeleton" i], [class*="shimmer" i], [aria-busy="true"]');
        return pages <= 1 && transient === 0;
      },
      undefined,
      { timeout: 3000 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
}

async function shoot(page: Page, file: string, fullFile: string): Promise<void> {
  await page.screenshot({ path: file, type: 'jpeg', quality: 70, scale: 'css' });
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
  await page.screenshot({
    path: fullFile,
    type: 'jpeg',
    quality: 70,
    scale: 'css',
    fullPage: true,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.min(Math.max(height, VIEWPORT.height), 3000) },
  });
}

function slug(s: string): string {
  return s.replace(/^\/+|\/+$/g, '').replace(/\//g, '__').replace(/[^\w.\-@%]+/g, '_') || 'index';
}

/** Chụp theo khoá cặp (route Mini App trong route-map). Mỗi khoá một ảnh; chụp lại thì ghi đè. Lỗi bị nuốt. */
export async function captureVisual(page: Page, app: VisualApp, key: string, name?: string): Promise<void> {
  const dir = process.env.VISUAL_DIR;
  if (!dir) return;
  try {
    const outDir = path.join(dir, app, 'tour');
    mkdirSync(outDir, { recursive: true });
    await settle(page);
    const rawIcons = await page.evaluate(() => /\bzi_[a-z_]+/.test(document.body?.innerText ?? '')).catch(() => false);
    const base = slug(key);
    await shoot(page, path.join(outDir, `${base}.jpg`), path.join(outDir, `${base}.full.jpg`));
    appendFileSync(path.join(dir, app, 'tour.jsonl'), JSON.stringify({ key, name, rawIcons, file: `tour/${base}.jpg`, url: page.url() }) + '\n');
  } catch {
    // ảnh hỏng không được làm đỏ test
  }
}

function pathnameName(url: string): { pathname: string; name: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  let name = slug(u.pathname);
  const tab = u.searchParams.get('tab');
  if (tab) name += `--tab-${tab}`;
  return { pathname: u.pathname + (tab ? `?tab=${tab}` : ''), name };
}

/** Chụp theo pathname (mỗi pathname giữ ảnh đầu tiên) cho các spec thường. Lỗi bị nuốt. */
export async function captureByPathname(page: Page, dir: string, app: VisualApp, url: string, title: string): Promise<void> {
  try {
    const parsed = pathnameName(url);
    if (!parsed) return;
    const outDir = path.join(dir, app);
    mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${parsed.name}.jpg`);
    // 'wx' đặt chỗ nguyên tử: nhiều worker song song cùng pathname thì chỉ một bên được chụp.
    try {
      closeSync(openSync(file, 'wx'));
    } catch {
      return;
    }
    await settle(page);
    await shoot(page, file, path.join(outDir, `${parsed.name}.full.jpg`));
    appendFileSync(path.join(outDir, 'index.jsonl'), JSON.stringify({ pathname: parsed.pathname, file: `${parsed.name}.jpg`, test: title }) + '\n');
  } catch {
    // ảnh hỏng không được làm đỏ test
  }
}

export function recordTourUnmocked(title: string, calls: string[]): void {
  const dir = process.env.VISUAL_DIR;
  if (!dir || calls.length === 0) return;
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'tour-unmocked.jsonl'), JSON.stringify({ title, calls: [...new Set(calls)] }) + '\n');
  } catch {
    // chỉ là nhật ký
  }
}
