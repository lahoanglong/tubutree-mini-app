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

function makeOrderClient(http: Record<string, jest.Mock>) {
  const client = makeClient(jest.fn());
  Object.assign((client as unknown as { http: Record<string, jest.Mock> }).http, http);
  return client;
}

function axiosErr(status?: number, data?: unknown) {
  return Object.assign(new Error(status ? `Request failed with status code ${status}` : 'timeout of 15000ms exceeded'), {
    isAxiosError: true,
    response: status ? { status, data } : undefined,
  });
}

describe('PancakeClient đơn hàng (PANCAKE-2, PANCAKE-4, PANCAKE-14)', () => {
  it('createOrder: timeout / 5xx / 429 → lỗi TẠM (Pancake có thể đã tạo); 4xx → từ chối dứt khoát', async () => {
    for (const [err, transient] of [
      [axiosErr(), true],
      [axiosErr(502), true],
      [axiosErr(429), true],
      [axiosErr(422, { success: false, message: 'variation_id không hợp lệ' }), false],
    ] as const) {
      const client = makeOrderClient({ post: jest.fn().mockRejectedValue(err) });
      await expect(client.createOrder({ items: [] } as never)).rejects.toMatchObject({ name: 'PancakeApiError', transient });
    }
  });

  it('createOrder: HTTP 200 kèm success:false → từ chối dứt khoát, mang lời Pancake', async () => {
    const client = makeOrderClient({ post: jest.fn().mockResolvedValue({ data: { success: false, message: 'Hết hàng' } }) });
    await expect(client.createOrder({ items: [] } as never)).rejects.toMatchObject({
      transient: false,
      message: expect.stringContaining('Hết hàng'),
    });
  });

  it('getOrder: phẳng hoặc bọc data; 404 / order_not_found → null', async () => {
    const flat = makeOrderClient({ get: jest.fn().mockResolvedValue({ data: { id: 1, status: 2 } }) });
    expect(await flat.getOrder('1')).toEqual({ id: 1, status: 2 });
    const wrapped = makeOrderClient({ get: jest.fn().mockResolvedValue({ data: { success: true, data: { id: 1, status: 0 } } }) });
    expect(await wrapped.getOrder('1')).toEqual({ id: 1, status: 0 });
    const http404 = makeOrderClient({ get: jest.fn().mockRejectedValue(axiosErr(404, { success: false, error: 'order_not_found' })) });
    expect(await http404.getOrder('1')).toBeNull();
    const body404 = makeOrderClient({ get: jest.fn().mockResolvedValue({ data: { success: false, error: 'order_not_found' } }) });
    expect(await body404.getOrder('1')).toBeNull();
  });

  it('getOrder/updateOrder truyền timeout riêng (huỷ trên đường request của khách)', async () => {
    const get = jest.fn().mockResolvedValue({ data: { id: 1, status: 0 } });
    const put = jest.fn().mockResolvedValue({ data: { id: 1, status: 6 } });
    const client = makeOrderClient({ get, put });
    await client.getOrder('1', { timeoutMs: 5000 });
    await client.updateOrder('1', { status: 6 }, { timeoutMs: 5000 });
    expect(get).toHaveBeenCalledWith('/shops/s/orders/1', { params: { api_key: 'k' }, timeout: 5000 });
    expect(put).toHaveBeenCalledWith('/shops/s/orders/1', { status: 6 }, { params: { api_key: 'k' }, timeout: 5000 });
  });

  it('searchOrders: tìm theo mã đơn; không có mảng data → lỗi tạm (không coi là "không có đơn")', async () => {
    const get = jest.fn().mockResolvedValue({ data: { data: [{ id: 9, custom_id: 'TUBU1' }] } });
    expect(await makeOrderClient({ get }).searchOrders('TUBU1')).toEqual([{ id: 9, custom_id: 'TUBU1' }]);
    expect(get.mock.calls[0][1].params).toMatchObject({ search: 'TUBU1', page_size: 50, page_number: 1 });
    const broken = makeOrderClient({ get: jest.fn().mockResolvedValue({ data: {} }) });
    await expect(broken.searchOrders('TUBU1')).rejects.toMatchObject({ transient: true });
  });
});
