// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOgImage, isSafeOgImageUrl } from './og-image-fetch';

const reply = (body: BodyInit, type: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': type, ...extra } });

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.tubutree.com/api'));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('fetchOgImage', () => {
  it('ảnh png/jpeg hợp lệ thành data URI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(new Uint8Array([1, 2, 3]), 'image/png')));
    expect(await fetchOgImage('https://res.cloudinary.com/a.png')).toBe('data:image/png;base64,AQID');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(new Uint8Array([1]), 'image/jpeg; charset=binary')));
    expect(await fetchOgImage('https://res.cloudinary.com/a.jpg')).toBe('data:image/jpeg;base64,AQ==');
  });

  it('loại ảnh satori không đọc được (webp, svg, html), lỗi HTTP, ảnh rỗng: bỏ qua', async () => {
    for (const r of [reply('x', 'image/webp'), reply('<svg/>', 'image/svg+xml'), reply('<html/>', 'text/html'), reply('x', 'image/png', 404), reply('', 'image/png')]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(r));
      expect(await fetchOgImage('https://res.cloudinary.com/a')).toBeNull();
    }
  });

  it('ảnh quá nặng (khai báo hoặc thực tế): bỏ qua', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('x', 'image/png', 200, { 'content-length': '999999999' })));
    expect(await fetchOgImage('https://res.cloudinary.com/a.png', { maxBytes: 100 })).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(new Uint8Array(500), 'image/png')));
    expect(await fetchOgImage('https://res.cloudinary.com/a.png', { maxBytes: 100 })).toBeNull();
  });

  it('mất kết nối hoặc quá hạn: không ném lỗi, trả null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    expect(await fetchOgImage('https://res.cloudinary.com/a.png')).toBeNull();
  });
});

describe('fetchOgImage: chống SSRF', () => {
  it.each([
    ['http thường', 'http://res.cloudinary.com/a.png'],
    ['địa chỉ nội bộ giữa các container', 'http://api:3001/storefront/image/s1/avatar'],
    ['https nhưng host nội bộ không nằm trong danh sách', 'https://api:3001/a.png'],
    ['metadata đám mây', 'http://169.254.169.254/latest/meta-data/'],
    ['metadata đám mây qua https', 'https://169.254.169.254/a.png'],
    ['loopback', 'https://127.0.0.1/a.png'],
    ['loopback http', 'http://127.0.0.1:3001/a.png'],
    ['localhost', 'https://localhost/a.png'],
    ['IPv6 loopback', 'https://[::1]/a.png'],
    ['host lạ', 'https://evil.example.com/a.png'],
    ['host giống danh sách nhưng là tên miền con', 'https://res.cloudinary.com.evil.com/a.png'],
    ['kèm user:pass', 'https://user:pw@res.cloudinary.com/a.png'],
    ['không phải URL', 'không phải url'],
    ['đường dẫn tương đối', '/storefront/image/s1/avatar'],
  ])('không tải %s', async (_name, url) => {
    const fetchMock = vi.fn().mockResolvedValue(reply(new Uint8Array([1]), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchOgImage(url)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('host API công khai lấy từ NEXT_PUBLIC_API_BASE_URL được phép, host khác thì không', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(new Uint8Array([1, 2, 3]), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchOgImage('https://api.tubutree.com/api/storefront/image/s1/avatar?v=1')).toBe('data:image/png;base64,AQID');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001/api');
    fetchMock.mockClear();
    expect(await fetchOgImage('https://api.tubutree.com/api/x.png')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('host API là địa chỉ IP nội bộ cũng không được tải dù nằm trong danh sách', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://10.0.0.5/api');
    expect(isSafeOgImageUrl('https://10.0.0.5/api/a.png')).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://192.168.1.10/api');
    expect(isSafeOgImageUrl('https://192.168.1.10/a.png')).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://172.16.0.1/api');
    expect(isSafeOgImageUrl('https://172.16.0.1/a.png')).toBe(false);
  });

  it('không đi theo chuyển hướng: gọi fetch với redirect manual và bỏ ảnh khi nhận 3xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchOgImage('https://res.cloudinary.com/a.png')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });

  it('ảnh vượt trần khi đang tải (không khai content-length): dừng đọc, bỏ ảnh', async () => {
    const chunk = new Uint8Array(60);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
        if (pulled > 50) controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png' } })));
    expect(await fetchOgImage('https://res.cloudinary.com/a.png', { maxBytes: 100 })).toBeNull();
    expect(pulled).toBeLessThan(10);
  });
});
