import type { Locator, Page } from '@playwright/test';
import type { MockApi } from './mock-api';
import { placedOrderFor, publicConfig } from './checkout-mocks';
import { runAxe } from './axe';

/** Trạng thái `GET /config/order-zalo` của khách có số đủ điều kiện, chưa từng chọn (ô không tick sẵn). */
export const ORDER_ZALO_STATUS = { enabled: true, prechecked: false, choice: null, phoneMasked: '090•••4567', tubuZaloPhone: '0899149229' };

/** Tài khoản có số đã xác minh, cờ người nhận bật (PO A1): địa chỉ có số khác số này thì có công tắc người nhận. */
export const ORDER_ZALO_RECIPIENT_STATUS = { ...ORDER_ZALO_STATUS, buyerPhone: '0901234567', phoneSource: 'account_verified', recipientEnabled: true };

/**
 * Bật/tắt cờ hành trình đơn qua Zalo ở cấu hình công khai và phản chiếu `orderZaloConsent` của body vào đơn trả về
 * (máy chủ ghi cột này trong giao dịch đặt hàng). Gọi SAU mockWorld: đăng ký sau thắng.
 */
export function mockOrderZalo(api: MockApi, on: boolean, status: Record<string, unknown> = ORDER_ZALO_STATUS): void {
  api.get('/config/public', publicConfig({ orderZaloEnabled: on, tubuZaloPhone: '0899149229' }));
  api.get('/config/order-zalo', status);
  api.post('/checkout/place-order', ({ call }) => {
    const body = (call.body ?? {}) as Record<string, unknown>;
    return { ...placedOrderFor(body), orderZaloConsent: on && body.orderZaloConsent === true };
  });
}

/** Vi phạm axe serious/critical có phần tử nằm trong `scope` (luật cấp trang như landmark của màn cũ không tính vào gói này). */
export async function axeInside(page: Page, scope: Locator): Promise<string[]> {
  const found = await runAxe(page);
  const root = await scope.elementHandle();
  const lines: string[] = [];
  for (const v of found) {
    if (v.impact !== 'serious' && v.impact !== 'critical') continue;
    for (const n of v.nodes) {
      const inside = await page.evaluate(([el, sel]) => {
        const hit = document.querySelector(sel as string);
        return !!hit && (el as Element).contains(hit);
      }, [root, n.target[0]] as const);
      if (inside) lines.push(`${v.id} [${v.impact}] ${n.target.join(' ')}`);
    }
  }
  return lines;
}

/** Ảnh trước/sau cho báo cáo gói, chỉ khi có ORDER_ZALO_SHOT_DIR (không dùng VISUAL_DIR: biến đó bật cả visual-tour). */
export async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.ORDER_ZALO_SHOT_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}
