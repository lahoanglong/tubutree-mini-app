import { expect, makeUser, mockSession, reply, test, type MockApi } from './support/mock-api';
import { mockAffiliateDashboard } from './support/affiliate-mocks';
import { expectPressFeedback, probeTapTargets } from './support/touch-probe';
import { FEATURED_PICKER, FEATURED_REF, W43B_SIZES, expectFeaturedBlock, expectFeaturedCopy, stubClipboard } from './support/wave43b';

/**
 * W43B: bảng điều khiển CTV của Mini App (/affiliate), ở 375×812 và 1440×900: huy hiệu bậc ở thẻ tiền và khối "Sản phẩm hoa hồng nổi bật" ở tab Chia sẻ
 * (xếp theo tiền hoa hồng, nút Chép link giới thiệu chép link có ?ref=). Chạy Chromium (phép đo hệ số co chập chờn trên WebKit Linux của CI, xem
 * touch-press.miniapp.spec.ts). API mock toàn bộ.
 */
test.use({ browserName: 'chromium' });

function mockCtv(api: MockApi, picker: () => unknown = () => FEATURED_PICKER) {
  mockSession(api, makeUser({ id: 'aff-1', role: 'AFFILIATE', fullName: 'Affiliate 1', referralCode: FEATURED_REF }));
  mockAffiliateDashboard(api, { me: { referralCode: FEATURED_REF } });
  api.get('/storefront/me/products', picker);
}

for (const size of W43B_SIZES) {
  test.describe(`Mini App CTV hoa hồng nổi bật ${size.width}×${size.height}`, () => {
    test.beforeEach(async ({ page, browserName }) => {
      expect(browserName, 'spec nhấn giữ phải chạy Chromium').toBe('chromium');
      await page.setViewportSize(size);
    });

    test('thẻ tiền: huy hiệu bậc cạnh nhãn, số tiền dùng số đều', async ({ page, api }) => {
      mockCtv(api);
      await page.goto('/affiliate');
      await expect(page.getByTestId('ctv-hero-tier')).toContainText('CTV Đồng', { timeout: 15_000 });
      const amount = page.getByText('120.000đ', { exact: true }).first();
      await expect(amount).toBeVisible();
      expect(await amount.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain('tabular-nums');
    });

    test('tab Chia sẻ: hai dòng xếp theo tiền hoa hồng, nút Chép link đủ 44px', async ({ page, api }) => {
      mockCtv(api);
      await page.goto('/affiliate?tab=share');
      const block = await expectFeaturedBlock(page);
      expect(await probeTapTargets(page, { scope: '[data-testid="ctv-featured"]' })).toEqual([]);
      await expectPressFeedback(page, block.getByTestId('ctv-featured-row').nth(0).getByRole('button'), 'nút Chép link giới thiệu');
    });

    test('chạm Chép link giới thiệu: clipboard có link ?ref= của CTV, nhãn Đã chép link rồi tự trả về', async ({ page, api }) => {
      await stubClipboard(page);
      mockCtv(api);
      await page.goto('/affiliate?tab=share');
      const block = await expectFeaturedBlock(page);
      await expectFeaturedCopy(page, block);
    });

    test('tải danh sách lỗi: lời báo và nút Thử lại; thử lại được thì hiện danh sách', async ({ page, api }) => {
      let failing = true;
      mockCtv(api, () => (failing ? reply(500, { message: 'Lỗi máy chủ', statusCode: 500 }) : FEATURED_PICKER));
      await page.goto('/affiliate?tab=share');
      const block = page.getByTestId('ctv-featured');
      await expect(block.getByRole('alert')).toContainText('Chưa tải được danh sách sản phẩm.', { timeout: 30_000 });
      failing = false;
      await block.getByRole('button', { name: 'Thử lại' }).click();
      await expectFeaturedBlock(page);
    });
  });
}
