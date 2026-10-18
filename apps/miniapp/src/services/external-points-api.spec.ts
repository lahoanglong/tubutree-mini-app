import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ api: { post, get: vi.fn() } }));

import { submitExternalClaim } from './external-points-api';

describe('submitExternalClaim', () => {
  beforeEach(() => post.mockReset());

  it('trả nguyên trạng thái CLAIMED_BY_OTHER (mã đang được tài khoản khác chờ) cho trang quyết chữ', async () => {
    const body = { status: 'CLAIMED_BY_OTHER', claimId: null, channel: null, maskedCode: 'SPX***789', points: null, expectedCreditAt: null, message: 'm' };
    post.mockResolvedValue({ data: body });
    await expect(submitExternalClaim('SPXVN123456789')).resolves.toEqual(body);
    expect(post).toHaveBeenCalledWith('/me/external-points/claims', { code: 'SPXVN123456789' });
  });
});
