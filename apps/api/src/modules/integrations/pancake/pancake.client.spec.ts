import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PancakeClient } from './pancake.client';

function makeClient(get: jest.Mock) {
  const values: Record<string, string> = {
    PANCAKE_API_KEY: 'k',
    PANCAKE_SHOP_ID: 's',
    PANCAKE_BASE_URL: 'http://pancake.invalid',
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<never, true>;
  const client = new PancakeClient(config as never);
  (client as unknown as { http: { get: jest.Mock } }).http.get = get;
  return client;
}

describe('PancakeClient geo', () => {
  it('HTTP 200 kèm success:false → ném lỗi (không trả [] như thể không có tỉnh nào)', async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ data: { success: false, message: 'rate limited' } }));
    await expect(client.fetchProvinces()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(client.fetchCommunes('84_VN01')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('thiếu mảng data → ném lỗi', async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ data: {} }));
    await expect(client.fetchProvinces()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('có data → trả nguyên danh sách', async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ data: { data: [{ id: '101', name: 'Hà Nội', new_id: '84_VN01' }] } }));
    await expect(client.fetchProvinces()).resolves.toEqual([{ id: '101', name: 'Hà Nội', new_id: '84_VN01' }]);
  });
});
