import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  ZALO_REVOKE_CONSENT_EVENT,
  ZALO_REVOKE_REASON,
  ZaloConsentWebhookController,
  zaloEventSignature,
} from './zalo-consent-webhook.controller';
import type { UsersService } from './users.service';

const KEY = 'zalo-open-api-key-for-tests';
const body = { event: ZALO_REVOKE_CONSENT_EVENT, appId: '2070857098114207963', userId: 'zalo-user-777', timestamp: 1670553442564 };

function make(apiKey = KEY, outcome: { userId: string | null; alreadyRequested: boolean } = { userId: 'u1', alreadyRequested: false }) {
  const requestAccountDeletionByZaloId = jest.fn().mockResolvedValue(outcome);
  const users = { requestAccountDeletionByZaloId } as unknown as UsersService;
  const ctrl = new ZaloConsentWebhookController(users, { get: () => apiKey } as never);
  return { ctrl, requestAccountDeletionByZaloId };
}

describe('zaloEventSignature', () => {
  it('sha256 hex của giá trị xếp theo tên khoá + API Key', () => {
    // appId, event, timestamp, userId
    const content = '2070857098114207963' + 'user.revoke.consent' + '1670553442564' + 'zalo-user-777';
    const expected = require('node:crypto').createHash('sha256').update(content + KEY).digest('hex');
    expect(zaloEventSignature(body, KEY)).toBe(expected);
  });
  it('thứ tự khoá trong body không đổi chữ ký; object được JSON.stringify', () => {
    const a = zaloEventSignature({ b: { x: 1 }, a: 'z' }, KEY);
    const b = zaloEventSignature({ a: 'z', b: { x: 1 } }, KEY);
    expect(a).toBe(b);
  });
});

describe('ZaloConsentWebhookController.handle', () => {
  const sig = zaloEventSignature(body, KEY);
  let logs: string[];
  beforeEach(() => {
    logs = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((m: unknown) => void logs.push(String(m)));
    jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => void logs.push(String(m)));
  });
  afterEach(() => jest.restoreAllMocks());

  it('chữ ký đúng → tạo yêu cầu xoá một lần', async () => {
    const { ctrl, requestAccountDeletionByZaloId } = make();
    await expect(ctrl.handle(body, sig)).resolves.toEqual({ received: true });
    expect(requestAccountDeletionByZaloId).toHaveBeenCalledTimes(1);
    expect(requestAccountDeletionByZaloId).toHaveBeenCalledWith('zalo-user-777', ZALO_REVOKE_REASON);
  });

  it('chữ ký hoa/thừa khoảng trắng vẫn khớp', async () => {
    const { ctrl, requestAccountDeletionByZaloId } = make();
    await ctrl.handle(body, ` ${sig.toUpperCase()} `);
    expect(requestAccountDeletionByZaloId).toHaveBeenCalledTimes(1);
  });

  it('gửi lại cùng sự kiện (đã có yêu cầu chờ) → 200, không lỗi', async () => {
    const { ctrl } = make(KEY, { userId: 'u1', alreadyRequested: true });
    await expect(ctrl.handle(body, sig)).resolves.toEqual({ received: true });
  });

  it('user không tồn tại → 200 no-op', async () => {
    const { ctrl, requestAccountDeletionByZaloId } = make(KEY, { userId: null, alreadyRequested: false });
    await expect(ctrl.handle(body, sig)).resolves.toEqual({ received: true });
    expect(requestAccountDeletionByZaloId).toHaveBeenCalledTimes(1);
  });

  it.each([['sai chữ ký', 'deadbeef'], ['thiếu chữ ký', undefined], ['chữ ký rỗng', '']])('%s → 401, không xử lý', async (_n, s) => {
    const { ctrl, requestAccountDeletionByZaloId } = make();
    await expect(ctrl.handle(body, s)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(requestAccountDeletionByZaloId).not.toHaveBeenCalled();
  });

  it('body bị sửa sau khi ký (đổi userId) → 401', async () => {
    const { ctrl, requestAccountDeletionByZaloId } = make();
    await expect(ctrl.handle({ ...body, userId: 'nguoi-khac' }, sig)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(requestAccountDeletionByZaloId).not.toHaveBeenCalled();
  });

  it('chưa cấu hình API Key → 401 kể cả chữ ký "đúng" với khoá rỗng', async () => {
    const { ctrl, requestAccountDeletionByZaloId } = make('');
    await expect(ctrl.handle(body, zaloEventSignature(body, ''))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(requestAccountDeletionByZaloId).not.toHaveBeenCalled();
  });

  it('sự kiện khác (ký đúng) → 200, không xử lý', async () => {
    const other = { ...body, event: 'user.something.else' };
    const { ctrl, requestAccountDeletionByZaloId } = make();
    await expect(ctrl.handle(other, zaloEventSignature(other, KEY))).resolves.toEqual({ received: true });
    expect(requestAccountDeletionByZaloId).not.toHaveBeenCalled();
  });

  it('thiếu userId (ký đúng) → 200, không xử lý', async () => {
    const noUser = { event: ZALO_REVOKE_CONSENT_EVENT, appId: 'a', timestamp: 1 };
    const { ctrl, requestAccountDeletionByZaloId } = make();
    await expect(ctrl.handle(noUser, zaloEventSignature(noUser, KEY))).resolves.toEqual({ received: true });
    expect(requestAccountDeletionByZaloId).not.toHaveBeenCalled();
  });

  it('log không chứa userId Zalo, chữ ký, khoá hay body', async () => {
    const { ctrl } = make();
    await ctrl.handle(body, sig);
    await ctrl.handle(body, sig);
    const { ctrl: none } = make(KEY, { userId: null, alreadyRequested: false });
    await none.handle(body, sig);
    const all = logs.join('\n');
    expect(all).not.toContain('zalo-user-777');
    expect(all).not.toContain(sig);
    expect(all).not.toContain(KEY);
    expect(all).not.toContain('2070857098114207963');
  });
});
