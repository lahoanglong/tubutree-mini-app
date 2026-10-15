import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ api: { post: vi.fn() } }));

import { api } from './api';
import { returnBottles } from './refill-api';

const post = vi.mocked(api.post);

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: { id: 'r1' } });
});

describe('returnBottles — gửi yêu cầu đổi vỏ', () => {
  it('kèm điểm nhận đã chọn và Idempotency-Key ở header', async () => {
    await returnBottles(3, 'key-1', 'loc-2');

    expect(post).toHaveBeenCalledWith('/refill/return', { quantity: 3, pickupLocationId: 'loc-2' }, { headers: { 'Idempotency-Key': 'key-1' } });
  });

  it('chưa có điểm nào (dự phòng một điểm cũ) → body như bản cũ, không có pickupLocationId', async () => {
    await returnBottles(3, 'key-1');

    expect(post).toHaveBeenCalledWith('/refill/return', { quantity: 3 }, { headers: { 'Idempotency-Key': 'key-1' } });
  });
});
