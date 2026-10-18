import { test, expect, makeUser, mockSession } from './support/mock-api';
import { mockExternalPoints } from './support/external-points-mocks';

/**
 * Zalo Mini App E2E - Tích điểm đơn sàn bằng mã vận đơn (B6 bước 2, trang /points/scan).
 * Kiểm: dải "gấp đôi" lấy số từ config, gửi mã thành công hiện sàn/điểm chờ/mốc cộng, lỗi theo `code` hiện câu của app,
 * cờ tắt thì báo chưa mở.
 */
// Mốc tương lai tính từ giờ chạy, đúng 12:00 UTC để ngày hiển thị giống nhau ở mọi múi giờ phổ biến.
const FUTURE = new Date(Date.now() + 7 * 864e5);
FUTURE.setUTCHours(12, 0, 0, 0);
const pad2 = (n: number) => String(n).padStart(2, '0');
const FUTURE_LABEL = `${pad2(FUTURE.getUTCDate())}/${pad2(FUTURE.getUTCMonth() + 1)}/${FUTURE.getUTCFullYear()}`;

test.describe('Zalo Mini App E2E - Tích điểm đơn sàn', () => {
  test.beforeEach(({ api }) => {
    mockSession(api, makeUser({ id: 'user-ext', fullName: 'Nguyễn Văn A' }));
  });

  test('gửi mã thành công: dải gấp đôi, kết quả có sàn, điểm chờ và mốc dự kiến', async ({ page, api }) => {
    mockExternalPoints(api, {
      submit: {
        status: 'CLAIMED', claimId: 'c1', channel: 'Shopee', maskedCode: 'SPX***789', points: 1250,
        expectedCreditAt: FUTURE.toISOString(), message: 'ok',
      },
    });
    await page.goto('/points/scan');

    await expect(page.getByText('Mua trong Mini App: tích gấp đôi')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Đơn sàn 1% · Mua trong Mini App từ 2%, nhân theo hạng')).toBeVisible();

    await page.getByLabel('Mã vận đơn hoặc mã đơn trên sàn').fill('SPXVN0123456789');
    await page.getByRole('button', { name: 'Tích điểm' }).click();

    const result = page.getByTestId('claim-result');
    await expect(result).toContainText('Đã ghi nhận đơn Shopee SPX***789');
    await expect(result).toContainText('1.250 Điểm Xanh đang chờ cộng');
    await expect(result).toContainText(`Dự kiến cộng từ ${FUTURE_LABEL}`);
    expect(api.callsTo('POST', '/me/external-points/claims').map((c) => c.body)).toEqual([{ code: 'SPXVN0123456789' }]);
  });

  test('mã đã tích: hiện câu tiếng Việt theo code, không có khối kết quả', async ({ page, api }) => {
    mockExternalPoints(api, { submit: { rejectCode: 'ALREADY_CLAIMED', status: 409, message: 'Mã này đã được tích điểm.' } });
    await page.goto('/points/scan');

    await page.getByLabel('Mã vận đơn hoặc mã đơn trên sàn').fill('SPXVN0123456789');
    await page.getByRole('button', { name: 'Tích điểm' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Mã này đã được dùng để tích điểm trước đó.' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('claim-result')).toHaveCount(0);
  });

  test('cờ tắt: vào thẳng URL thì báo chưa mở', async ({ page, api }) => {
    mockExternalPoints(api, { enabled: false });
    await page.goto('/points/scan');

    await expect(page.getByText('Chưa mở', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Tích điểm' })).toHaveCount(0);
  });
});
