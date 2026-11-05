import { expect, type Page } from '@playwright/test';
import { STATES, type OrderState } from './order-detail-states';

/** Trạng thái dựng sẵn theo khoá (support/order-detail-states.ts). */
export function stateOf(key: string): OrderState {
  const s = STATES.find((x) => x.key === key);
  if (!s) throw new Error(`Không có trạng thái đơn "${key}"`);
  return s;
}

const shown = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).locator('visible=true');

/** Đơn đang giao: hero một câu, hành trình có bước hiện tại và mốc hãng mới nhất trên cùng, thẻ vận chuyển có mã + nút chép, một nút chính "Liên hệ", không có nút bị cấm. */
export async function expectShippingTracking(page: Page): Promise<void> {
  const hero = page.getByTestId('status-hero');
  await expect(hero).toContainText('Đơn đang trên đường giao đến bạn.');

  const track = page.getByRole('list', { name: 'Hành trình đơn hàng' });
  await expect(track).toBeVisible();
  const current = track.locator('[aria-current="step"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('Đang giao');

  const events = track.getByRole('list', { name: 'Mốc vận chuyển' }).first();
  const rows = events.getByRole('listitem');
  expect(await rows.count()).toBeGreaterThanOrEqual(3);
  await expect(rows.first()).toHaveAttribute('data-latest', 'true');
  await expect(rows.last()).not.toHaveAttribute('data-latest', 'true');

  const shipping = page.getByTestId('order-shipping');
  await expect(shipping).toContainText('Giao Hàng Nhanh');
  await expect(shipping).toContainText('GHN6789012345');
  await expect(shipping.getByRole('button', { name: 'Chép mã' })).toBeVisible();

  await expect(shown(page, 'Liên hệ Tubu')).toHaveCount(1);
  for (const forbidden of ['Huỷ đơn', 'Thanh toán ngay', 'Mua lại đơn này']) {
    await expect(page.getByRole('button', { name: forbidden })).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

/** Đơn chờ thanh toán: hạn trả và thời gian còn lại ở hero, nút chính "Thanh toán ngay", "Huỷ đơn" chỉ nằm trong menu. */
export async function expectPendingPayment(page: Page): Promise<void> {
  const hero = page.getByTestId('status-hero');
  await expect(hero).toContainText('Đơn đang chờ bạn thanh toán.');
  await expect(page.getByTestId('order-milestone')).toContainText(/Thanh toán trước \d{2}:\d{2} \d{2}\/\d{2}, còn 2 giờ \d+ phút/);

  await expect(shown(page, 'Thanh toán ngay')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Huỷ đơn' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Thêm thao tác' }).locator('visible=true').click();
  const menu = page.getByRole('group', { name: 'Thao tác với đơn' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Huỷ đơn');
  await expect(menu).not.toContainText('Thanh toán ngay');
}
