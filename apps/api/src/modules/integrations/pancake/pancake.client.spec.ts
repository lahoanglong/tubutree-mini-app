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

describe('PancakeClient.fetchProducts', () => {
  it('HTTP 200 kèm success:false → ném lỗi (không trả trang rỗng như thể đã hết danh mục)', async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ data: { success: false, message: 'rate limited' } }));
    await expect(client.fetchProducts(2)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('không có mảng data lẫn products → ném lỗi', async () => {
    const client = makeClient(jest.fn().mockResolvedValue({ data: { success: true } }));
    await expect(client.fetchProducts(1)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const empty = makeClient(jest.fn().mockResolvedValue({ data: '' }));
    await expect(empty.fetchProducts(1)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('trang hợp lệ (data hoặc products, kể cả rỗng) → trả nguyên phản hồi kèm thông tin phân trang', async () => {
    const body = { success: true, data: [], page_number: 4, total_pages: 3, total_entries: 60 };
    await expect(makeClient(jest.fn().mockResolvedValue({ data: body })).fetchProducts(4)).resolves.toEqual(body);
    const legacy = { products: [{ id: 'a', name: 'A' }] };
    await expect(makeClient(jest.fn().mockResolvedValue({ data: legacy })).fetchProducts(1)).resolves.toEqual(legacy);
  });
});
