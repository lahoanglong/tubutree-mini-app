import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import {
  bodyParserErrorHandler,
  BODY_TOO_COMPLEX_MESSAGE,
  BODY_TOO_LARGE_MESSAGE,
  createBodyParsers,
  eventsBodyParser,
  scanRawJson,
  CHARSET_UNSUPPORTED_MESSAGE,
  inspectBody,
  MAX_ARRAY_LENGTH,
  MAX_BODY_DEPTH,
  MAX_BODY_NODES,
  MAX_KEYS_PER_OBJECT,
  NUL_CHAR_MESSAGE,
  privateNoStoreForAuthenticated,
  requestInputGuard,
} from './body-limits';

const bodyOf = async (res: Response) => (await res.json()) as { message?: unknown; statusCode?: number };

/** Cùng thứ tự middleware với bootstrap.ts (events → parser theo nhóm → lỗi parser → guard → no-store). */
function buildApp() {
  const app = express();
  app.use('/api/events', eventsBodyParser());
  app.use(...createBodyParsers(), bodyParserErrorHandler, requestInputGuard);
  app.use(privateNoStoreForAuthenticated);
  app.use((req, res) => {
    if (req.path === '/api/public-cached') res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, keys: Object.keys(req.body ?? {}).length });
  });
  return app;
}

describe('giới hạn thân request (BAOMAT-01, BAOMAT-03, BAOMAT-08)', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = buildApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  describe('quét thô trước JSON.parse (route 10 MB không cần token)', () => {
    const manyKeys = (n: number) => `{${Array.from({ length: n }, (_, i) => `"k${i}":1`).join(',')}}`;
    it.each(['/api/admin/x', '/api/feed', '/api/webhooks/pancake'])('%s: thân hàng trăm nghìn khoá bị loại mà JSON.parse không chạy trên thân đó', async (path) => {
      const raw = manyKeys(path.includes('webhooks') ? 60_000 : 300_000);
      const spy = jest.spyOn(JSON, 'parse');
      try {
        const res = await post(path, raw);
        expect(res.status).toBe(400);
        expect(await bodyOf(res)).toMatchObject({ message: BODY_TOO_COMPLEX_MESSAGE });
        expect(spy.mock.calls.some(([arg]) => typeof arg === 'string' && arg.length > 100_000)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });
    it('thân lồng quá sâu bị loại khi quét thô; dấu ngoặc trong chuỗi không bị tính', async () => {
      expect((await post('/api/admin/x', '['.repeat(40) + ']'.repeat(40))).status).toBe(400);
      expect((await post('/api/admin/x', { s: '{'.repeat(5000) + '[[[[[[[[[[[[[[[[[\\"' })).status).toBe(200);
    });
    it('quét thô bắt thân lồng sâu quá 1024 byte, JSON.parse không chạy', async () => {
      const raw = `{"pad":"${'x'.repeat(2000)}","d":${'['.repeat(40)}${']'.repeat(40)}}`;
      const spy = jest.spyOn(JSON, 'parse');
      try {
        expect((await post('/api/admin/x', raw)).status).toBe(400);
        expect(spy.mock.calls.some(([arg]) => typeof arg === 'string' && arg.length > 2000)).toBe(false);
      } finally {
        spy.mockRestore();
      }
      expect(scanRawJson(Buffer.from('['.repeat(11) + ']'.repeat(11)), 6000, 10)).toBe(false);
      expect(scanRawJson(Buffer.from('['.repeat(10) + ']'.repeat(10)), 6000, 10)).toBe(true);
    });
    it('thân hợp lệ lớn nhất (500 dòng × 5 trường) vẫn qua', async () => {
      const items = Array.from({ length: 500 }, (_, i) => ({ a: i, b: 'x', c: 1, d: true, e: null }));
      expect((await post('/api/admin/x', { items })).status).toBe(200);
    });
  });

  describe('charset khác UTF-8 bị từ chối trước khi giải mã (BAOMAT-01)', () => {
    const utf7 = `{"note":"${'a+ACI-'.repeat(40_000)}"}`;
    const utf16 = Buffer.from(`{"note":"${'a'.repeat(100_000)}"}`, 'utf16le');
    it.each(['/api/feed/posts', '/api/auth/guest', '/api/webhooks/pancake', '/api/events'])('%s: utf-7 → 415 nhanh, không JSON.parse', async (path) => {
      const spy = jest.spyOn(JSON, 'parse');
      const t = Date.now();
      try {
        const res = await post(path, utf7, { 'content-type': 'application/json; charset=utf-7' });
        expect(res.status).toBe(415);
        expect(await bodyOf(res)).toMatchObject({ message: CHARSET_UNSUPPORTED_MESSAGE });
        expect(spy.mock.calls.some(([arg]) => typeof arg === 'string' && arg.length > 100_000)).toBe(false);
      } finally {
        spy.mockRestore();
      }
      expect(Date.now() - t).toBeLessThan(2000);
    });
    it('utf-16le → 415', async () => {
      const res = await post('/api/feed/posts', utf16 as unknown as string, { 'content-type': 'application/json; charset=utf-16le' });
      expect(res.status).toBe(415);
    });
    it('charset=utf-8 (hoa/thường) và không khai báo vẫn qua', async () => {
      expect((await post('/api/feed/posts', { a: 1 }, { 'content-type': 'application/json; charset=UTF-8' })).status).toBe(200);
      expect((await post('/api/feed/posts', { a: 1 })).status).toBe(200);
    });
  });

  describe('trần dung lượng theo nhóm route', () => {
    const big = { note: 'x'.repeat(300_000) };
    it('route thường: thân 300 KB → 413 JSON', async () => {
      const res = await post('/api/auth/guest', big);
      expect(res.status).toBe(413);
      expect(await bodyOf(res)).toMatchObject({ statusCode: 413, message: BODY_TOO_LARGE_MESSAGE });
    });
    it('route thường: thân nhỏ vẫn qua', async () => {
      expect((await post('/api/auth/guest', { deviceId: 'abc' })).status).toBe(200);
    });
    it.each([
      '/api/feed',
      '/api/orders/TUBU1/return-request',
      '/api/products/san-pham-a/reviews',
      '/api/merchant/products',
      '/api/storefront/me',
      '/api/brand/me',
      '/api/dealer/register',
      '/api/staff/shifts/swap',
      '/api/admin/catalog-products',
      '/api/admin/dealer-prices/import',
    ])('route nhận ảnh/CSV %s nhận 300 KB', async (path) => {
      expect((await post(path, big)).status).toBe(200);
    });
    it('route ảnh nhận tới 6 ảnh 1,5M ký tự', async () => {
      const body = { images: Array.from({ length: 6 }, () => 'data:image/png;base64,' + 'A'.repeat(1_500_000)) };
      expect((await post('/api/orders/TUBU1/return-request', body)).status).toBe(200);
    });
    it('webhook nhận tới 1 MB, route thường thì không', async () => {
      const body = { data: 'x'.repeat(800_000) };
      expect((await post('/api/webhooks/pancake', body)).status).toBe(200);
      expect((await post('/api/cart/coupon', body)).status).toBe(413);
    });
    it('/api/events giữ trần 512 KB riêng', async () => {
      expect((await post('/api/events', { data: 'x'.repeat(400_000) })).status).toBe(200);
      expect((await post('/api/events', { data: 'x'.repeat(600_000) })).status).toBe(413);
    });
    it('JSON hỏng → 400 JSON', async () => {
      const res = await post('/api/auth/guest', '{"a":');
      expect(res.status).toBe(400);
      expect(typeof (await bodyOf(res)).message).toBe('string');
    });
  });

  describe('thân quá nhiều khoá/phần tử/tầng lồng', () => {
    const keys = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1]));
    it('1 object 20 000 khoá lạ (~200 KB, mẫu dos1) → 400, không tới pipe', async () => {
      const res = await post('/api/affiliate/click', keys(20_000));
      expect(res.status).toBe(400);
      expect((await bodyOf(res)).message).toBe(BODY_TOO_COMPLEX_MESSAGE);
    });
    it('mảng 20 000 object (mẫu dos2) → 400', async () => {
      expect((await post('/api/auth/guest', Array.from({ length: 20_000 }, () => ({})))).status).toBe(400);
    });
    it('items[30 000] (mẫu dos3) → 400', async () => {
      expect((await post('/api/orders/x/return-estimate', { items: Array.from({ length: 30_000 }, () => 1) })).status).toBe(400);
    });
    it('hợp lệ lớn nhất vẫn qua: 500 dòng × 5 trường', async () => {
      const lines = Array.from({ length: MAX_ARRAY_LENGTH }, (_, i) => ({ a: i, b: 'x', c: 1, d: true, e: null }));
      expect(MAX_ARRAY_LENGTH * 6).toBeLessThanOrEqual(MAX_BODY_NODES);
      expect((await post('/api/admin/waste/gifts', { lines })).status).toBe(200);
    });
    it('webhook nhiều khoá hơn route thường vẫn qua', async () => {
      const nested = Array.from({ length: 400 }, (_, i) => keys(20 + (i % 3)));
      expect((await post('/api/webhooks/pancake', { data: nested })).status).toBe(200);
      expect((await post('/api/cart/coupon', { data: nested })).status).toBe(400);
    });
    it('webhook không bị trần khoá/mảng/tầng của route thường (chỉ trần tổng nút), tránh mất đơn do 400', async () => {
      let deep: unknown = 1;
      for (let i = 0; i < 30; i++) deep = { a: deep };
      expect((await post('/api/webhooks/pancake', { order: deep })).status).toBe(200);
      expect((await post('/api/webhooks/pancake', { order: keys(MAX_KEYS_PER_OBJECT + 50) })).status).toBe(200);
      expect((await post('/api/webhooks/pancake', { items: Array.from({ length: MAX_ARRAY_LENGTH + 100 }, (_, i) => i) })).status).toBe(200);
      expect((await post('/api/cart/coupon', { order: deep })).status).toBe(400);
    });
  });

  describe('ký tự NUL', () => {
    it.each(['/api/products/%00', '/api/products?q=a%00', '/api/products?category=%00', '/api/products/a%00b/reviews'])('GET %s → 400', async (path) => {
      const res = await fetch(base + path);
      expect(res.status).toBe(400);
      expect((await bodyOf(res)).message).toBe(NUL_CHAR_MESSAGE);
    });
    it('\\u0000 trong chuỗi body và trong tên khoá → 400', async () => {
      expect((await post('/api/cart/coupon', { code: 'AB\u0000C' })).status).toBe(400);
      expect((await post('/api/me', { ['a\u0000b']: 1 })).status).toBe(400);
      expect((await post('/api/me', { nested: [{ fullName: '\u0000' }] })).status).toBe(400);
    });
    it('chữ có dấu và %20 không bị chặn nhầm', async () => {
      expect((await fetch(base + '/api/products?q=n%C6%B0%E1%BB%9Bc%20ch%E9n')).status).toBe(200);
      expect((await post('/api/cart/coupon', { code: 'Ưu đãi 😀' })).status).toBe(200);
    });
  });

  describe('Cache-Control cho request có xác thực', () => {
    it('có Authorization → private, no-store', async () => {
      const res = await fetch(base + '/api/me', { headers: { authorization: 'Bearer x' } });
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    });
    it('route công khai tự khai báo cache thì giữ nguyên dù có token', async () => {
      const res = await fetch(base + '/api/public-cached', { headers: { authorization: 'Bearer x' } });
      expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    });
    it('không có Authorization thì không thêm header', async () => {
      const res = await fetch(base + '/api/me');
      expect(res.headers.get('cache-control')).toBeNull();
    });
  });
});

describe('inspectBody', () => {
  it('thân rỗng/nguyên thuỷ → null', () => {
    expect(inspectBody(undefined, MAX_BODY_NODES)).toBeNull();
    expect(inspectBody('x', MAX_BODY_NODES)).toBeNull();
    expect(inspectBody({}, MAX_BODY_NODES)).toBeNull();
  });
  it('trần khoá mỗi object, độ sâu', () => {
    expect(inspectBody(Object.fromEntries(Array.from({ length: MAX_KEYS_PER_OBJECT }, (_, i) => [i, 1])), MAX_BODY_NODES)).toBeNull();
    expect(inspectBody(Object.fromEntries(Array.from({ length: MAX_KEYS_PER_OBJECT + 1 }, (_, i) => [i, 1])), MAX_BODY_NODES)).toBe('complex');
    let deep: unknown = 1;
    for (let i = 0; i < MAX_BODY_DEPTH; i++) deep = { a: deep };
    expect(inspectBody(deep, MAX_BODY_NODES)).toBeNull();
    expect(inspectBody({ a: deep }, MAX_BODY_NODES)).toBe('complex');
  });
  it('thân lồng 100 000 tầng không tràn stack', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i++) deep = [deep];
    expect(inspectBody(deep, MAX_BODY_NODES)).toBe('complex');
  });
});
