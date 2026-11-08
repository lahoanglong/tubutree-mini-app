import { test, expect } from './support/mock-api';
import { probeLayout } from './support/layout-probe';
import { probeTapTargets } from './support/touch-probe';
import { mockWebAddressBook, webSignIn } from './support/touch-p4-web-mocks';

/**
 * W42B, web khách: chọn Tỉnh/Thành phố và Phường/Xã trong sheet tìm không dấu thay cho ô chọn gốc (AddressLocationSheet).
 * Pancake chỉ có hai cấp nên không có bước Quận/Huyện. Chạy ở 320 / 360 / 375 / 393px (project "Web Customer Mobile"): vùng chạm thật ≥ 44px,
 * không tràn ngang, mở 220ms theo đường cong drawer và tắt khi khách chọn giảm chuyển động. Mọi lời gọi API đi qua mock.
 */
const WIDTHS = [320, 360, 375, 393] as const;

for (const width of WIDTHS) {
  test.describe(`Web ${width}px: sheet chọn địa giới`, () => {
    test.beforeEach(async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.setViewportSize({ width, height: 720 });
    });

    test('tìm không dấu, chọn tỉnh tự sang Phường/Xã, chọn xong ô hiện tên; vùng chạm và bố cục sạch', async ({ page, api }) => {
      await webSignIn(page, api);
      mockWebAddressBook(api);
      await page.goto('/tai-khoan/dia-chi');
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      await expect(page.getByRole('heading', { name: 'Sửa địa chỉ' })).toBeVisible({ timeout: 30_000 });

      await page.getByLabel('Tỉnh/Thành phố').click();
      const sheet = page.getByRole('dialog', { name: 'Tỉnh/Thành phố' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('option')).toHaveCount(3);
      await expect(sheet.getByRole('option', { name: 'Thành phố Hồ Chí Minh' })).toHaveAttribute('aria-selected', 'true');

      // Đo sau khi sheet trượt lên xong: đang trượt thì khung bị dịch và vùng chạm đo hụt một điểm ảnh.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
      expect.soft(await probeTapTargets(page, { scope: '[role="dialog"]' }), `${width}px: vùng chạm sheet dưới 44px`).toEqual([]);
      const layout = await probeLayout(page, { scope: '[role="dialog"]' });
      expect.soft(layout.overflow, `${width}px: sheet tràn ngang`).toEqual([]);
      const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(docOverflow, `${width}px: trang cuộn ngang khi sheet mở`).toBeLessThanOrEqual(0);

      const search = sheet.getByRole('searchbox', { name: 'Tìm tỉnh/thành phố' });
      await search.fill('ho chi minh');
      await expect(sheet.getByRole('option')).toHaveCount(1);
      await expect(sheet.getByRole('option').first()).toHaveText(/Thành phố Hồ Chí Minh/);
      await search.fill('zzzz');
      await expect(sheet.getByText('Không tìm thấy kết quả phù hợp')).toBeVisible();
      await search.fill('da nang');
      await sheet.getByRole('option', { name: 'Đà Nẵng' }).click();

      const wardSheet = page.getByRole('dialog', { name: 'Phường/Xã' });
      await expect(wardSheet).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await wardSheet.getByRole('searchbox', { name: 'Tìm phường/xã' }).fill('ben thanh');
      await expect(wardSheet.getByRole('option')).toHaveCount(1);
      await wardSheet.getByRole('option', { name: 'Phường Bến Thành' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByLabel('Tỉnh/Thành phố')).toContainText('Đà Nẵng');
      await expect(page.getByLabel('Phường/Xã')).toContainText('Phường Bến Thành');
    });

    test('mở bằng đường cong drawer 220ms; giảm chuyển động thì hiện ngay', async ({ page, api }) => {
      await webSignIn(page, api);
      mockWebAddressBook(api);
      await page.goto('/tai-khoan/dia-chi');
      await page.getByRole('button', { name: 'Sửa' }).first().click();
      await expect(page.getByRole('heading', { name: 'Sửa địa chỉ' })).toBeVisible({ timeout: 30_000 });
      const animation = () =>
        page.evaluate(() => {
          const s = getComputedStyle(document.querySelector('.mini-sheet-panel')!);
          return { name: s.animationName, duration: s.animationDuration };
        });

      await page.getByLabel('Tỉnh/Thành phố').click();
      await expect(page.getByRole('dialog', { name: 'Tỉnh/Thành phố' })).toBeVisible();
      expect(await animation()).toEqual({ name: 'slideUp', duration: '0.22s' });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByLabel('Tỉnh/Thành phố').click();
      await expect(page.getByRole('dialog', { name: 'Tỉnh/Thành phố' })).toBeVisible();
      expect((await animation()).name).toBe('none');
    });
  });
}
