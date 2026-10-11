import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ api: { post: vi.fn() } }));

import { api } from './api';
import { buyTree } from './game-api';

const post = vi.mocked(api.post);

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ data: { certificateCode: 'TUBU-1' } });
});

describe('buyTree — góp quỹ trồng cây', () => {
  it('gửi Idempotency-Key ở header, không kèm body', async () => {
    const r = await buyTree('0b7e9c1e-5f0a-4d6e-9c2b-3a1f2d4e5f60');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/game/tree/buy', undefined, {
      headers: { 'Idempotency-Key': '0b7e9c1e-5f0a-4d6e-9c2b-3a1f2d4e5f60' },
    });
    expect(r).toEqual({ certificateCode: 'TUBU-1' });
  });
});
