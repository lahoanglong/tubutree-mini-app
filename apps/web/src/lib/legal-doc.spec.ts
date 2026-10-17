import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiUnavailableError, getLegalDoc } from './api';
import { DEFAULT_LEGAL_VARS } from './legal';

function res(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getLegalDoc — nội dung chính sách do admin nhập (D5-01)', () => {
  it('gọi GET /config/legal/<loại> và trả nội dung + biến', async () => {
    const f = vi.fn().mockResolvedValue(
      res(200, { loai: 'doi-tra', content: '## 1. Đổi trả', vars: { returnWindowDays: 10, freeshipThreshold: 300000 } }),
    );
    vi.stubGlobal('fetch', f);
    await expect(getLegalDoc('doi-tra')).resolves.toEqual({
      content: '## 1. Đổi trả',
      vars: { returnWindowDays: 10, freeshipThreshold: 300000 },
    });
    expect(String(f.mock.calls[0]![0])).toMatch(/\/config\/legal\/doi-tra$/);
  });

  it('admin chưa nhập (content null) → content null để trang dùng bản nháp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { loai: 'bao-mat', content: null, vars: DEFAULT_LEGAL_VARS })));
    await expect(getLegalDoc('bao-mat')).resolves.toEqual({ content: null, vars: DEFAULT_LEGAL_VARS });
  });

  it('API bản cũ chưa có endpoint (404) → coi như chưa nhập, dùng biến mặc định', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404, { message: 'Not Found' })));
    await expect(getLegalDoc('dieu-khoan')).resolves.toEqual({ content: null, vars: DEFAULT_LEGAL_VARS });
  });

  it('biến bằng 0 là hợp lệ (freeship mọi đơn, hạn đổi trả 0): giữ nguyên, không rơi về mặc định', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { content: null, vars: { returnWindowDays: 0, freeshipThreshold: 0 } })));
    await expect(getLegalDoc('van-chuyen')).resolves.toEqual({ content: null, vars: { returnWindowDays: 0, freeshipThreshold: 0 } });
  });

  it('biến âm → rơi về mặc định', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { vars: { returnWindowDays: -1, freeshipThreshold: -5 } })));
    await expect(getLegalDoc('van-chuyen')).resolves.toEqual({ content: null, vars: DEFAULT_LEGAL_VARS });
  });

  it('biến thiếu/sai kiểu → rơi về mặc định từng biến; content sai kiểu hoặc trắng → null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res(200, { content: 42, vars: { returnWindowDays: 'abc', freeshipThreshold: 150000 } })),
    );
    await expect(getLegalDoc('van-chuyen')).resolves.toEqual({
      content: null,
      vars: { returnWindowDays: DEFAULT_LEGAL_VARS.returnWindowDays, freeshipThreshold: 150000 },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { content: '  \n ' })));
    expect((await getLegalDoc('van-chuyen')).content).toBeNull();
  });

  it('lỗi tạm thời (5xx, mất kết nối) → ném ApiUnavailableError để ISR giữ bản đã render, không thay bằng bản nháp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(503)));
    await expect(getLegalDoc('doi-tra')).rejects.toBeInstanceOf(ApiUnavailableError);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(getLegalDoc('doi-tra')).rejects.toBeInstanceOf(ApiUnavailableError);
  });
});
