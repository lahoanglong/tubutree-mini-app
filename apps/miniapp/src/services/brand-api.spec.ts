import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('./api', () => ({ api: http }));

import { fetchBrandProducts } from './brand-api';

beforeEach(() => {
  for (const f of Object.values(http)) f.mockReset().mockResolvedValue({ data: { data: [], meta: { page: 2, limit: 20, total: 41 } } });
});

describe('fetchBrandProducts', () => {
  it('phân trang thật: gửi page, limit, sort', async () => {
    const res = await fetchBrandProducts('fuwa', { page: 2, limit: 20, sort: 'newest' });
    expect(http.get).toHaveBeenCalledWith('/brand/public/fuwa/products', { params: { page: 2, limit: 20, sort: 'newest' } });
    expect(res.meta.total).toBe(41);
  });

  it('không gửi tham số không có', async () => {
    await fetchBrandProducts('fuwa', {});
    expect(http.get).toHaveBeenCalledWith('/brand/public/fuwa/products', { params: {} });
  });
});
