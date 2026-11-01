import { test, expect } from './support/mock-api';
import { mockDiscovery, mockHomeEngagement } from './support/discovery-mocks';
import { mockCollectable, mockCouponHistory, mockWallet } from './support/voucher-mocks';

/**
 * Zalo Mini App E2E — thứ tự Tab. Nút Quay lại toàn cục là `position: fixed` ở góc trên trái nên không đổi hình dù đặt ở đâu trong cây, nhưng thứ tự Tab và
 * trình đọc màn hình theo DOM: nó phải là điểm dừng đầu tiên của trang con, trước cả nội dung chính. API mock toàn bộ.
 *
 * Đọc thứ tự điều hướng bằng bàn phím từ DOM (phần tử tab được, cùng luật hiện của trình duyệt) thay vì nhấn Tab thật: project Mini chạy giả lập điện thoại,
 * nơi Chromium không chuyển focus bằng phím Tab (đo trên trang chỉ có ba nút: Tab không đổi `activeElement`).
 */
test.use({ viewport: { width: 375, height: 812 } });

test('trang con: điểm dừng Tab đầu tiên là nút Quay lại, nút nằm trước <main> trong DOM', async ({ page, api }) => {
  mockDiscovery(api, { returning: true });
  mockHomeEngagement(api);
  mockCollectable(api);
  mockWallet(api);
  mockCouponHistory(api);
  await page.goto('/vouchers');
  await expect(page.getByRole('button', { name: 'Quay lại' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Nhận mã' }).getByRole('group').first()).toBeVisible({ timeout: 15_000 });

  const order = await page.evaluate(() => {
    const tabbable = Array.from(document.body.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')).filter(
      (el) => !el.hasAttribute('disabled') && el.tabIndex >= 0 && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert], [aria-hidden="true"]'),
    );
    const label = (el: HTMLElement) => el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30);
    const main = document.querySelector('main#main-content');
    const back = document.querySelector('button[aria-label="Quay lại"]');
    return {
      first: tabbable[0] ? label(tabbable[0]) : null,
      backBeforeMain: !!back && !!main && !!(back.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(order.first).toBe('Quay lại');
  expect(order.backBeforeMain).toBe(true);
});
