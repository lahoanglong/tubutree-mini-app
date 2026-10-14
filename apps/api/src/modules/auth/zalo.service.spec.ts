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
    expect((err as Error).message).toBe('Mã đăng nhập Zalo không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.');
    expect((err as Error).message).not.toContain('invalid code');
  });

  it('verify token Zalo thất bại: không in message thô của Zalo', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: { error: -216, message: 'Access token is invalid' } });
    const err = await make().getUserInfo('tok').catch((e: Error) => e);
    expect((err as Error).message).toBe('Không xác thực được tài khoản Zalo.');
  });
});
