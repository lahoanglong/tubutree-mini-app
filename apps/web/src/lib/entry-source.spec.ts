// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENTRY_TOKEN_PATTERN,
  FIRST_TOUCH_COOKIE,
  captureFirstTouch,
  normalizeEntryToken,
  parseEntryParams,
  readFirstTouchCookie,
} from './entry-source';

const parse = (qs: string, pathname = '/') => parseEntryParams(new URLSearchParams(qs), pathname);

describe('normalizeEntryToken', () => {
  it.each([
    ['shopee', 'shopee'],
    ['  Shopee ', 'shopee'],
    ['card-2610', 'card-2610'],
    ['x'.repeat(40), 'x'.repeat(40)],
  ])('%j → %j', (raw, out) => {
    expect(normalizeEntryToken(raw)).toBe(out);
  });

  it.each([[''], ['  '], ['-x'], ['x'.repeat(41)], ['a b'], ['sàn'], ['<b>'], ['a;b'], [null], [undefined]])(
    'giá trị bẩn %j → undefined',
    (raw) => {
      expect(normalizeEntryToken(raw)).toBeUndefined();
    },
  );

  it('khuôn trùng với API và miniapp', () => {
    expect(ENTRY_TOKEN_PATTERN.source).toBe('^[a-z0-9][a-z0-9_-]{0,39}$');
  });
});

describe('parseEntryParams', () => {
  it.each(['shopee', 'lazada', 'tiktok', 'fb', 'oa', 'linkbio', 'ctv', 'card-2610'])('src=%s', (src) => {
    expect(parse(`src=${src}`)?.source).toBe(src);
  });

  it('utm_source/utm_medium/utm_campaign khi không có src', () => {
    expect(parse('utm_source=facebook&utm_medium=social&utm_campaign=live-1026')).toEqual({
      source: 'facebook',
      medium: 'social',
      campaign: 'live-1026',
    });
  });

  it('src thắng utm_source', () => {
    expect(parse('src=shopee&utm_source=facebook')?.source).toBe('shopee');
  });

  it('card=<đợt> → card-<đợt>; đi cùng src thì thành chiến dịch', () => {
    expect(parse('card=2610')?.source).toBe('card-2610');
    expect(parse('card=card-2610')?.source).toBe('card-2610');
    expect(parse('src=shopee&card=2610')).toEqual({ source: 'shopee', campaign: 'card-2610' });
  });

  it('trang gian hàng /s/<slug> không có src → ctv; chỉ có ?ref= → ref', () => {
    expect(parse('', '/s/lan-shop')?.source).toBe('ctv');
    expect(parse('ref=ABCD1234')?.source).toBe('ref');
    expect(parse('src=oa&ref=ABCD1234', '/s/lan-shop')?.source).toBe('oa');
  });

  it('link CTV tạo (?ref=&l=) → ctv; src vẫn thắng', () => {
    expect(parse('ref=ABCD1234&l=aB3_x-9')?.source).toBe('ctv');
    expect(parse('src=oa&l=aB3_x-9')?.source).toBe('oa');
    expect(parse('ref=ABCD1234&l=a b')?.source).toBe('ref');
  });

  it.each([[''], ['utm_campaign=x'], ['src='], ['src=a b'], ['src=<script>'], ['card=%20'], ['ref=a b']])(
    'không có nguồn dùng được (%s) → null',
    (qs) => {
      expect(parse(qs)).toBeNull();
    },
  );

  it('chiến dịch/medium bẩn → bỏ riêng chúng, giữ nguồn', () => {
    expect(parse('src=fb&utm_campaign=a b&utm_medium=<b>')).toEqual({ source: 'fb' });
  });

  it('/ngoai-s/ hay /san-pham/s/ không bị nhầm là gian hàng', () => {
    expect(parse('', '/san-pham/s/x')).toBeNull();
    expect(parse('', '/sx/lan')).toBeNull();
  });
});

describe('gian hàng mở bằng subdomain (middleware rewrite, trình duyệt thấy pathname "/")', () => {
  const parseHost = (qs: string, host: string, pathname = '/') => parseEntryParams(new URLSearchParams(qs), pathname, host);

  it.each([['ctv-an.tubutree.com'], ['ctv-an.tubutree.com:3000'], ['ctv-an.localhost:3000']])('%s → nguồn ctv', (host) => {
    expect(parseHost('', host)?.source).toBe('ctv');
  });

  it('subdomain gian hàng ở trang con cũng là khách của gian hàng đó', () => {
    expect(parseHost('', 'ctv-an.tubutree.com', '/san-pham/a')?.source).toBe('ctv');
  });

  it('src rõ ràng vẫn thắng; chiến dịch và medium vẫn được giữ', () => {
    expect(parseHost('src=fb&utm_campaign=live-1026', 'ctv-an.tubutree.com')).toEqual({ source: 'fb', campaign: 'live-1026' });
  });

  it.each([['app.tubutree.com'], ['www.tubutree.com'], ['admin.tubutree.com'], ['tubutree.com'], ['localhost:3000'], ['']])(
    '%s (host thường hoặc subdomain hệ thống) → không tự suy ra nguồn',
    (host) => {
      expect(parseHost('', host)).toBeNull();
    },
  );

  it.each([['192.168.1.5'], ['192.168.1.5:3000'], ['10.0.0.12']])('địa chỉ IP %s không phải subdomain gian hàng', (host) => {
    expect(parseHost('', host)).toBeNull();
  });
});

describe('cookie chạm đầu (30 ngày)', () => {
  const NOW = new Date('2026-10-18T05:00:00.000Z');
  const at = (search: string, pathname = '/', host = 'app.tubutree.com') => ({ search, pathname, protocol: 'https:', host }) as Location;
  const clear = () => {
    document.cookie = `${FIRST_TOUCH_COOKIE}=; path=/; max-age=0`;
  };
  beforeEach(clear);
  afterEach(() => {
    clear();
    vi.restoreAllMocks();
  });

  it('lần đầu có nguồn → ghi cookie, đọc lại được đủ nguồn/chiến dịch/giờ', () => {
    captureFirstTouch(at('?src=shopee&utm_campaign=card-2610'), NOW);
    expect(readFirstTouchCookie()).toEqual({ source: 'shopee', campaign: 'card-2610', at: NOW.toISOString() });
  });

  it('đã có cookie → KHÔNG ghi đè dù lần vào sau mang nguồn khác', () => {
    captureFirstTouch(at('?src=oa'), NOW);
    captureFirstTouch(at('?src=tiktok'), new Date(NOW.getTime() + 86_400_000));
    expect(readFirstTouchCookie()).toMatchObject({ source: 'oa', at: NOW.toISOString() });
  });

  it('vào trang trần (không nguồn) → không ghi gì; lần quét thẻ sau mới là chạm đầu', () => {
    captureFirstTouch(at(''), NOW);
    expect(readFirstTouchCookie()).toBeUndefined();
    captureFirstTouch(at('?card=2610'), NOW);
    expect(readFirstTouchCookie()?.source).toBe('card-2610');
  });

  it('khách mở gian hàng bằng subdomain (đường dẫn "/") → cookie ghi nguồn ctv', () => {
    captureFirstTouch(at('', '/', 'ctv-an.tubutree.com'), NOW);
    expect(readFirstTouchCookie()).toMatchObject({ source: 'ctv', at: NOW.toISOString() });
  });

  it('cookie có thời hạn 30 ngày, path=/, SameSite=Lax (đọc bằng JS để gửi kèm đăng nhập)', () => {
    const set = vi.spyOn(document, 'cookie', 'set');
    captureFirstTouch(at('?src=shopee'), NOW);
    const written = String(set.mock.calls[0]![0]);
    expect(written).toContain(`${FIRST_TOUCH_COOKIE}=`);
    expect(written).toContain('max-age=2592000');
    expect(written).toContain('path=/');
    expect(written).toContain('SameSite=Lax');
    expect(written).toContain('Secure');
    expect(written).not.toContain('HttpOnly');
  });

  it.each([
    ['không phải JSON', 'abc'],
    ['nguồn sai khuôn', encodeURIComponent(JSON.stringify({ source: 'a b' }))],
    ['thiếu nguồn', encodeURIComponent(JSON.stringify({ at: NOW.toISOString() }))],
  ])('cookie bẩn (%s) → bỏ', (_label, raw) => {
    document.cookie = `${FIRST_TOUCH_COOKIE}=${raw}; path=/`;
    expect(readFirstTouchCookie()).toBeUndefined();
  });
});
