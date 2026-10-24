import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SUPPORT, getPublicSupport } from './api';

function res(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Hotline/email ở footer lấy từ GET /config/public (admin đổi được), nhưng footer không bao giờ
// được trống hay làm sập trang chủ khi API hỏng — luôn rơi về thông tin liên hệ mặc định.
describe('getPublicSupport', () => {
  it('mặc định là hotline 0984 606 774 và tubutree@gmail.com', () => {
    expect(DEFAULT_SUPPORT).toEqual({ hotline: '0984 606 774', email: 'tubutree@gmail.com' });
  });

  it('lấy hotline và email admin đã cấu hình', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { support: { hotline: '1900 1234', email: 'cskh@tubutree.com' } }));
    vi.stubGlobal('fetch', f);
    await expect(getPublicSupport()).resolves.toEqual({ hotline: '1900 1234', email: 'cskh@tubutree.com' });
    expect(String(f.mock.calls[0]![0])).toMatch(/\/config\/public$/);
  });

  it('một trường admin để trống (API trả null) thì chỉ trường đó rơi về mặc định', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { support: { hotline: null, email: 'cskh@tubutree.com' } })));
    await expect(getPublicSupport()).resolves.toEqual({ hotline: DEFAULT_SUPPORT.hotline, email: 'cskh@tubutree.com' });
  });

  it('API lỗi 5xx hoặc trả thiếu support thì dùng mặc định', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(503)));
    await expect(getPublicSupport()).resolves.toEqual(DEFAULT_SUPPORT);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, {})));
    await expect(getPublicSupport()).resolves.toEqual(DEFAULT_SUPPORT);
  });

  it('mất kết nối thì dùng mặc định, không ném lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(getPublicSupport()).resolves.toEqual(DEFAULT_SUPPORT);
  });

  it('đọc zaloOaName khi admin đã cấu hình; để trống/không có thì không có trường này', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { support: { hotline: null, email: null, zaloOaName: ' Tubu Tree ' } })));
    await expect(getPublicSupport()).resolves.toMatchObject({ zaloOaName: 'Tubu Tree' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { support: { zaloOaName: '  ' } })));
    expect((await getPublicSupport()).zaloOaName).toBeUndefined();
  });

  it('đọc link kênh cộng đồng: bỏ link rỗng và link không phải https', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        res(200, { community: { zaloGroupUrl: 'https://zalo.me/g/a', facebookUrl: 'http://facebook.com/x', tiktokUrl: null } }),
      ),
    );
    expect((await getPublicSupport()).community).toEqual({ zaloGroupUrl: 'https://zalo.me/g/a' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { community: { eventRewardMaxPoints: 1000 } })));
    expect((await getPublicSupport()).community).toBeUndefined();
  });

  it('đọc thông tin đơn vị vận hành: bỏ trường rỗng, link BCT chỉ nhận https; không có gì thì không có trường company', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { company: { legalName: ' Công ty A ', taxCode: '', address: null, bctNoticeUrl: 'http://x.vn' } })));
    expect((await getPublicSupport()).company).toEqual({ legalName: 'Công ty A' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { company: { taxCode: '0312345678', bctNoticeUrl: 'https://online.gov.vn/x' } })));
    expect((await getPublicSupport()).company).toEqual({ taxCode: '0312345678', bctNoticeUrl: 'https://online.gov.vn/x' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(200, { company: { legalName: null, taxCode: '  ' } })));
    expect((await getPublicSupport()).company).toBeUndefined();
  });
});
