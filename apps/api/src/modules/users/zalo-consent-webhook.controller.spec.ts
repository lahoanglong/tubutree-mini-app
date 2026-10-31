import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  ZALO_REVOKE_CONSENT_EVENT,
  ZALO_REVOKE_REASON,
  ZaloConsentWebhookController,
  zaloEventSignature,
} from './zalo-consent-webhook.controller';
import type { UsersService } from './users.service';

const KEY = 'zalo-open-api-key-for-tests';
const body = { event: ZALO_REVOKE_CONSENT_EVENT, appId: '2070857098114207963', userId: '4047671499938107249', timestamp: Date.now() };

function make(apiKey = KEY, outcome: { userId: string | null; alreadyRequested: boolean } = { userId: 'u1', alreadyRequested: false }, ids: Record<string, string> = {}) {
  const requestAccountDeletionByZaloId = jest.fn().mockResolvedValue(outcome);
  const users = { requestAccountDeletionByZaloId } as unknown as UsersService;
  const ctrl = new ZaloConsentWebhookController(users, { get: (k: string) => (k === 'ZALO_OPEN_API_KEY' ? apiKey : (ids[k] ?? '')) } as never);
  return { ctrl, requestAccountDeletionByZaloId };
}

describe('zaloEventSignature', () => {
  it('sha256 hex của giá trị xếp theo tên khoá + API Key', () => {
    // appId, event, timestamp, userId
    const content = '2070857098114207963' + 'user.revoke.consent' + String(body.timestamp) + '4047671499938107249';
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
    expect(requestAccountDeletionByZaloId).toHaveBeenCalledWith('4047671499938107249', ZALO_REVOKE_REASON);
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

  const signed = async (b: Record<string, unknown>, ids: Record<string, string> = {}) => {
    const { ctrl, requestAccountDeletionByZaloId } = make(KEY, undefined, ids);
    await expect(ctrl.handle(b, zaloEventSignature(b, KEY))).resolves.toEqual({ received: true });
    return requestAccountDeletionByZaloId;
  };

  it('body cắt lại ranh giới trường (timestamp dạng chuỗi, userId ngắn) dù chữ ký khớp nối chuỗi → 200, không xử lý', async () => {
    const forged = { appId: body.appId, event: body.event, timestamp: String(body.timestamp) + body.userId.slice(0, 4), userId: body.userId.slice(4) };
    const { ctrl, requestAccountDeletionByZaloId } = make();
    await expect(ctrl.handle(forged, sig)).resolves.toEqual({ received: true });
    expect(requestAccountDeletionByZaloId).not.toHaveBeenCalled();
  });

  it('thừa trường → no-op', async () => {
    expect(await signed({ ...body, extra: 'x' })).not.toHaveBeenCalled();
  });

  it('thiếu trường appId → no-op', async () => {
    const { appId: _a, ...rest } = body;
    expect(await signed(rest)).not.toHaveBeenCalled();
  });

  it('timestamp quá hạn (8 ngày) → no-op + warn', async () => {
    expect(await signed({ ...body, timestamp: Date.now() - 8 * 864e5 })).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('timestamp');
  });

  it('timestamp dạng chuỗi → no-op', async () => {
    expect(await signed({ ...body, timestamp: String(body.timestamp) })).not.toHaveBeenCalled();
  });

  it.each(['abc', '12345', '1'.repeat(26), '4047 671499'])('userId sai định dạng %s → no-op', async (userId) => {
    expect(await signed({ ...body, userId })).not.toHaveBeenCalled();
  });

  it('appId khác ZALO_MINIAPP_ID/ZALO_APP_ID khi đã cấu hình → no-op; khớp một trong hai → xử lý', async () => {
    expect(await signed(body, { ZALO_MINIAPP_ID: '999' })).not.toHaveBeenCalled();
    expect(await signed(body, { ZALO_MINIAPP_ID: '999', ZALO_APP_ID: body.appId })).toHaveBeenCalledTimes(1);
  });

  it('hơn 20 khoá → 401 trước khi băm', async () => {
    const big: Record<string, unknown> = { ...body };
    for (let i = 0; i < 20; i++) big[`k${i}`] = i;
    const { ctrl, requestAccountDeletionByZaloId } = make();
    await expect(ctrl.handle(big, zaloEventSignature(big, KEY))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(requestAccountDeletionByZaloId).not.toHaveBeenCalled();
  });

  it('không khớp user → warn có 12 ký tự băm, không có userId thô', async () => {
    const { ctrl } = make(KEY, { userId: null, alreadyRequested: false });
    await ctrl.handle(body, sig);
    const hash = require('node:crypto').createHash('sha256').update('4047671499938107249').digest('hex').slice(0, 12);
    expect(logs.join('\n')).toContain(hash);
    expect(logs.join('\n')).not.toContain('4047671499938107249');
  });

  it('log không chứa userId Zalo, chữ ký, khoá hay body', async () => {
    const { ctrl } = make();
    await ctrl.handle(body, sig);
    await ctrl.handle(body, sig);
    const { ctrl: none } = make(KEY, { userId: null, alreadyRequested: false });
    await none.handle(body, sig);
    const all = logs.join('\n');
    expect(all).not.toContain('4047671499938107249');
    expect(all).not.toContain(sig);
    expect(all).not.toContain(KEY);
    expect(all).not.toContain('2070857098114207963');
  });
});
