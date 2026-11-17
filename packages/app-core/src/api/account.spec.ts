import { describe, expect, it } from 'vitest';
import { fakeHttp } from './fake-http';
import {
  completeOnboarding,
  deleteAddress,
  fetchNotifyPrefs,
  getMe,
  getNotifications,
  getNotificationsPage,
  markAllNotificationsRead,
  markNotificationRead,
  requestAccountDeletion,
  saveNotifyPrefs,
  NOTIFY_PREFS_TEXT_VERSION,
  updateAddress,
  updateMe,
} from './account';

describe('account — hợp đồng gọi API', () => {
  it('hồ sơ, onboarding, xoá tài khoản', async () => {
    const { http, calls } = fakeHttp();
    await getMe(http);
    await updateMe(http, { fullName: 'A', dob: '2000-01-01' });
    await completeOnboarding(http, ['mom']);
    await requestAccountDeletion(http, 'lý do');
    await requestAccountDeletion(http);
    await requestAccountDeletion(http, undefined, { acknowledgedWalletBalance: 20000, acceptWalletForfeit: true });
    expect(calls).toEqual([
      { method: 'get', path: '/me' },
      { method: 'patch', path: '/me', body: { fullName: 'A', dob: '2000-01-01' } },
      { method: 'post', path: '/me/onboarding', body: { segments: ['mom'] } },
      { method: 'post', path: '/me/deletion-request', body: { reason: 'lý do' } },
      { method: 'post', path: '/me/deletion-request', body: { reason: undefined } },
      { method: 'post', path: '/me/deletion-request', body: { reason: undefined, acknowledgedWalletBalance: 20000, acceptWalletForfeit: true } },
    ]);
  });

  it('thông báo và tuỳ chọn thông báo', async () => {
    const { http, calls } = fakeHttp();
    await getNotifications(http);
    await markNotificationRead(http, 'n1');
    await markAllNotificationsRead(http);
    await fetchNotifyPrefs(http);
    await saveNotifyPrefs(http, { notifyPromo: false });
    await saveNotifyPrefs(http, { notifySocial: true }, 'onboarding');
    expect(calls).toEqual([
      { method: 'get', path: '/me/notifications' },
      { method: 'post', path: '/me/notifications/n1/read' },
      { method: 'post', path: '/me/notifications/read-all' },
      { method: 'get', path: '/me/notifications/prefs' },
      // Mỗi lần đổi gửi kèm nguồn và phiên bản câu chữ để máy chủ lưu bằng chứng đồng ý.
      { method: 'patch', path: '/me/notifications/prefs', body: { notifyPromo: false, source: 'settings', textVersion: NOTIFY_PREFS_TEXT_VERSION } },
      { method: 'patch', path: '/me/notifications/prefs', body: { notifySocial: true, source: 'onboarding', textVersion: NOTIFY_PREFS_TEXT_VERSION } },
    ]);
    // Máy chủ chỉ nhận phiên bản dạng chữ thường, số, chấm, gạch (tối đa 40 ký tự).
    expect(NOTIFY_PREFS_TEXT_VERSION).toMatch(/^[a-z0-9][a-z0-9._-]{0,39}$/);
  });

  it('trang thông báo kèm con trỏ', async () => {
    const { http, calls } = fakeHttp();
    await getNotificationsPage(http);
    await getNotificationsPage(http, { before: '2026-10-28T03:00:00.000Z', beforeId: 'n9', limit: 20 });
    expect(calls).toEqual([
      { method: 'get', path: '/me/notifications', opts: { query: {} } },
      { method: 'get', path: '/me/notifications', opts: { query: { before: '2026-10-28T03:00:00.000Z', beforeId: 'n9', limit: 20 } } },
    ]);
  });

  it('sửa và xoá địa chỉ', async () => {
    const { http, calls } = fakeHttp();
    await updateAddress(http, 'a1', { street: 'x' });
    await deleteAddress(http, 'a1');
    expect(calls).toEqual([
      { method: 'patch', path: '/me/addresses/a1', body: { street: 'x' } },
      { method: 'delete', path: '/me/addresses/a1' },
    ]);
  });
});
