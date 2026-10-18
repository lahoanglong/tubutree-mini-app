// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOgImage } from './og-image-fetch';

const reply = (body: BodyInit, type: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': type, ...extra } });

afterEach(() => vi.unstubAllGlobals());

describe('fetchOgImage', () => {
  it('ảnh png/jpeg hợp lệ thành data URI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(new Uint8Array([1, 2, 3]), 'image/png')));
    expect(await fetchOgImage('https://cdn.x/a.png')).toBe('data:image/png;base64,AQID');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(new Uint8Array([1]), 'image/jpeg; charset=binary')));
    expect(await fetchOgImage('https://cdn.x/a.jpg')).toBe('data:image/jpeg;base64,AQ==');
  });

  it('loại ảnh satori không đọc được (webp, svg, html), lỗi HTTP, ảnh rỗng: bỏ qua', async () => {
    for (const r of [reply('x', 'image/webp'), reply('<svg/>', 'image/svg+xml'), reply('<html/>', 'text/html'), reply('x', 'image/png', 404), reply('', 'image/png')]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(r));
      expect(await fetchOgImage('https://cdn.x/a')).toBeNull();
    }
  });

  it('ảnh quá nặng (khai báo hoặc thực tế): bỏ qua', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('x', 'image/png', 200, { 'content-length': '999999999' })));
    expect(await fetchOgImage('https://cdn.x/a.png', { maxBytes: 100 })).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(new Uint8Array(500), 'image/png')));
    expect(await fetchOgImage('https://cdn.x/a.png', { maxBytes: 100 })).toBeNull();
  });

  it('mất kết nối hoặc quá hạn: không ném lỗi, trả null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await fetchOgImage('https://cdn.x/a.png')).toBeNull();
  });
});
