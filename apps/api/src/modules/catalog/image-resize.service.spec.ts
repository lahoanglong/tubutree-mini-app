import { BadGatewayException, BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const requestMock = jest.fn();
jest.mock('node:https', () => ({ request: (...args: unknown[]) => requestMock(...args) }));
const lookupMock = jest.fn();
jest.mock('node:dns', () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

import { ImageResizeService } from './image-resize.service';

let dir: string;
let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2e7d32' } }).png().toBuffer();
});
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'img-resize-spec-'));
  process.env.IMAGE_CACHE_DIR = dir;
  requestMock.mockReset();
  lookupMock.mockReset();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.IMAGE_CACHE_DIR;
  delete process.env.IMAGE_CACHE_MAX_MB;
});

const ownImages = (data: Buffer | null) => ({ get: jest.fn(async () => (data ? { mime: 'image/png', data, versionOk: true } : Promise.reject(new NotFoundException()))) });
const make = (own = ownImages(png)) => ({ svc: new ImageResizeService(own as never), own });

/** Phản hồi giả của https.request: gọi callback với res rồi phát dữ liệu. */
function fakeHttps(res: { status: number; headers?: Record<string, string>; body?: Buffer }) {
  requestMock.mockImplementation((_url: unknown, _opts: unknown, cb: (r: EventEmitter & { statusCode: number; headers: Record<string, string>; resume: () => void }) => void) => {
    const req = Object.assign(new EventEmitter(), { end: () => {
      const r = Object.assign(new EventEmitter(), { statusCode: res.status, headers: res.headers ?? {}, resume: () => undefined });
      cb(r);
      if (res.body) r.emit('data', res.body);
      r.emit('end');
    }, destroy: jest.fn() });
    return req;
  });
}

describe('ImageResizeService', () => {
  it('ảnh mẫu: đổi về đúng bề rộng webp, ghi cache, lần sau đọc từ đĩa', async () => {
    const { svc, own } = make();
    const src = '/public-image/product/p1/thumb?v=abc';
    const out = await svc.get(src, 320, 'webp');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(320);
    expect(out.data.length).toBeLessThan(png.length);
    expect(out.mime).toBe('image/webp');
    expect(out.etag).toBe(`"${svc.keyFor(src, 320, 'webp')}"`);
    expect(readdirSync(dir).length).toBe(1);
    const again = await svc.get(src, 320, 'webp');
    expect(again.data.equals(out.data)).toBe(true);
    expect(own.get).toHaveBeenCalledTimes(1);
  });

  it('không phóng to ảnh nhỏ hơn bề rộng xin', async () => {
    const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
    const { svc } = make(ownImages(small));
    expect((await sharp((await svc.get('/public-image/product/p2/0', 640, 'jpeg')).data).metadata()).width).toBe(100);
  });

  it('hai request cùng lúc dùng chung một lần xử lý', async () => {
    const { svc, own } = make();
    const src = '/public-image/product/p3/0';
    await Promise.all([svc.get(src, 160, 'webp'), svc.get(src, 160, 'webp')]);
    expect(own.get).toHaveBeenCalledTimes(1);
  });

  it('bề rộng ngoài danh sách và nguồn lạ bị từ chối trước khi chạm mạng', async () => {
    const { svc } = make();
    await expect(svc.get('/public-image/product/p1/0', 500, 'webp')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.get('https://evil.example.com/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.get('https://127.0.0.1/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(BadRequestException);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('chuyển hướng không được theo: 3xx là lỗi', async () => {
    fakeHttps({ status: 302, headers: { location: 'http://169.254.169.254/' } });
    await expect(make().svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('ảnh nguồn quá lớn (khai báo hoặc thực tế) bị từ chối', async () => {
    fakeHttps({ status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(50 * 1024 * 1024) } });
    await expect(make().svc.get('https://content.pancake.vn/big.jpg', 320, 'webp')).rejects.toBeInstanceOf(PayloadTooLargeException);
    fakeHttps({ status: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.alloc(9 * 1024 * 1024) });
    await expect(make().svc.get('https://content.pancake.vn/big2.jpg', 320, 'webp')).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('nguồn không phải ảnh bị từ chối', async () => {
    fakeHttps({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>') });
    await expect(make().svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('tải ảnh từ host cho phép và đổi cỡ', async () => {
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    const out = await make().svc.get('https://content.pancake.vn/a.png', 160, 'jpeg');
    expect((await sharp(out.data).metadata()).width).toBe(160);
    const [url, opts] = requestMock.mock.calls[0] as [URL, { lookup: unknown }];
    expect(url.hostname).toBe('content.pancake.vn');
    expect(typeof opts.lookup).toBe('function');
  });

  it('bước phân giải DNS chặn địa chỉ nội bộ (cả dạng all: true) và cho qua địa chỉ công cộng', async () => {
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    await make().svc.get('https://content.pancake.vn/dns.png', 160, 'webp');
    const lookup = (requestMock.mock.calls[0] as [unknown, { lookup: (h: string, o: object, cb: (...a: unknown[]) => void) => void }])[1].lookup;
    const run = (addresses: unknown) =>
      new Promise<unknown[]>((resolve) => {
        lookupMock.mockImplementation((_h: string, _o: object, cb: (...a: unknown[]) => void) => cb(null, addresses, 4));
        lookup('content.pancake.vn', { all: true }, (...a: unknown[]) => resolve(a));
      });
    expect((await run([{ address: '127.0.0.1', family: 4 }]))[0]).toBeInstanceOf(Error);
    expect((await run('10.0.0.5'))[0]).toBeInstanceOf(Error);
    const ok = await run([{ address: '10.0.0.5', family: 4 }, { address: '8.8.8.8', family: 4 }]);
    expect(ok[0]).toBeNull();
    expect(ok[1]).toEqual([{ address: '8.8.8.8', family: 4 }]);
  });

  it('ảnh của chính API không có thì 404, không ghi cache', async () => {
    await expect(make(ownImages(null)).svc.get('/public-image/product/zz/0', 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    expect(readdirSync(dir).length).toBe(0);
  });

  it('prune: xoá file quá 14 ngày và xoá file cũ nhất khi vượt trần dung lượng', async () => {
    process.env.IMAGE_CACHE_MAX_MB = '1';
    const { svc } = make();
    const sub = join(dir, 'aa');
    require('node:fs').mkdirSync(sub);
    const old = join(sub, 'old');
    writeFileSync(old, 'x');
    const longAgo = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    utimesSync(old, longAgo, longAgo);
    const a = join(sub, 'a');
    const b = join(sub, 'b');
    writeFileSync(a, Buffer.alloc(700 * 1024));
    writeFileSync(b, Buffer.alloc(700 * 1024));
    utimesSync(a, new Date(Date.now() - 5000), new Date(Date.now() - 5000));
    const res = await svc.prune();
    expect(res.removed).toBe(2);
    expect(readdirSync(sub)).toEqual(['b']);
  });
});
