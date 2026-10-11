import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ getPublicConfig: vi.fn() }));
vi.mock('../services/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../services/shop-api', () => ({ getPublicConfig: mocks.getPublicConfig }));

import { FALLBACK_FAQ, fetchSupportContact } from './about-data';

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

describe('FALLBACK_FAQ sau khi gộp TubuXu vào Điểm Xanh (PD-3)', () => {
  const answer = (q: RegExp) => FALLBACK_FAQ.find((f) => q.test(f.q))?.a ?? '';

  it('câu thanh toán chỉ nêu COD, chuyển khoản, Ví Tubu và dùng Điểm Xanh để giảm giá — không còn TubuXu', () => {
    const a = answer(/thanh toán/);
    expect(a).toContain('Ví Tubu');
    expect(a).toContain('Điểm Xanh');
    expect(a).not.toMatch(/xu/i);
  });

  it('câu Điểm Xanh nói rõ điểm quy đổi từ xu cũ không hết hạn và không đổi được mã giảm giá', () => {
    const a = answer(/Điểm Xanh là gì/);
    expect(a).toContain('xu cũ');
    expect(a).toMatch(/không hết hạn/);
    expect(a).toMatch(/không dùng để đổi mã giảm giá/);
  });
});
