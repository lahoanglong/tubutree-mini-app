import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import axios from 'axios';
import { ZaloService } from './zalo.service';

jest.mock('axios');

describe('ZaloService.resolvePhoneNumber', () => {
  const make = (secret: string | null = 'sec') =>
    new ZaloService({ get: jest.fn().mockReturnValue(secret) } as never);
  const reply = (number?: string) =>
    (axios.get as jest.Mock).mockResolvedValue({ data: { error: 0, data: { number } } });

  it('số Zalo 84xxxxxxxxx → dạng nội địa 0xxxxxxxxx', async () => {
    reply('84912345678');
    await expect(make().resolvePhoneNumber('code', 'token')).resolves.toBe('0912345678');
  });

  it('số không đủ 10 chữ số sau chuẩn hoá → null, không chặn đăng nhập', async () => {
    reply('84123');
    await expect(make().resolvePhoneNumber('code', 'token')).resolves.toBeNull();
  });

  it('thiếu ZALO_APP_SECRET → null, không gọi Zalo', async () => {
    (axios.get as jest.Mock).mockClear();
    await expect(make(null).resolvePhoneNumber('code', 'token')).resolves.toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('ZaloService — lỗi trả cho khách không lộ chuỗi thô của Zalo (BUYERWEB-19)', () => {
  const make = () =>
    new ZaloService({ get: jest.fn((k: string) => (k === 'ZALO_APP_ID' ? 'app' : 'secret')) } as never);

  it('đổi mã bị Zalo từ chối: câu tiếng Việt cho khách, không chứa error_description của Zalo', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { error: -14003, error_description: 'invalid code' } });
    const err = await make().exchangeOAuthCode('bad', 'verifier').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Mã đăng nhập Zalo không hợp lệ hoặc đã hết hạn. Bạn đăng nhập lại nhé.');
    expect((err as Error).message).not.toContain('invalid code');
  });

  it('verify token Zalo thất bại: không in message thô của Zalo', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { error: -216, message: 'Access token is invalid' } });
    const err = await make().getUserInfo('tok').catch((e: Error) => e);
    expect((err as Error).message).toBe('Không xác thực được tài khoản Zalo.');
  });
});

describe('ZaloService — Zalo tạm lỗi khác với mã sai: khách biết bước tiếp theo (R3-UI-8)', () => {
  const make = () =>
    new ZaloService({ get: jest.fn((k: string) => (k === 'ZALO_APP_ID' ? 'app' : 'secret')) } as never);
  const axiosError = (status?: number, code?: string) =>
    Object.assign(new Error(status ? `Request failed with status code ${status}` : 'connect ECONNREFUSED'), {
      isAxiosError: true,
      code,
      response: status ? { status, data: {} } : undefined,
    });

  it.each([
    ['Zalo trả 500', axiosError(500)],
    ['Zalo trả 503', axiosError(503)],
    ['Zalo trả 429', axiosError(429)],
    ['không kết nối được', axiosError(undefined, 'ECONNREFUSED')],
    ['quá hạn chờ', axiosError(undefined, 'ECONNABORTED')],
  ])('đổi mã khi %s: 503 với câu "Zalo đang bận", không phải câu của mã sai', async (_label, error) => {
    (axios.post as jest.Mock).mockRejectedValue(error);
    const err = await make().exchangeOAuthCode('code', 'verifier').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as Error).message).toBe('Zalo đang bận, bạn thử lại sau ít phút nhé.');
  });

  it('đổi mã khi Zalo trả 400: vẫn 401 và bảo khách đăng nhập lại', async () => {
    (axios.post as jest.Mock).mockRejectedValue(axiosError(400));
    const err = await make().exchangeOAuthCode('code', 'verifier').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as Error).message).toBe('Không đổi được mã đăng nhập Zalo. Bạn đăng nhập lại nhé.');
  });

  it('verify token khi Zalo lỗi 500: 503 "Zalo đang bận"; khi Zalo từ chối token vẫn 401', async () => {
    (axios.get as jest.Mock).mockRejectedValue(axiosError(500));
    const busy = await make().getUserInfo('tok').catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(ServiceUnavailableException);
    expect((busy as Error).message).toBe('Zalo đang bận, bạn thử lại sau ít phút nhé.');

    (axios.get as jest.Mock).mockRejectedValue(axiosError(401));
    const rejected = await make().getUserInfo('tok').catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(UnauthorizedException);
  });
});

describe('ZaloService.getUserInfo — appsecret_proof', () => {
  const make = (secret: string | null) => new ZaloService({ get: jest.fn().mockReturnValue(secret) } as never);
  const ok = () => (axios.get as jest.Mock).mockResolvedValue({ data: { id: 'z1', name: 'A' } });
  const headersOfLastCall = () => (axios.get as jest.Mock).mock.calls.at(-1)![1].headers as Record<string, string>;

  it('có app secret: gửi appsecret_proof = HMAC-SHA256 hex của access_token với khoá là secret', async () => {
    ok();
    await make('s3cret').getUserInfo('tok-123');
    expect(headersOfLastCall()).toEqual({
      access_token: 'tok-123',
      appsecret_proof: createHmac('sha256', 's3cret').update('tok-123').digest('hex'),
    });
    expect(headersOfLastCall().appsecret_proof).toMatch(/^[0-9a-f]{64}$/);
  });

  it('không có secret (rỗng hoặc thiếu): chỉ gửi access_token như cũ', async () => {
    ok();
    await make('').getUserInfo('tok-123');
    expect(headersOfLastCall()).toEqual({ access_token: 'tok-123' });
    await make(null).getUserInfo('tok-123');
    expect(headersOfLastCall()).toEqual({ access_token: 'tok-123' });
  });
});
