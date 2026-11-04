import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
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

  describe('Zalo từ chối appsecret_proof', () => {
    const httpError = (status: number, data?: unknown) => Object.assign(new Error(`status ${status}`), { isAxiosError: true, response: { status, data } });
    const proofsSent = () => (axios.get as jest.Mock).mock.calls.map((c) => (c[1].headers as Record<string, string>).appsecret_proof);
    let errorLog: jest.SpyInstance;
    beforeEach(() => {
      (axios.get as jest.Mock).mockReset();
      errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => errorLog.mockRestore());
    const proofErrors = () => errorLog.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('appsecret_proof'));

    it('HTTP lỗi ở lượt có proof → lượt 2 không proof, đăng nhập thành công, có log error (không chứa token)', async () => {
      (axios.get as jest.Mock).mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce({ data: { id: 'z1', name: 'A' } });
      await expect(make('s3cret').getUserInfo('tok-123')).resolves.toMatchObject({ zaloId: 'z1' });
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(proofsSent()[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(proofsSent()[1]).toBeUndefined();
      const logged = errorLog.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).toContain('Zalo từ chối appsecret_proof');
      expect(logged).not.toContain('tok-123');
    });

    it('body có error khác 0 ở lượt có proof → thử lại không proof', async () => {
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { error: -201, message: 'Invalid appsecret_proof' } })
        .mockResolvedValueOnce({ data: { id: 'z1' } });
      await expect(make('s3cret').getUserInfo('tok')).resolves.toMatchObject({ zaloId: 'z1' });
      expect(proofsSent()[1]).toBeUndefined();
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Zalo từ chối appsecret_proof'));
    });

    it('proof được chấp nhận → đúng một lượt, không log lỗi', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ data: { id: 'z1' } });
      await make('s3cret').getUserInfo('tok');
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('cả hai lượt lỗi → lỗi như cũ (401 không xác thực được)', async () => {
      (axios.get as jest.Mock).mockRejectedValueOnce(httpError(400)).mockRejectedValueOnce(httpError(400));
      await expect(make('s3cret').getUserInfo('tok')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(axios.get).toHaveBeenCalledTimes(2);
      expect(proofErrors()).toHaveLength(0);
    });

    it('cả hai lượt lỗi mà phản hồi lượt có proof nhắc appsecret (HTTP hoặc body, không phân biệt hoa thường) → error log', async () => {
      (axios.get as jest.Mock)
        .mockRejectedValueOnce(httpError(400, { message: 'Invalid APPSECRET_PROOF' }))
        .mockRejectedValueOnce(httpError(400, { message: 'Invalid APPSECRET_PROOF' }));
      await expect(make('s3cret').getUserInfo('tok-xyz')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(proofErrors()).toHaveLength(1);
      expect(proofErrors()[0]).not.toContain('tok-xyz');
      errorLog.mockClear();
      (axios.get as jest.Mock).mockReset();
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { error: -201, message: 'appsecret_proof is required' } })
        .mockResolvedValueOnce({ data: { error: -201, message: 'appsecret_proof is required' } });
      await expect(make('s3cret').getUserInfo('tok')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(proofErrors()).toHaveLength(1);
    });

    it('cả hai lượt lỗi vì token hỏng (phản hồi không nhắc appsecret) → chỉ warn', async () => {
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { error: -216, message: 'Access token is invalid' } })
        .mockResolvedValueOnce({ data: { error: -216, message: 'Access token is invalid' } });
      await expect(make('s3cret').getUserInfo('tok')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(proofErrors()).toHaveLength(0);
    });

    it('proof lỗi + không proof OK → đúng 1 error log nhắc proof', async () => {
      (axios.get as jest.Mock).mockRejectedValueOnce(httpError(400)).mockResolvedValueOnce({ data: { id: 'z1' } });
      await make('s3cret').getUserInfo('tok');
      expect(proofErrors()).toHaveLength(1);
      expect(proofErrors()[0]).toContain('nhưng chấp nhận khi không có proof');
    });

    it('lỗi mạng/timeout/5xx ở lượt có proof → không thử lại, 503 như cũ', async () => {
      (axios.get as jest.Mock).mockRejectedValue(Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }));
      await expect(make('s3cret').getUserInfo('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(axios.get).toHaveBeenCalledTimes(1);
      (axios.get as jest.Mock).mockReset();
      (axios.get as jest.Mock).mockRejectedValue(httpError(503));
      await expect(make('s3cret').getUserInfo('tok')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('không có secret → không thử lại, không log "từ chối proof"', async () => {
      (axios.get as jest.Mock).mockRejectedValue(httpError(400));
      await expect(make(null).getUserInfo('tok')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(axios.get).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls.map((c) => String(c[0])).join()).not.toContain('appsecret_proof');
    });
  });
});
