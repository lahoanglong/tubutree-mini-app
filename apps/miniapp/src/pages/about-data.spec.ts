import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ getPublicConfig: vi.fn() }));
vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../services/shop-api', () => ({ getPublicConfig: mocks.getPublicConfig }));

import { fetchSupportContact } from './about-data';

describe('fetchSupportContact (Q-17: liên hệ đọc từ /config/public, dòng chưa có giá trị thì ẩn)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('đọc hotline/email/Zalo OA từ khoá support của /config/public', async () => {
    mocks.getPublicConfig.mockResolvedValue({
      support: { hotline: '0899 149 229', email: 'tubutree@gmail.com', zaloOaName: 'Tubu Tree' },
    });
    expect(await fetchSupportContact()).toEqual({
      hotline: '0899 149 229',
      email: 'tubutree@gmail.com',
      zaloOaName: 'Tubu Tree',
    });
  });

  it('chuỗi toàn khoảng trắng hoặc sai kiểu coi như chưa có (null), giá trị thật được cắt khoảng trắng', async () => {
    mocks.getPublicConfig.mockResolvedValue({
      support: { hotline: '  0899 149 229 ', email: '   ', zaloOaName: 42 },
    });
    expect(await fetchSupportContact()).toEqual({ hotline: '0899 149 229', email: null, zaloOaName: null });
  });

  it('API cũ chưa có khoá support → cả ba null, không ném lỗi', async () => {
    mocks.getPublicConfig.mockResolvedValue({ freeshipThreshold: 200000 });
    expect(await fetchSupportContact()).toEqual({ hotline: null, email: null, zaloOaName: null });
  });
});
