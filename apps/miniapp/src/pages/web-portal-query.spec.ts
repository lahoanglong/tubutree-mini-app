import { describe, expect, it } from 'vitest';
import { safePortalParams } from './web-portal-query';
import { webPortalUrl } from './web-portal-screens';

const keys = (search: string, fixed?: URLSearchParams) => safePortalParams(search, fixed).map(([k]) => k);

describe('safePortalParams — query nào được đi theo sang website', () => {
  it('giữ query vô hại (khoi, tab, utm) đúng thứ tự và giá trị', () => {
    expect(safePortalParams('?khoi=gian-hang-moi&tab=orders&utm_source=zalo')).toEqual([
      ['khoi', 'gian-hang-moi'],
      ['tab', 'orders'],
      ['utm_source', 'zalo'],
    ]);
  });

  it('nhận cả chuỗi không có dấu ? ở đầu, và chuỗi rỗng cho mảng rỗng', () => {
    expect(safePortalParams('tab=staff')).toEqual([['tab', 'staff']]);
    expect(safePortalParams('')).toEqual([]);
    expect(safePortalParams('?')).toEqual([]);
  });

  it.each(['token', 'code', 'auth', 'secret', 'jwt', 'session'])('chặn khoá nhạy cảm gốc: %s', (key) => {
    expect(keys(`?${key}=abc&tab=ok`)).toEqual(['tab']);
  });

  it.each([
    'Token', 'access_token', 'accessToken', 'id-token', 'refresh_token', 'zaloCode', 'authorization', 'x-auth', 'oauth_code',
    'client_secret', 'JWT', 'sessionId', 'session_id', 'password', 'otp', 'apiKey', 'api_key', 'signature', 'sid', 'bearer',
  ])('chặn biến thể viết hoa, gạch, ghép: %s', (key) => {
    expect(keys(`?${key}=abc`)).toEqual([]);
  });

  it.each(['redirect', 'redirect_uri', 'returnUrl', 'return_to', 'next', 'continue', 'url', 'callback', 'goto'])(
    'chặn khoá điều hướng (chống open redirect): %s',
    (key) => {
      expect(keys(`?${key}=https://evil.example`)).toEqual([]);
    },
  );

  it.each(['callback_url', 'callbackUrl', 'nextUrl', 'next_page', 'targetUrl', 'target_uri', 'successUrl', 'success_link', 'to', 'destination', 'continueTo', 'redirectUri'])(
    'chặn khoá điều hướng ghép tên (tiền tố hoặc đuôi url/uri/link): %s',
    (key) => {
      expect(keys(`?${key}=https://evil.example&tab=ok`)).toEqual(['tab']);
    },
  );

  it.each(['phone', 'Phone', 'phone_number', 'email', 'user_email', 'mail', 'uid', 'userId', 'user_id', 'zaloId', 'zalo_id', 'idByNumber', 'tel', 'mobile', 'sdt'])(
    'chặn khoá thông tin cá nhân: %s',
    (key) => {
      expect(keys(`?${key}=0901234567&tab=ok`)).toEqual(['tab']);
    },
  );

  it('khoá vô hại chứa chữ gần giống không bị chặn nhầm (khoi, tab, kenh, nhom, q)', () => {
    expect(keys('?khoi=a&tab=b&kenh=c&nhom=d&q=e')).toEqual(['khoi', 'tab', 'kenh', 'nhom', 'q']);
  });

  it('bỏ khoá sai khuôn: có khoảng trắng, ngoặc, dấu tiếng Việt, rỗng, quá dài', () => {
    expect(keys(`?a%20b=1&a[]=2&khối=3&=4&${'k'.repeat(33)}=5&ok=6`)).toEqual(['ok']);
  });

  it('bỏ giá trị quá dài, có ký tự điều khiển, hoặc trông như JWT / chuỗi ngẫu nhiên', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij';
    const random = 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC2dE';
    expect(
      keys(`?a=${'x'.repeat(201)}&b=ab%00cd&c=${jwt}&d=${random}&e=${'x'.repeat(200)}&f=ten-san-pham-rat-dai-viet-thuong-khong-dau-gach`),
    ).toEqual(['e', 'f']);
  });

  it('bỏ giá trị hex dài (HMAC, hash) và id ngẫu nhiên chữ thường-số dài (cuid) dù khoá vô hại', () => {
    const hex = 'a3f5c9e1b7d24680a3f5c9e1b7d24680a3f5c9e1b7d24680a3f5c9e1b7d24680';
    const cuid = 'cm3x9k2l40000abcd1234efgh';
    expect(keys(`?h=${hex}&s=${cuid}&k=${hex.toUpperCase()}&tab=ok`)).toEqual(['tab']);
  });

  it('giá trị chữ thường dài không lẫn số (slug, tên) và hex ngắn vẫn đi qua', () => {
    expect(keys('?khoi=thucphamhuuchuaphailaymaunao&q=abc123&tab=ok')).toEqual(['khoi', 'q', 'tab']);
  });

  it('khoá trùng chỉ lấy lần đầu; tối đa 8 khoá', () => {
    expect(safePortalParams('?tab=a&tab=b')).toEqual([['tab', 'a']]);
    const many = Array.from({ length: 12 }, (_, i) => `k${i}=v`).join('&');
    expect(safePortalParams(`?${many}`)).toHaveLength(8);
  });

  it('khoá cố định của trang đích thắng khoá cùng tên từ link ngoài', () => {
    expect(safePortalParams('?tab=orders&khoi=x', new URLSearchParams('tab=community'))).toEqual([['khoi', 'x']]);
  });

  it('không ném lỗi với chuỗi hỏng', () => {
    expect(() => safePortalParams('?%E0%A4%A&x=%')).not.toThrow();
  });
});

describe('webPortalUrl có query', () => {
  it('không có query thì giữ link gốc như W177, thêm stay=web (W42)', () => {
    expect(webPortalUrl('/storefront')).toBe('https://tubutree.com/ctv/gian-hang?stay=web');
    expect(webPortalUrl('/admin/community')).toBe('https://tubutree.com/admin?tab=community&stay=web');
  });

  it('nối query vô hại và bỏ khoá nhạy cảm', () => {
    expect(webPortalUrl('/storefront', '?khoi=gian-hang-moi&token=abc&code=1&session=2')).toBe('https://tubutree.com/ctv/gian-hang?khoi=gian-hang-moi&stay=web');
  });

  it('query cố định của đích đứng trước, khoá trùng bị bỏ, khoá khác đi theo', () => {
    expect(webPortalUrl('/admin/community', '?tab=orders&khoi=x&jwt=eyJ')).toBe('https://tubutree.com/admin?tab=community&khoi=x&stay=web');
  });

  it('mã hoá giá trị, không mang theo dấu # hay khoá lạ qua đường dẫn', () => {
    expect(webPortalUrl('/dealer', '?q=a%20b%26c')).toBe('https://tubutree.com/dai-ly?q=a+b%26c&stay=web');
  });

  it('stay=web chỉ một lần và đứng cuối, kể cả khi link Mini App đã mang stay', () => {
    expect(webPortalUrl('/storefront', '?stay=mini&khoi=x')).toBe('https://tubutree.com/ctv/gian-hang?khoi=x&stay=web');
  });
});
