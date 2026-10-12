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
