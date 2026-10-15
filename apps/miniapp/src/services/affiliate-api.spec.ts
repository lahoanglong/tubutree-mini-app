import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ api: { post: vi.fn() } }));

import { api } from './api';
import { createCtvOrder } from './affiliate-api';

const post = vi.mocked(api.post);

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: { id: 'o1', code: 'TUBU1' } });
});

describe('createCtvOrder — CTV lên đơn hộ khách', () => {
  it('gửi Idempotency-Key ở header (R5-CHECKOUT-1: gửi lại sau quá thời gian không tạo đơn thứ hai)', async () => {
    const dto = {
      items: [{ variationId: 'v1', quantity: 1 }],
      customer: {
        recipient: 'Nguyễn An', phone: '0901234567', province: 'Hà Nội', ward: 'Phường Ba Đình', street: '12 Lê Lợi',
        provinceCode: '84_VN01', wardCode: '84_VN0101',
      },
      paymentMethod: 'COD' as const,
    };
    await expect(createCtvOrder(dto, 'key-1')).resolves.toEqual({ id: 'o1', code: 'TUBU1' });
    expect(post).toHaveBeenCalledWith('/affiliate/orders', dto, { headers: { 'Idempotency-Key': 'key-1' } });
  });
});
