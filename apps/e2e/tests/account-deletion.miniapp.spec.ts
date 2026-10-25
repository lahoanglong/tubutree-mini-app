import { test, expect, makeUser, mockSession } from './support/mock-api';

/**
 * Zalo Mini App E2E — xoá tài khoản khi Ví Tubu còn tiền (apps/miniapp/src/pages/about.tsx).
 * Khách phải thấy số dư sẽ mất và tick đồng ý; yêu cầu gửi kèm đúng số dư đã thấy (POST /me/deletion-request).
 */

const WALLET = (walletBalance: number) => ({ walletBalance, cashbackPending: 0, commissionApproved: 0, commissionPending: 0 });

test.describe('Zalo Mini App E2E — Xoá tài khoản và số dư Ví', () => {
  test.beforeEach(async ({ api }) => {
    mockSession(api, makeUser({ id: 'user-del', fullName: 'Nguyễn Văn A', walletBalance: 50000 }));
    api.get('/faqs', []);
    api.get('/config/public', { support: { hotline: null, email: null, zaloOaName: null } });
    api.post('/me/deletion-request', { alreadyRequested: false, createdAt: new Date().toISOString(), message: 'Yêu cầu đã được ghi nhận.' });
  });

  test('Ví còn tiền: hiện số dư mất, nút gửi khoá tới khi tick đồng ý, gửi kèm đúng số dư đã thấy', async ({ page, api }) => {
    api.get('/me/wallet', WALLET(50000));
    await page.goto('/about');
    await page.getByRole('button', { name: 'Xoá tài khoản' }).click();

    await expect(page.getByText('Ví Tubu còn 50.000đ. Xoá tài khoản thì số dư này mất và không hoàn lại.')).toBeVisible({ timeout: 15_000 });
    const send = page.getByRole('button', { name: 'Gửi yêu cầu xoá' });
    await expect(send).toBeDisabled();
    await page.getByRole('checkbox', { name: /Tôi đồng ý bỏ số dư Ví Tubu/ }).check();
    await expect(send).toBeEnabled();
    const sent = api.waitForCall('POST', '/me/deletion-request');
    await send.click();
    expect((await sent).body).toEqual({ acknowledgedWalletBalance: 50000, acceptWalletForfeit: true });
  });

  test('Ví không còn tiền: không có dòng báo mất số dư, gửi được ngay không cần tick', async ({ page, api }) => {
    api.get('/me/wallet', WALLET(0));
    await page.goto('/about');
    await page.getByRole('button', { name: 'Xoá tài khoản' }).click();

    const send = page.getByRole('button', { name: 'Gửi yêu cầu xoá' });
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await expect(page.getByText(/Ví Tubu còn/)).toHaveCount(0);
    const sent = api.waitForCall('POST', '/me/deletion-request');
    await send.click();
    expect((await sent).body).toEqual({});
  });
});
