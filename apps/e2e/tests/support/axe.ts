import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { AXE_BASELINE, type AxeBaselineEntry } from './a11y-baseline';

/** WCAG AA: A + AA của 2.0, 2.1, 2.2. Chỉ `serious` và `critical` chặn merge; `minor`/`moderate` vẫn đo nhưng không đỏ. */
export const AXE_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['serious', 'critical']);

export interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  nodes: { target: string[] }[];
}

declare global {
  interface Window {
    axe: { run(context: Document, options: object): Promise<{ violations: AxeViolation[] }> };
  }
}

let axeSource: string | undefined;

/**
 * Nạp axe-core của `@tubutree/e2e` vào trang rồi chạy với `AXE_TAGS`. Gọi sau khi màn đã dựng xong phần cần kiểm.
 * Tắt transition/animation và đợi các animation đang chạy xong trước khi đo: color-contrast đọc màu tính lúc đó, nút đang mờ dần (khoá → mở) cho tỉ lệ sai.
 * Lớp tắt chuyển động ở lại trên trang, nên runAxe phải là bước cuối: kiểm hành vi animation/transition sau đó sẽ sai.
 */
export async function runAxe(page: Page): Promise<AxeViolation[]> {
  axeSource ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
  // Animation tạo bằng JS lặp vô hạn thì `finished` không bao giờ xong: chờ tối đa 2 giây.
  await page.evaluate(() =>
    Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, 2_000))]),
  );
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (tags) => {
    const result = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => ({ target: n.target as string[] })) }));
  }, [...AXE_TAGS]);
}

/** Dòng lỗi cho mỗi luật `serious`/`critical` chưa có trong baseline của màn (và nền tảng) đó. Dòng baseline thiếu lý do là lỗi cấu hình, ném ngay. */
export function blockingViolations(side: AxeBaselineEntry['side'], screen: string, found: AxeViolation[], baseline: readonly AxeBaselineEntry[] = AXE_BASELINE): string[] {
  for (const e of baseline) if (e.reason.trim().length < 10) throw new Error(`a11y-baseline: ${e.side}/${e.screen}/${e.rule} thiếu lý do`);
  const known = new Set(baseline.filter((e) => e.side === side && e.screen === screen).map((e) => e.rule));
  return found
    .filter((v) => v.impact !== null && BLOCKING.has(v.impact) && !known.has(v.id))
    .map((v) => `${screen}: ${v.id} [${v.impact}] ${v.nodes.length} nút, vd ${v.nodes[0]?.target.join(' ') ?? '?'}`);
}

/** Dòng baseline của màn mà lần quét này không còn thấy nữa (đã sửa): nhắc xoá để baseline không giữ chỗ cho vi phạm cũ. */
export function staleBaseline(side: AxeBaselineEntry['side'], screen: string, found: AxeViolation[], baseline: readonly AxeBaselineEntry[] = AXE_BASELINE): string[] {
  const seen = new Set(found.map((v) => v.id));
  return baseline.filter((e) => e.side === side && e.screen === screen && !seen.has(e.rule)).map((e) => `${screen}: ${e.rule} không còn vi phạm, xoá khỏi AXE_BASELINE`);
}
