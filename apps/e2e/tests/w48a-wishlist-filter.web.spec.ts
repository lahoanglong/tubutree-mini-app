import type { Page } from '@playwright/test';
import { expect, makeUser, mockSession, test } from './support/mock-api';
import { expectChipHitArea44 } from './support/hit-area';
import { CARDS, NAME, flashForB, mockWishlistData } from './support/w48a-wishlist';

/**
 * W48A, web khách ở 320/375/393px và 1440×900: dải lọc nhanh Tất cả / Đang giảm / Còn hàng ở /tai-khoan/yeu-thich (bản web của trang Yêu thích Mini App). "Đang giảm"
 * tính cả món chỉ giảm nhờ Giờ vàng (cùng kho Giờ vàng và đồng hồ với thẻ), lọc rỗng có nút "Xem tất cả sản phẩm đã lưu" trả focus về chip Tất cả. Trang client nên
 * mọi dữ liệu đi qua mock, không cần seed. Khổ do spec tự đặt, chỉ chạy ở project Web Customer Mobile. Không đặt đơn thật.
 */
const SIZES = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 393, height: 852 },
  { width: 1440, height: 900 },
] as const;

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const chipRow = (page: Page) => page.getByRole('region', { name: 'Lọc sản phẩm yêu thích' });
const chip = (page: Page, label: string) => chipRow(page).getByRole('button', { name: new RegExp(`^${label}`) });
const tiles = (page: Page) => page.getByTestId('catalog-grid').getByRole('listitem');
const chipText = (label: string, count: number) => new RegExp(`^${label}\\s*\\(${count}\\)$`);

for (const size of SIZES) {
  test.describe(`Web khách ${size.width}×${size.height}: Yêu thích — bộ lọc`, () => {
    test.beforeEach(async ({ page, api }, testInfo) => {
      test.skip(testInfo.project.name !== 'Web Customer Mobile', 'Khổ do spec tự đặt: một project là đủ');
      await page.setViewportSize(size);
      await page.addInitScript(() => {
        try {
          localStorage.setItem('tubu_web_session', '1');
        } catch {
          // không có localStorage: spec vẫn chạy, chỉ không có phiên khôi phục
        }
      });
      mockSession(api, makeUser({ id: 'u1', fullName: 'Nguyễn Văn An' }));
    });

    test('ba chip kèm số đếm (tính cả Giờ vàng), vùng chạm mỗi chip từ 44px, nằm trên lưới, không tràn ngang', async ({ page, api }) => {
      mockWishlistData(api, { flash: flashForB(3_600_000) });
      await page.goto('/tai-khoan/yeu-thich');
      await expect(tiles(page)).toHaveCount(4, { timeout: 20_000 });

      await expect(chip(page, 'Tất cả')).toHaveText(chipText('Tất cả', 4));
      await expect(chip(page, 'Đang giảm')).toHaveText(chipText('Đang giảm', 3), { timeout: 10_000 });
      await expect(chip(page, 'Còn hàng')).toHaveText(chipText('Còn hàng', 3));
      await expect(chip(page, 'Tất cả')).toHaveAttribute('aria-pressed', 'true');

      const row = (await chipRow(page).boundingBox())!;
      const grid = (await page.getByTestId('catalog-grid').boundingBox())!;
      expect(row.y + row.height, 'dải lọc phải nằm trên lưới').toBeLessThanOrEqual(grid.y + 1);
      expect(row.x).toBeGreaterThanOrEqual(0);
      expect(row.x + row.width).toBeLessThanOrEqual(size.width);
      expect(await noHorizontalScroll(page)).toBe(true);
      // Chip nhìn cao 36px, vùng chạm 44px do `.tubu-hit-44::after`: đo bằng elementFromPoint, và rộng tối thiểu 44px.
      for (const label of ['Tất cả', 'Đang giảm', 'Còn hàng']) {
        await expectChipHitArea44(chip(page, label));
        expect((await chip(page, label).boundingBox())!.width, `chiều rộng chip ${label}`).toBeGreaterThanOrEqual(44);
      }
    });

    test('Đang giảm giữ món giảm giá thường và món chỉ giảm nhờ Giờ vàng; Còn hàng bỏ món hết hàng; Tất cả trả đủ', async ({ page, api }) => {
      mockWishlistData(api, { flash: flashForB(3_600_000) });
      await page.goto('/tai-khoan/yeu-thich');
      await expect(tiles(page)).toHaveCount(4, { timeout: 20_000 });
      await expect(chip(page, 'Đang giảm')).toHaveText(chipText('Đang giảm', 3), { timeout: 10_000 });

      await chip(page, 'Đang giảm').click();
      await expect(tiles(page)).toHaveCount(3);
      await expect(tiles(page).filter({ hasText: NAME.b })).toHaveCount(1);
      await expect(tiles(page).filter({ hasText: NAME.c })).toHaveCount(0);
      await expect(chip(page, 'Đang giảm')).toHaveAttribute('aria-pressed', 'true');
      await expect(chip(page, 'Tất cả')).toHaveText(chipText('Tất cả', 4));

      await chip(page, 'Còn hàng').click();
      await expect(tiles(page)).toHaveCount(3);
      await expect(tiles(page).filter({ hasText: NAME.d })).toHaveCount(0);

      await chip(page, 'Tất cả').click();
      await expect(tiles(page)).toHaveCount(4);
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('lọc ra rỗng: câu báo theo bộ lọc, nút "Xem tất cả sản phẩm đã lưu" cao từ 44px, về Tất cả và trả focus về chip Tất cả', async ({ page, api }) => {
      mockWishlistData(api, { cards: [CARDS[2]!] });
      await page.goto('/tai-khoan/yeu-thich');
      await expect(tiles(page)).toHaveCount(1, { timeout: 20_000 });

      await chip(page, 'Đang giảm').click();
      await expect(page.getByText('Chưa có sản phẩm đang giảm giá trong danh sách yêu thích')).toBeVisible();
      await expect(tiles(page)).toHaveCount(0);
      await expect(chip(page, 'Đang giảm')).toHaveText(chipText('Đang giảm', 0));
      expect(await noHorizontalScroll(page)).toBe(true);

      const cta = page.getByRole('button', { name: 'Xem tất cả sản phẩm đã lưu' });
      const b = (await cta.boundingBox())!;
      expect(b.height, 'chiều cao nút Xem tất cả sản phẩm đã lưu').toBeGreaterThanOrEqual(44);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);

      await cta.focus();
      await page.keyboard.press('Enter');
      await expect(tiles(page)).toHaveCount(1);
      await expect(chip(page, 'Tất cả')).toHaveAttribute('aria-pressed', 'true');
      await expect(chip(page, 'Tất cả')).toBeFocused();
      expect(await noHorizontalScroll(page)).toBe(true);
    });

    test('qua mốc hết giờ của suất Giờ vàng khi khách còn đang xem: số đếm và lưới Đang giảm bỏ món B', async ({ page, api }) => {
      await page.clock.install();
      const skew = { ms: 0 };
      mockWishlistData(api, { flash: flashForB(30 * 60_000, skew) });
      await page.goto('/tai-khoan/yeu-thich');
      await expect(tiles(page)).toHaveCount(4, { timeout: 20_000 });
      await expect(chip(page, 'Đang giảm')).toHaveText(chipText('Đang giảm', 3), { timeout: 10_000 });
      await chip(page, 'Đang giảm').click();
      await expect(tiles(page).filter({ hasText: NAME.b })).toHaveCount(1);

      // Đồng hồ máy chủ trong mock đi cùng trang: kho Giờ vàng (web) tải lại sau cú nhảy mà vẫn đo đúng độ lệch.
      skew.ms = 31 * 60_000;
      await page.clock.fastForward(31 * 60_000);
      await expect(chip(page, 'Đang giảm')).toHaveText(chipText('Đang giảm', 2));
      await expect(tiles(page)).toHaveCount(2);
      await expect(tiles(page).filter({ hasText: NAME.b })).toHaveCount(0);
      expect(await noHorizontalScroll(page)).toBe(true);
    });
  });
}
