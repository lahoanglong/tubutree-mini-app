import type { Request, Response } from 'express';
import {
  REFRESH_COOKIE,
  clearRefreshCookies,
  readCookie,
  readRefreshCookie,
  setRefreshCookies,
  wantsCookieAuth,
} from './refresh-cookie';

function req(headers: Record<string, string | string[]>): Request {
  return { headers } as unknown as Request;
}

function fakeRes() {
  const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  const cleared: { name: string; opts: Record<string, unknown> }[] = [];
  const res = {
    cookie: (name: string, value: string, opts: Record<string, unknown>) => set.push({ name, value, opts }),
    clearCookie: (name: string, opts: Record<string, unknown>) => cleared.push({ name, opts }),
  } as unknown as Response;
  return { res, set, cleared };
}

describe('refresh-cookie', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  describe('readCookie', () => {
    it('đọc đúng cookie giữa nhiều cookie khác', () => {
      expect(readCookie(req({ cookie: 'a=1; tubu_rt=abc; b=2' }), 'tubu_rt')).toBe('abc');
    });

    it('không khớp nhầm cookie có tên là hậu tố', () => {
      expect(readCookie(req({ cookie: 'x_tubu_rt=nham' }), 'tubu_rt')).toBeUndefined();
    });

    it('giải mã percent-encoding', () => {
      expect(readCookie(req({ cookie: 'k=a%20b' }), 'k')).toBe('a b');
    });

    it('không có header cookie → undefined', () => {
      expect(readCookie(req({}), 'tubu_rt')).toBeUndefined();
    });
  });

  describe('wantsCookieAuth', () => {
    it('bật khi x-client: web (không phân biệt hoa thường)', () => {
      expect(wantsCookieAuth(req({ 'x-client': 'WEB' }))).toBe(true);
    });
    it('tắt khi thiếu header — Mini App Zalo không bị đổi hành vi', () => {
      expect(wantsCookieAuth(req({}))).toBe(false);
    });
    it('tắt với client khác', () => {
      expect(wantsCookieAuth(req({ 'x-client': 'miniapp' }))).toBe(false);
    });
  });

  describe('readRefreshCookie — chống CSRF', () => {
    it('có cookie nhưng KHÔNG có header → bỏ qua cookie', () => {
      // Đây là lớp chặn CSRF: request đơn giản từ trang lạ vẫn kèm cookie, nhưng không đặt được
      // header tuỳ biến. Nếu đọc cookie ở đây thì trang lạ ép xoay token được.
      expect(readRefreshCookie(req({ cookie: `${REFRESH_COOKIE}=abc` }))).toBeUndefined();
    });

    it('có cả header lẫn cookie → đọc được', () => {
      expect(readRefreshCookie(req({ 'x-client': 'web', cookie: `${REFRESH_COOKIE}=abc` }))).toBe('abc');
    });

    it('cookie rỗng → undefined (không trả chuỗi rỗng gây 401 khó hiểu)', () => {
      expect(readRefreshCookie(req({ 'x-client': 'web', cookie: `${REFRESH_COOKIE}=` }))).toBeUndefined();
    });
  });

  describe('setRefreshCookies', () => {
    it('cookie token luôn HttpOnly + Path giới hạn /api/auth', () => {
      const { res, set } = fakeRes();
      setRefreshCookies(res, 'tok', 30);
      const rt = set.find((c) => c.name === REFRESH_COOKIE)!;
      expect(rt.value).toBe('tok');
      expect(rt.opts.httpOnly).toBe(true);
      expect(rt.opts.path).toBe('/api/auth');
      expect(rt.opts.maxAge).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('chỉ set ĐÚNG MỘT cookie — không có cookie phụ nào khác', () => {
      // Cờ "có phiên hay không" nằm ở localStorage phía web, KHÔNG phải cookie: cookie do API
      // set thuộc origin của API nên web ở domain khác sẽ không đọc được (bẫy im lặng).
      const { res, set } = fakeRes();
      setRefreshCookies(res, 'tok', 30);
      expect(set.map((c) => c.name)).toEqual([REFRESH_COOKIE]);
    });

    it('SameSite=None bắt buộc kèm Secure, kể cả ngoài production', () => {
      process.env.AUTH_COOKIE_SAMESITE = 'none';
      process.env.NODE_ENV = 'development';
      const { res, set } = fakeRes();
      setRefreshCookies(res, 'tok', 30);
      expect(set[0]!.opts.sameSite).toBe('none');
      expect(set[0]!.opts.secure).toBe(true);
    });

    it('mặc định lax, dev không Secure (nếu không cookie không lưu được trên http://localhost)', () => {
      delete process.env.AUTH_COOKIE_SAMESITE;
      process.env.NODE_ENV = 'development';
      const { res, set } = fakeRes();
      setRefreshCookies(res, 'tok', 30);
      expect(set[0]!.opts.sameSite).toBe('lax');
      expect(set[0]!.opts.secure).toBe(false);
    });

    it('production → Secure kể cả SameSite=lax', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.AUTH_COOKIE_SAMESITE;
      const { res, set } = fakeRes();
      setRefreshCookies(res, 'tok', 30);
      expect(set[0]!.opts.secure).toBe(true);
    });

    it('giá trị AUTH_COOKIE_SAMESITE lạ → rơi về lax, không đẩy giá trị rác vào header', () => {
      process.env.AUTH_COOKIE_SAMESITE = 'banana';
      const { res, set } = fakeRes();
      setRefreshCookies(res, 'tok', 30);
      expect(set[0]!.opts.sameSite).toBe('lax');
    });

    it('AUTH_COOKIE_DOMAIN được truyền xuống; bỏ trống thì không set domain', () => {
      process.env.AUTH_COOKIE_DOMAIN = '.tubutree.com';
      const a = fakeRes();
      setRefreshCookies(a.res, 'tok', 30);
      expect(a.set[0]!.opts.domain).toBe('.tubutree.com');

      delete process.env.AUTH_COOKIE_DOMAIN;
      const b = fakeRes();
      setRefreshCookies(b.res, 'tok', 30);
      expect('domain' in b.set[0]!.opts).toBe(false);
    });
  });

  describe('clearRefreshCookies', () => {
    it('xoá token đúng path đã set (sai path là cookie không chết)', () => {
      const { res, cleared } = fakeRes();
      clearRefreshCookies(res);
      expect(cleared.map((c) => c.name)).toEqual([REFRESH_COOKIE]);
      expect(cleared[0]!.opts.path).toBe('/api/auth');
    });
  });
});
