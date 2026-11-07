import { expect, type Page } from '@playwright/test';
import type { MockApi } from './mock-api';

/**
 * Làm dữ liệu SSR hết tươi rồi kích tải lại khi có mạng trở lại; lặp tới khi mock nhận được lời gọi (cùng cách với `refetchStale` của shop.web.spec.ts).
 * Phần server của Next gọi API thật nên danh sách đầu trong HTML là của DB e2e; muốn spec dùng dữ liệu của mock thì phải ép trình duyệt hỏi lại.
 */
export async function refetchStale(page: Page, api: MockApi, method: string, pattern: string, minCalls = 1): Promise<void> {
  // Chờ React hydrate tới phần tử cuối của <main>: truy vấn dựng sau lần đẩy đồng hồ lấy giờ đã đẩy làm mốc cho dữ liệu SSR nên vẫn tươi.
  await page.waitForFunction(
    () => {
      const all = document.querySelectorAll('main *');
      const last = all[all.length - 1];
      return !!last && Object.keys(last).some((k) => k.startsWith('__reactFiber$'));
    },
    undefined,
    { timeout: 15_000 },
  );
  // Mỗi lần gọi đẩy đồng hồ thêm 10 phút: dữ liệu vừa dựng sau lần đẩy trước cũng hết tươi.
  await page.evaluate(() => {
    const w = window as unknown as { __tubuClockOffset?: number };
    if (w.__tubuClockOffset === undefined) {
      w.__tubuClockOffset = 0;
      const real = Date.now.bind(Date);
      Date.now = () => real() + (w.__tubuClockOffset ?? 0);
    }
    w.__tubuClockOffset += 10 * 60_000;
  });
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          window.dispatchEvent(new Event('offline'));
          window.dispatchEvent(new Event('online'));
        });
        return api.callsTo(method, pattern).length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(minCalls);
}
