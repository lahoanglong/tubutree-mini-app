import type { Page, Response } from '@playwright/test';

/** Dấu mà web đặt trên body khi React đã gắn xong (apps/web/src/app/providers.tsx). */
const HYDRATED = 'body[data-hydrated="true"]';

type GotoOptions = Parameters<Page['goto']>[1];

/**
 * Sau mỗi `page.goto` chờ web hydrate xong rồi mới trả về, để bấm/gõ đầu tiên không bị nuốt.
 * Bỏ qua khi `waitUntil: 'commit'` (ca cố ý soi HTML trước hydrate) và khi phản hồi không phải HTML.
 * Trang không có dấu (lỗi dựng, khung riêng) chỉ tốn tối đa 10 giây rồi chạy tiếp: ca đó tự đỏ ở bước kiểm của nó.
 */
export function waitForHydrationAfterGoto(page: Page): void {
  const goto = page.goto.bind(page);
  page.goto = (async (url: string, options?: GotoOptions): Promise<Response | null> => {
    const response = await goto(url, options);
    if (options?.waitUntil === 'commit') return response;
    if (response && !(response.headers()['content-type'] ?? '').includes('text/html')) return response;
    await page.waitForSelector(HYDRATED, { state: 'attached', timeout: 10_000 }).catch(() => undefined);
    return response;
  }) as Page['goto'];
}
