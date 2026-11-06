import { test, expect, makeUser, mockSession } from './support/mock-api';

/**
 * Zalo Mini App, Sửa hồ sơ: xoá trắng họ tên rồi bấm Lưu thì chặn, báo lỗi ở ô, không gọi PATCH /me và không báo "Đã cập nhật hồ sơ".
 * Trước đây form bỏ tên rỗng khỏi lời gọi, API giữ tên cũ mà vẫn báo thành công.
 */
test.describe('Zalo Mini App E2E - Sửa hồ sơ: họ tên trống', () => {
  test('xoá trắng họ tên: báo lỗi ở ô, không gửi, không báo thành công; nhập lại tên thì lưu được', async ({ page, api }) => {
    mockSession(api, makeUser({ id: 'u-name', fullName: 'Nguyễn Văn An' }));
    api.get('/me', { id: 'u-name', fullName: 'Nguyễn Văn An', email: null, avatarUrl: null, dob: '1990-05-01', onboarded: true, segments: [] });
    api.patch('/me', ({ call }) => ({ id: 'u-name', email: null, avatarUrl: null, dob: '1990-05-01', ...(call.body as object) }));
    await page.goto('/edit-profile');
    const name = page.getByLabel('Họ và tên');
    await expect(name).toHaveValue('Nguyễn Văn An', { timeout: 15_000 });

    for (const blank of ['', '    ']) {
      await name.fill(blank);
      await page.getByRole('button', { name: 'Lưu thay đổi' }).click({ force: true });
      await expect(page.getByText('Nhập họ tên để lưu hồ sơ.')).toBeVisible();
      await expect(name).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    }
    await page.waitForTimeout(300);
    expect(api.callsTo('PATCH', '/me')).toHaveLength(0);
    await expect(page.getByText('Đã cập nhật hồ sơ')).toHaveCount(0);

    await name.fill('  Nguyễn Văn Bình ');
    await expect(page.getByText('Nhập họ tên để lưu hồ sơ.')).toHaveCount(0);
    const saved = api.waitForCall('PATCH', '/me');
    await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
    expect(((await saved).body as Record<string, unknown>).fullName).toBe('Nguyễn Văn Bình');
    await expect(page.getByText('Đã cập nhật hồ sơ')).toBeVisible();
  });
});
