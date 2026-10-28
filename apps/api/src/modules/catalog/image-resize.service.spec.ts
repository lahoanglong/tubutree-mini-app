import { BadGatewayException, BadRequestException, NotFoundException, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
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
import { MAX_SOURCE_BYTES } from './image-resize';

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
const REGISTERED = ['a.jpg', 'a.png', 'big.jpg', 'big2.jpg', 'dns.png', 'bomb.png'].map((n) => `https://content.pancake.vn/${n}`);
const prismaWith = (urls: string[] = REGISTERED) => ({ $queryRaw: jest.fn(async () => urls.map((u) => ({ u }))) });
const make = (own = ownImages(png), prisma = prismaWith()) => ({ svc: new ImageResizeService(own as never, prisma as never), own, prisma });

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

  it('nguồn đúng host nhưng không có trong sản phẩm/nhãn thì 404, không chạm mạng (không thành proxy mở)', async () => {
    const { svc, prisma } = make(ownImages(png), prismaWith([]));
    await expect(svc.get('https://content.pancake.vn/someone-else.jpg', 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    expect(requestMock).not.toHaveBeenCalled();
    expect(readdirSync(dir).length).toBe(0);
    await expect(svc.get('https://content.pancake.vn/someone-else.jpg', 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('1.200 URL lạ cùng lúc chỉ tốn đúng một truy vấn DB (danh sách dùng chung, không tra từng URL)', async () => {
    const { svc, prisma } = make(ownImages(png), prismaWith([]));
    const results = await Promise.allSettled(Array.from({ length: 1200 }, (_, i) => svc.get(`https://content.pancake.vn/x${i}.jpg`, 320, 'webp')));
    expect(results.every((r) => r.status === 'rejected' && r.reason instanceof NotFoundException)).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('không nạp được danh sách ảnh lần đầu thì 503, có danh sách cũ rồi thì dùng tiếp', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValueOnce(new Error('db down')) };
    const { svc } = make(ownImages(png), prisma as never);
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('ảnh của chính API sai ?v= liên tục: quá 30 lần mỗi phút thì 503, không tốn thêm lượt đọc DB', async () => {
    const own = { get: jest.fn(async () => ({ mime: 'image/png', data: png, versionOk: false })) };
    const { svc } = make(own as never);
    for (let i = 0; i < 30; i++) await expect(svc.get(`/public-image/product/p1/0?v=bad${i}`, 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.get('/public-image/product/p1/0?v=bad-last', 320, 'webp')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(own.get).toHaveBeenCalledTimes(30);
  });

  it('ảnh của chính API sai phiên bản (?v=) thì 404, không ghi cache', async () => {
    const own = { get: jest.fn(async () => ({ mime: 'image/png', data: png, versionOk: false })) };
    await expect(make(own).svc.get('/public-image/product/p1/0?v=stale', 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    expect(readdirSync(dir).length).toBe(0);
  });

  it('ảnh nén cực mạnh vượt giới hạn điểm ảnh (decompression bomb) bị từ chối', async () => {
    const bomb = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(MAX_SOURCE_BYTES);
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: bomb });
    await expect(make().svc.get('https://content.pancake.vn/bomb.png', 320, 'webp')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('hàng đợi đầy thì 503, không tải thêm ảnh nguồn', async () => {
    let unblock: () => void = () => undefined;
    const gate = new Promise<void>((r) => (unblock = r));
    const own = { get: jest.fn(async () => { await gate; return { mime: 'image/png', data: png, versionOk: true }; }) };
    const { svc } = make(own as never);
    const calls = Array.from({ length: 4 + 32 }, (_, i) => svc.get(`/public-image/product/q${i}/0`, 160, 'webp'));
    await new Promise((r) => setTimeout(r, 20));
    await expect(svc.get('/public-image/product/over/0', 160, 'webp')).rejects.toBeInstanceOf(ServiceUnavailableException);
    unblock();
    await Promise.all(calls);
  });

  it('trần dung lượng cache: không ghi khi vượt trần, vẫn trả ảnh', async () => {
    process.env.IMAGE_CACHE_MAX_MB = '0.00001';
    const { svc } = make();
    const a = await svc.get('/public-image/product/c1/0', 960, 'jpeg');
    expect(a.data.length).toBeGreaterThan(0);
    const files = readdirSync(dir).flatMap((d) => readdirSync(join(dir, d)));
    expect(files.length).toBe(0);
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

  it('prune: khi vượt trần dọn xuống còn tối đa 80% trần', async () => {
    process.env.IMAGE_CACHE_MAX_MB = '1';
    const { svc } = make();
    const sub = join(dir, 'bb');
    require('node:fs').mkdirSync(sub);
    for (let i = 0; i < 6; i++) {
      const f = join(sub, `f${i}`);
      writeFileSync(f, Buffer.alloc(200 * 1024));
      utimesSync(f, new Date(Date.now() - (10 - i) * 1000), new Date(Date.now() - (10 - i) * 1000));
    }
    const res = await svc.prune();
    expect(res.bytes).toBeLessThanOrEqual(0.8 * 1024 * 1024);
    expect(readdirSync(sub).sort()).toEqual(['f2', 'f3', 'f4', 'f5']);
  });
});
