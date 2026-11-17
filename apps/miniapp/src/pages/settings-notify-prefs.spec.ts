import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFY_PREFS_TEXT_VERSION } from '@tubutree/app-core/api/account';
import { HttpError } from '../services/http';

const mocks = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { get: mocks.get, patch: mocks.patch },
}));

import { fetchNotifyPrefs, saveNotifyPrefs } from './settings-notify-prefs';

const rejected = (field: string) =>
  new HttpError('Bad Request', undefined, { status: 400, data: { statusCode: 400, message: [`Không nhận trường «${field}».`], error: 'Bad Request' } });

describe('Cài đặt thông báo Mini App: API mới và API trước khi tách công tắc', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.patch.mockReset();
  });

  it('gửi kèm nguồn và phiên bản câu chữ', async () => {
    mocks.patch.mockResolvedValue({ data: { notifyPromo: false, notifyGarden: true, notifySocial: true } });
    await expect(saveNotifyPrefs({ notifyPromo: false })).resolves.toEqual({ notifyPromo: false, notifyGarden: true, notifySocial: true });
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledWith('/me/notifications/prefs', { notifyPromo: false, source: 'settings', textVersion: NOTIFY_PREFS_TEXT_VERSION });
  });

  it('API cũ chặn trường «source»: gửi lại chỉ phần công tắc nó hiểu, tương tác bài viết theo công tắc gộp', async () => {
    mocks.patch.mockRejectedValueOnce(rejected('source')).mockResolvedValueOnce({ data: { notifyPromo: true, notifyGarden: false } });
    await expect(saveNotifyPrefs({ notifyGarden: false })).resolves.toEqual({ notifyPromo: true, notifyGarden: false, notifySocial: false });
    expect(mocks.patch).toHaveBeenNthCalledWith(2, '/me/notifications/prefs', { notifyGarden: false });
  });

  it('API cũ không lưu được công tắc Tương tác bài viết: báo lỗi, không gửi lần hai', async () => {
    const err = rejected('notifySocial');
    mocks.patch.mockRejectedValueOnce(err);
    await expect(saveNotifyPrefs({ notifySocial: false })).rejects.toBe(err);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it('400 vì lý do khác không bị gửi lại', async () => {
    const err = new HttpError('Bad Request', undefined, { status: 400, data: { message: ['notifyPromo phải là đúng/sai.'] } });
    mocks.patch.mockRejectedValueOnce(err);
    await expect(saveNotifyPrefs({ notifyPromo: false })).rejects.toBe(err);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });

  it('API cũ không trả notifySocial khi đọc: lấy theo notifyGarden', async () => {
    mocks.get.mockResolvedValue({ data: { notifyPromo: true, notifyGarden: false } });
    await expect(fetchNotifyPrefs()).resolves.toEqual({ notifyPromo: true, notifyGarden: false, notifySocial: false });
  });
});
