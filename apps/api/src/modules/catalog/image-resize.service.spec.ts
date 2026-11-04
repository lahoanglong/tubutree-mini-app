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
import { ImageRegistryStale } from './image-registry-stale';
import { MAX_SOURCE_BYTES, RESIZE_PIPELINE_VERSION, cacheKey } from './image-resize';

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
const make = (own = ownImages(png), prisma = prismaWith()) => ({ svc: new ImageResizeService(own as never, prisma as never, new ImageRegistryStale()), own, prisma });

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
    const key = svc.keyFor(src, 320, 'webp') as string;
    writeFileSync(join(dir, key.slice(0, 2), key), 'tu-dia');
    const again = await svc.get(src, 320, 'webp');
    expect(again.data.toString()).toBe('tu-dia');
    expect(again.etag).toBe(out.etag);
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

  it('ảnh nguồn đã bị gỡ khỏi danh sách (gian hàng bị gỡ, đổi ảnh) thì 404 dù bản đổi cỡ còn trong cache đĩa; ảnh của chính API không bị ảnh hưởng', async () => {
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    const url = 'https://content.pancake.vn/a.png';
    await make().svc.get(url, 160, 'jpeg');
    expect(readdirSync(dir).length).toBe(1);
    await expect(make(undefined, prismaWith([])).svc.get(url, 160, 'jpeg')).rejects.toBeInstanceOf(NotFoundException);
    const own = make();
    await own.svc.get('/public-image/product/p1/thumb?v=abc', 160, 'jpeg');
    await expect(make(undefined, prismaWith([])).svc.get('/public-image/product/p1/thumb?v=abc', 160, 'jpeg')).resolves.toBeDefined();
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

  it('ảnh vừa thêm vào sản phẩm: URL chưa có trong danh sách thì nạp lại một lần sau 30 giây, không nạp lại mỗi request', async () => {
    const rows: string[][] = [[], ['https://content.pancake.vn/a.jpg']];
    let call = 0;
    const prisma = { $queryRaw: jest.fn(async () => (rows[Math.min(call++, 1)] ?? []).map((u) => ({ u }))) };
    const { svc } = make(ownImages(png), prisma as never);
    const now = jest.spyOn(Date, 'now');
    const t0 = 1_000_000;
    now.mockReturnValue(t0);
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    now.mockReturnValue(t0 + 10_000);
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    now.mockReturnValue(t0 + 31_000);
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).resolves.toBeDefined();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('admin lưu ảnh: URL mới có ngay, không đợi 5 phút hay 30 giây', async () => {
    const rows: string[][] = [[], ['https://content.pancake.vn/a.jpg']];
    let call = 0;
    const prisma = { $queryRaw: jest.fn(async () => (rows[Math.min(call++, 1)] ?? []).map((u) => ({ u }))) };
    const { svc } = make(ownImages(png), prisma as never);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    svc.invalidateRegistry();
    now.mockReturnValue(1_002_000);
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).resolves.toBeDefined();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('không nạp được danh sách ảnh lần đầu thì 503, có danh sách cũ rồi thì dùng tiếp', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValueOnce(new Error('db down')) };
    const { svc } = make(ownImages(png), prisma as never);
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('một IP gửi sai ?v= quá 30 lần mỗi phút thì bị 503, không tốn thêm lượt đọc DB', async () => {
    const own = { get: jest.fn(async () => ({ mime: 'image/png', data: png, versionOk: false })) };
    const { svc } = make(own as never);
    for (let i = 0; i < 30; i++) await expect(svc.get(`/public-image/product/p1/0?v=bad${i}`, 320, 'webp', '1.1.1.1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.get('/public-image/product/p1/0?v=badlast', 320, 'webp', '1.1.1.1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(own.get).toHaveBeenCalledTimes(30);
  });

  it('IP khác vẫn xem được ảnh hợp lệ khi một IP đã bị chặn vì sai ?v=', async () => {
    const own = { get: jest.fn(async (_k: string, id: string) => ({ mime: 'image/png', data: png, versionOk: id !== 'bad' })) };
    const { svc } = make(own as never);
    for (let i = 0; i < 30; i++) await expect(svc.get(`/public-image/product/bad/0?v=x${i}`, 320, 'webp', '1.1.1.1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.get('/public-image/product/bad/0?v=y', 320, 'webp', '1.1.1.1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    const ok = await svc.get('/public-image/product/good/0?v=ok', 320, 'webp', '2.2.2.2');
    expect(ok.data.length).toBeGreaterThan(0);
  });

  it('ảnh hợp lệ không bao giờ tính vào hạn mức sai ?v=', async () => {
    const { svc } = make();
    for (let i = 0; i < 40; i++) await svc.get(`/public-image/product/g${i}/0?v=ok`, 160, 'webp', '3.3.3.3');
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

  it('writeCache: ảnh mới không vừa trần thì dọn xuống 80% rồi ghi (đúng đường get)', async () => {
    process.env.IMAGE_CACHE_MAX_MB = '1';
    const sub = join(dir, 'cc');
    require('node:fs').mkdirSync(sub);
    for (let i = 0; i < 4; i++) {
      const f = join(sub, `f${i}`);
      writeFileSync(f, Buffer.alloc(262_140));
      utimesSync(f, new Date(Date.now() - (10 - i) * 1000), new Date(Date.now() - (10 - i) * 1000));
    }
    const { svc } = make();
    const out = await svc.get('/public-image/product/w1/0', 960, 'jpeg');
    const names = readdirSync(sub);
    expect(names).not.toContain('f0');
    expect(names).toContain('f3');
    const all = readdirSync(dir).flatMap((d) => readdirSync(join(dir, d)).map((n) => join(dir, d, n)));
    const total = all.reduce((s, f) => s + require('node:fs').statSync(f).size, 0);
    expect(all.some((f) => f.endsWith(out.etag.slice(1, -1)))).toBe(true);
    expect(total).toBeLessThanOrEqual(1024 * 1024);
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

describe('ImageResizeService — cache ở volume bền qua lần dựng lại container (deploy)', () => {
  it('tiến trình mới trên cùng thư mục phát bản đã đổi cỡ từ đĩa, không tải lại ảnh nguồn', async () => {
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    lookupMock.mockImplementation((_h: string, _o: unknown, cb: (e: null, a: string, f: number) => void) => cb(null, '1.1.1.1', 4));
    const src = 'https://content.pancake.vn/a.png';
    const out = await make().svc.get(src, 480, 'webp');
    expect(requestMock).toHaveBeenCalledTimes(1);
    const restarted = make();
    const again = await restarted.svc.get(src, 480, 'webp');
    expect(again.data.equals(out.data)).toBe(true);
    expect(again.etag).toBe(out.etag);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('ảnh của chính API còn trong cache nhưng không còn công khai hoặc đã thay (sai ?v=) thì 404, không phát bản cũ', async () => {
    const src = '/public-image/product/v2/0?v=abc';
    await make().svc.get(src, 480, 'webp');
    expect(readdirSync(dir).length).toBe(1);
    const stale = { get: jest.fn(async () => ({ mime: 'image/png', data: png, versionOk: false })) };
    await expect(make(stale as never).svc.get(src, 480, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    await expect(make(ownImages(null)).svc.get(src, 480, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    const live = make();
    const ok = await live.svc.get(src, 480, 'webp');
    expect((await sharp(ok.data).metadata()).width).toBe(480);
    expect(live.own.get).toHaveBeenCalledTimes(1);
  });

  it('ảnh của API đã xác nhận: 60 giây sau kiểm lại DB, ảnh đã bị gỡ thì 404 dù còn trong cache', async () => {
    const src = '/public-image/brand/b1/logo?v=abc';
    const own = { get: jest.fn(async () => ({ mime: 'image/png', data: png, versionOk: true })) };
    const { svc } = make(own as never);
    await svc.get(src, 160, 'webp');
    await svc.get(src, 320, 'webp');
    expect(own.get).toHaveBeenCalledTimes(2);
    await svc.get(src, 160, 'webp');
    expect(own.get).toHaveBeenCalledTimes(2);
    own.get.mockImplementation(async () => Promise.reject(new NotFoundException()));
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    try {
      await expect(svc.get(src, 160, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      clock.mockRestore();
    }
    expect(own.get).toHaveBeenCalledTimes(3);
  });

  it('ảnh vừa được ghi/đổi (đánh dấu cũ): xác nhận cũ bị bỏ, lần sau kiểm lại DB ngay, không chờ 60 giây', async () => {
    const src = '/public-image/campaign/c1/cover?v=abc';
    const own = { get: jest.fn(async () => ({ mime: 'image/png', data: png, versionOk: true })) };
    const stale = new ImageRegistryStale();
    const svc = new ImageResizeService(own as never, prismaWith() as never, stale);
    await svc.get(src, 160, 'webp');
    own.get.mockImplementation(async () => Promise.reject(new NotFoundException()));
    stale.markStale();
    await expect(svc.get(src, 160, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    const viaAdmin = make(ownImages(png));
    await viaAdmin.svc.get(src, 320, 'webp');
    viaAdmin.svc.invalidateRegistry();
    await viaAdmin.svc.get(src, 320, 'webp');
    expect(viaAdmin.own.get).toHaveBeenCalledTimes(2);
  });

  it('DB lỗi khi kiểm ảnh của API: 503 và không tính vào hạn mức sai ?v= của IP', async () => {
    const own = { get: jest.fn(async () => Promise.reject(new Error('db down'))) };
    const { svc } = make(own as never);
    for (let i = 0; i < 31; i++) await expect(svc.get(`/public-image/product/p${i}/0?v=x`, 160, 'webp', '4.4.4.4')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(own.get).toHaveBeenCalledTimes(31);
    own.get.mockImplementation(async () => ({ mime: 'image/png', data: png, versionOk: true }) as never);
    await expect(svc.get('/public-image/product/ok/0?v=x', 160, 'webp', '4.4.4.4')).resolves.toBeDefined();
  });

  it('prune: file không xoá được vẫn được tính vào dung lượng, lần quét không lỗi', async () => {
    process.env.IMAGE_CACHE_MAX_MB = '1';
    const sub = join(dir, 'ee');
    require('node:fs').mkdirSync(sub);
    const stuck = join(sub, 'stuck');
    writeFileSync(stuck, Buffer.alloc(10));
    const longAgo = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    utimesSync(stuck, longAgo, longAgo);
    const { svc } = make();
    const fsp = require('node:fs').promises;
    const rm = jest.spyOn(fsp, 'rm').mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    try {
      await expect(svc.prune()).resolves.toEqual({ removed: 0, bytes: 10 });
    } finally {
      rm.mockRestore();
    }
    expect((svc as unknown as { cacheBytes: number }).cacheBytes).toBe(10);
  });

  it('các lần ghi đầu tiên cùng lúc chỉ quét thư mục cache một lần và cộng đủ dung lượng đã ghi', async () => {
    const sub = join(dir, 'dd');
    require('node:fs').mkdirSync(sub);
    writeFileSync(join(sub, 'co-san'), Buffer.alloc(1000));
    const { svc } = make();
    // Tắt lần dọn định kỳ (chạy sau lần ghi đầu) để chỉ đếm lần quét đầu.
    (svc as unknown as { lastPrune: number }).lastPrune = Date.now();
    const scan = jest.spyOn(svc, 'prune');
    // Lần quét đầu chậm (volume nhiều file): cả bốn lần ghi tới trong lúc nó còn chạy.
    const fsp = require('node:fs').promises;
    const realReaddir = fsp.readdir;
    const slow = jest.spyOn(fsp, 'readdir').mockImplementationOnce(async (...a: unknown[]) => {
      await new Promise((r) => setTimeout(r, 300));
      return realReaddir.apply(fsp, a);
    });
    const outs = await Promise.all(['a', 'b', 'c', 'd'].map((id) => svc.get(`/public-image/product/${id}/0`, 160, 'webp')));
    slow.mockRestore();
    expect(scan).toHaveBeenCalledTimes(1);
    const written = outs.reduce((s, o) => s + o.data.length, 0);
    expect((svc as unknown as { cacheBytes: number }).cacheBytes).toBe(1000 + written);
  });

  it('lần dọn đang quét không xoá mất dung lượng của file ghi trong lúc quét', async () => {
    const { svc } = make();
    await svc.get('/public-image/product/e0/0', 160, 'webp');
    const fsp = require('node:fs').promises;
    const realReaddir = fsp.readdir;
    let release: () => void = () => undefined;
    const hold = new Promise<void>((r) => (release = r));
    const spy = jest.spyOn(fsp, 'readdir').mockImplementationOnce(async (...a: unknown[]) => {
      const names = await realReaddir.apply(fsp, a);
      await hold;
      return names;
    });
    const pruning = svc.prune();
    await new Promise((r) => setTimeout(r, 10));
    const during = await svc.get('/public-image/product/e1/0', 160, 'webp');
    release();
    await pruning;
    spy.mockRestore();
    const all = readdirSync(dir).flatMap((d) => readdirSync(join(dir, d)).map((n) => require('node:fs').statSync(join(dir, d, n)).size));
    const onDisk = all.reduce((s: number, n: number) => s + n, 0);
    expect(during.data.length).toBeGreaterThan(0);
    expect((svc as unknown as { cacheBytes: number }).cacheBytes).toBeGreaterThanOrEqual(onDisk);
  });

  it('bản của phiên bản đổi cỡ cũ còn trong thư mục không được phát: đổi cỡ lại theo cách hiện tại', async () => {
    const src = 'https://content.pancake.vn/a.png';
    const oldKey = cacheKey(new URL(src).toString(), 320, 'webp', RESIZE_PIPELINE_VERSION - 1);
    require('node:fs').mkdirSync(join(dir, oldKey.slice(0, 2)), { recursive: true });
    writeFileSync(join(dir, oldKey.slice(0, 2), oldKey), 'ban-cu');
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    lookupMock.mockImplementation((_h: string, _o: unknown, cb: (e: null, a: string, f: number) => void) => cb(null, '1.1.1.1', 4));
    const { svc } = make();
    const out = await svc.get(src, 320, 'webp');
    expect(out.data.toString()).not.toBe('ban-cu');
    expect((await sharp(out.data).metadata()).width).toBe(320);
    expect(out.etag).not.toBe(`"${oldKey}"`);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});

describe('ImageResizeService — ảnh mới từ đồng bộ/đối tác (R-182)', () => {
  it('bên ghi ảnh đánh dấu ImageRegistryStale (không qua ImageResizeService): lần /img kế tiếp không 404, không đợi 30 giây', async () => {
    const rows: string[][] = [[], ['https://content.pancake.vn/a.jpg']];
    let call = 0;
    const prisma = { $queryRaw: jest.fn(async () => (rows[Math.min(call++, 1)] ?? []).map((u) => ({ u }))) };
    const stale = new ImageRegistryStale();
    const svc = new ImageResizeService(ownImages(png) as never, prisma as never, stale);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).rejects.toBeInstanceOf(NotFoundException);
    stale.markStale();
    now.mockReturnValue(1_002_000);
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    await expect(svc.get('https://content.pancake.vn/a.jpg', 320, 'webp')).resolves.toBeDefined();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('đánh dấu hàng trăm lần trong một lượt đồng bộ chỉ gây một lần nạp lại', async () => {
    const prisma = prismaWith();
    const stale = new ImageRegistryStale();
    const svc = new ImageResizeService(ownImages(png) as never, prisma as never, stale);
    fakeHttps({ status: 200, headers: { 'content-type': 'image/png' }, body: png });
    await svc.get('https://content.pancake.vn/a.jpg', 320, 'webp');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 300; i++) stale.markStale();
    await svc.get('https://content.pancake.vn/a.png', 320, 'webp');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('yêu cầu nhập vào lần nạp đã bắt đầu trước khi đánh dấu vẫn thấy ảnh mới (nạp thêm một lần)', async () => {
    const url = 'https://content.pancake.vn/a.jpg';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let call = 0;
    const prisma = {
      $queryRaw: jest.fn(async () => {
        const n = call++;
        if (n === 0) {
          await gate;
          return [];
        }
        return [{ u: url }];
      }),
    };
    const stale = new ImageRegistryStale();
    const svc = new ImageResizeService(ownImages(png) as never, prisma as never, stale);
    const isReg = (u: string) => (svc as unknown as { isRegistered(u: string): Promise<boolean> }).isRegistered(u);
    const first = isReg(url);
    await new Promise((r) => setImmediate(r));
    stale.markStale();
    const joined = isReg(url);
    release();
    expect(await first).toBe(true);
    expect(await joined).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('hai yêu cầu cùng nhập lần nạp cũ, lần nạp thêm chậm như DB thật: cả hai đều thấy ảnh mới', async () => {
    const url = 'https://content.pancake.vn/a.jpg';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let call = 0;
    const prisma = {
      $queryRaw: jest.fn(async () => {
        if (call++ === 0) {
          await gate;
          return [];
        }
        await new Promise((r) => setTimeout(r, 20));
        return [{ u: url }];
      }),
    };
    const stale = new ImageRegistryStale();
    const svc = new ImageResizeService(ownImages(png) as never, prisma as never, stale);
    const isReg = (u: string) => (svc as unknown as { isRegistered(u: string): Promise<boolean> }).isRegistered(u);
    const first = isReg(url);
    await new Promise((r) => setImmediate(r));
    stale.markStale();
    const b = isReg(url);
    const c = isReg(url);
    release();
    expect([await first, await b, await c]).toEqual([true, true, true]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('đồng bộ đánh dấu liên tục trong lúc nạp: một /img chờ tối đa hai lần nạp, không bị giữ tới khi đồng bộ ngừng', async () => {
    const url = 'https://content.pancake.vn/a.jpg';
    const prisma = {
      $queryRaw: jest.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return [{ u: url }];
      }),
    };
    const stale = new ImageRegistryStale();
    const svc = new ImageResizeService(ownImages(png) as never, prisma as never, stale);
    const isReg = (u: string) => (svc as unknown as { isRegistered(u: string): Promise<boolean> }).isRegistered(u);
    await isReg(url);
    prisma.$queryRaw.mockClear();
    const marker = setInterval(() => stale.markStale(), 2);
    const stop = setTimeout(() => clearInterval(marker), 1000);
    try {
      stale.markStale();
      expect(await isReg(url)).toBe(true);
      expect(prisma.$queryRaw.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      clearInterval(marker);
      clearTimeout(stop);
    }
  });
});


describe('ImageResizeService — danh sách ảnh nạp lại ở nền (stale-while-revalidate)', () => {
  const URL_A = 'https://content.pancake.vn/a.jpg';
  const setup = (queryRaw: jest.Mock) => {
    const stale = new ImageRegistryStale();
    const svc = new ImageResizeService(ownImages(png) as never, { $queryRaw: queryRaw } as never, stale);
    const isReg = (u: string) => (svc as unknown as { isRegistered(u: string): Promise<boolean> }).isRegistered(u);
    return { stale, svc, isReg };
  };
  const tick = () => new Promise((r) => setImmediate(r));

  it('lần nạp đầu phải chờ; hết hạn TTL hoặc bị đánh dấu cũ thì dùng danh sách hiện có, không chờ truy vấn DB', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let call = 0;
    const queryRaw = jest.fn(async () => {
      if (call++ === 0) return [{ u: URL_A }];
      await gate;
      return [{ u: URL_A }];
    });
    const { stale, isReg } = setup(queryRaw);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    expect(await isReg(URL_A)).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    stale.markStale();
    now.mockReturnValue(1_000_000 + 6 * 60_000);
    // Nạp lại đang treo ở DB nhưng ảnh đã có trong danh sách thì trả lời ngay.
    expect(await isReg(URL_A)).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    release();
    await tick();
    now.mockRestore();
  });

  it('ảnh không có trong danh sách (trượt) vẫn chờ lần nạp đang chạy để thấy ảnh mới', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let call = 0;
    const queryRaw = jest.fn(async () => {
      if (call++ === 0) return [];
      await gate;
      return [{ u: URL_A }];
    });
    const { stale, isReg } = setup(queryRaw);
    await isReg('https://content.pancake.vn/none.jpg');
    stale.markStale();
    const p = isReg(URL_A);
    await tick();
    release();
    expect(await p).toBe(true);
  });

  it('nạp lại lỗi: giữ danh sách cũ để vẫn phục vụ, giữ cờ cũ, không thử lại trong 30 giây', async () => {
    let call = 0;
    const queryRaw = jest.fn(async () => {
      if (call++ === 0) return [{ u: URL_A }];
      throw new Error('db down');
    });
    const { stale, isReg } = setup(queryRaw);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await isReg(URL_A);
    stale.markStale();
    now.mockReturnValue(1_001_000);
    expect(await isReg(URL_A)).toBe(true);
    await tick();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(stale.isStale()).toBe(true);
    now.mockReturnValue(1_010_000);
    expect(await isReg(URL_A)).toBe(true);
    await tick();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1_040_000);
    await isReg(URL_A);
    await tick();
    expect(queryRaw).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it('đang lùi sau lần nạp lỗi: URL chưa đăng ký không kéo thêm truy vấn DB (chỉ miss, cờ cũ còn bật)', async () => {
    let call = 0;
    const queryRaw = jest.fn(async () => {
      if (call++ === 0) return [{ u: URL_A }];
      throw new Error('db down');
    });
    const { stale, isReg } = setup(queryRaw);
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await isReg(URL_A);
    stale.markStale();
    now.mockReturnValue(1_001_000);
    expect(await isReg('https://content.pancake.vn/lạ-1.jpg')).toBe(false);
    await tick();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    now.mockReturnValue(1_010_000);
    for (let i = 0; i < 5; i++) expect(await isReg(`https://content.pancake.vn/lạ-${i + 2}.jpg`)).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('lần nạp đầu lỗi thì 503 (chưa có danh sách nào để dùng tạm)', async () => {
    const { isReg } = setup(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(isReg(URL_A)).rejects.toThrow('Máy chủ đang bận');
  });
});
