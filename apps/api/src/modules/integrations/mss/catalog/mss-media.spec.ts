import { mssMediaHosts, parseMssMediaUrl } from './mss-media';

describe('mssMediaHosts', () => {
  it('host của MSS_BASE_URL cộng MSS_MEDIA_HOSTS hợp lệ; bỏ IP, localhost và chuỗi sai', () => {
    const env = { MSS_BASE_URL: 'https://MSS.Example.test/', MSS_MEDIA_HOSTS: 'cdn.example.test, 10.0.0.1 ,bad host,localhost' } as unknown as NodeJS.ProcessEnv;
    expect(mssMediaHosts(env)).toEqual(['mss.example.test', 'cdn.example.test']);
  });

  it('thiếu MSS_BASE_URL: không host nào (kể cả dữ liệu đã lưu cũng không qua được)', () => {
    expect(mssMediaHosts({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('MSS giả http://localhost lúc phát triển không phải host media', () => {
    expect(mssMediaHosts({ MSS_BASE_URL: 'http://localhost:4000', NODE_ENV: 'development' } as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });
});

describe('parseMssMediaUrl', () => {
  const hosts = ['mss.example.test'];
  it.each([
    ['https://mss.example.test/api/pub/media/9f00aa11e2.webp', 'https://mss.example.test/api/pub/media/9f00aa11e2.webp'],
    ['https://mss.example.test/api/pub/catalog-media/9f00aa11e2-800.webp', 'https://mss.example.test/api/pub/catalog-media/9f00aa11e2-800.webp'],
    ['https://mss.example.test/api/pub/media/77aa00bbcc.mp4#t=1', 'https://mss.example.test/api/pub/media/77aa00bbcc.mp4'],
  ])('nhận %s', (raw, out) => {
    expect(parseMssMediaUrl(raw, hosts)).toBe(out);
  });

  it.each([
    'http://mss.example.test/api/pub/media/9f00aa11e2.webp',
    'https://evil.test/api/pub/media/9f00aa11e2.webp',
    'https://mss.example.test:8443/api/pub/media/9f00aa11e2.webp',
    'https://u:p@mss.example.test/api/pub/media/9f00aa11e2.webp',
    'https://mss.example.test/api/pub/media/../../etc/passwd',
    'https://mss.example.test/api/pub/media/a%2f..%2fb.webp',
    'https://mss.example.test/api/pub/media/sub/9f00aa11e2.webp',
    'https://mss.example.test/api/pub/media/9f00aa11e2.svg',
    'https://mss.example.test/other/9f00aa11e2.webp',
    'https://mss.example.test/api/pub/media/9f00aa11e2.webp?x=1',
    'javascript:alert(1)',
    '//mss.example.test/api/pub/media/9f00aa11e2.webp',
    'https://127.0.0.1/api/pub/media/9f00aa11e2.webp',
  ])('loại %s', (raw) => {
    expect(parseMssMediaUrl(raw, [...hosts, '127.0.0.1'])).toBeNull();
  });

  it('?token= chỉ cho bản xem trước, và chỉ đúng một tham số đó', () => {
    const u = 'https://mss.example.test/api/pub/catalog-media/9f00aa11e2.webp?token=abcdefghijklmnop.qrst';
    expect(parseMssMediaUrl(u, hosts)).toBeNull();
    expect(parseMssMediaUrl(u, hosts, { allowPreviewToken: true })).toBe(u);
    expect(parseMssMediaUrl(`${u}&x=1`, hosts, { allowPreviewToken: true })).toBeNull();
  });
});
