import dns from 'dns';
import { EventEmitter } from 'events';
import sharp from 'sharp';
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { assertPublicHttpUrl, StoryAssetsService } from './story-assets.service';

const requestMock = jest.fn();
jest.mock('node:https', () => ({ request: (...args: unknown[]) => requestMock(...args) }));
jest.mock('node:http', () => ({ request: (...args: unknown[]) => requestMock(...args) }));

const png = (w = 8, h = 6, bg = '#ffffff') => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();

/** Phản hồi giả của http(s).request: `chunks` phát dần, `hold` giữ yêu cầu treo tới khi gọi `release()`. */
interface Fake {
  status: number;
  headers: Record<string, string>;
  chunks?: Buffer[];
}
const imgRes = async (body?: Buffer, type = 'image/png'): Promise<Fake> => {
  const b = body ?? (await png());
  return { status: 200, headers: { 'content-type': type, 'content-length': String(b.length) }, chunks: [b] };
};
const htmlRes = (html: string): Fake => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, chunks: [Buffer.from(html)] });
const redirect = (to: string): Fake => ({ status: 302, headers: { location: to } });

type Cb = (r: unknown) => void;
const respond = (f: Fake) => (_url: unknown, _opts: unknown, cb: Cb) =>
  Object.assign(new EventEmitter(), {
    destroy: jest.fn(),
    end: () => {
      const r = Object.assign(new EventEmitter(), { statusCode: f.status, headers: f.headers, resume: jest.fn(), destroy: jest.fn() });
      cb(r);
      setImmediate(() => {
        for (const c of f.chunks ?? []) r.emit('data', c);
        r.emit('end');
        r.emit('close');
      });
    },
  });
const reply = (...fakes: Fake[]) => fakes.forEach((f) => requestMock.mockImplementationOnce(respond(f)));
const replyAll = (f: Fake) => requestMock.mockImplementation(respond(f));

let lookup: jest.SpyInstance;
beforeEach(() => {
  requestMock.mockReset();
  lookup = jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
});
afterEach(() => jest.restoreAllMocks());

describe('assertPublicHttpUrl', () => {
  it.each(['http://127.0.0.1/a.png', 'http://10.1.2.3/a.png', 'http://172.20.0.1/a.png', 'http://192.168.1.1/a.png', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/a.png', 'http://localhost/a.png', 'http://[fe80::1]/a.png', 'http://[fd00::1]/a.png'])(
    'rejects 127.0.0.1, 10.x, 169.254.169.254, [::1], localhost: %s',
    async (url) => {
      await expect(assertPublicHttpUrl(url)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rejects ipv4-mapped ipv6 private', async () => {
    await expect(assertPublicHttpUrl('http://[::ffff:127.0.0.1]/a.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPublicHttpUrl('http://[::ffff:10.0.0.1]/a.png')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['http://[64:ff9b::7f00:1]/a.png', 'http://[64:ff9b::a00:1]/a.png', 'http://[2002:7f00:1::]/a.png', 'http://[2002:a9fe:a9fe::1]/a.png'])('rejects NAT64 and 6to4 literals that embed a private ipv4: %s', async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects host that resolves to private ip', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }] as never);
    const err = await assertPublicHttpUrl('https://evil.example.com/a.png').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String(err.message)).not.toContain('10.0.0.5');
  });

  it('rejects odd ports, non-http schemes and accepts a public https url', async () => {
    await expect(assertPublicHttpUrl('https://example.com:8443/a.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPublicHttpUrl('ftp://example.com/a.png')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPublicHttpUrl('not a url')).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertPublicHttpUrl('https://example.com/a.png')).resolves.toBeInstanceOf(URL);
  });
});

function setup(product: unknown = { id: 'p1' }) {
  const prisma = { product: { findUnique: jest.fn().mockResolvedValue(product) } };
  return { svc: new StoryAssetsService(prisma as never), prisma };
}

describe('StoryAssetsService.extract', () => {
  it('404 when product missing', async () => {
    const { svc } = setup(null);
    await expect(svc.extract('x', { imageUrls: ['https://example.com/a.png'] })).rejects.toBeInstanceOf(NotFoundException);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('requires pageUrl or imageUrls', async () => {
    await expect(setup().svc.extract('p1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects redirect to private ip', async () => {
    lookup.mockImplementation((async (host: string) => [{ address: host === 'internal.test' ? '10.0.0.9' : '93.184.216.34', family: 4 }]) as never);
    reply(redirect('http://internal.test/secret.png'));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    expect(out.images).toEqual([]);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects more than 2 redirects', async () => {
    replyAll(redirect('https://example.com/next.png'));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    expect(out.images).toEqual([]);
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it('follows up to 2 redirects', async () => {
    reply(redirect('https://example.com/b.png'), redirect('https://example.com/c.png'), await imgRes());
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    expect(out.images).toEqual([{ url: 'https://example.com/c.png', width: 8, height: 6 }]);
  });

  it('rejects non-image content-type', async () => {
    reply(await imgRes(await png(), 'text/html'));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    expect(out.images).toEqual([]);
  });

  it('rejects image over 8MB', async () => {
    reply(await imgRes(Buffer.alloc(8 * 1024 * 1024 + 1, 1)));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/big.png'] });
    expect(out.images).toEqual([]);
  });

  it('rejects an undecodable image', async () => {
    reply(await imgRes(Buffer.from('not an image')));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/bad.png'] });
    expect(out.images).toEqual([]);
  });

  it('returns images with matching webp cutouts, shrinking above 1600px before cutting', async () => {
    reply(await imgRes(await png(2000, 100, '#202020')));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/wide.png'] });
    expect(out.images).toEqual([{ url: 'https://example.com/wide.png', width: 2000, height: 100 }]);
    expect(out.cutouts).toHaveLength(1);
    expect(out.cutouts[0]?.sourceUrl).toBe('https://example.com/wide.png');
    expect(out.cutouts[0]?.dataUrl.startsWith('data:image/webp;base64,')).toBe(true);
    const meta = await sharp(Buffer.from(out.cutouts[0]!.dataUrl.split(',')[1]!, 'base64')).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
  });

  it('pageUrl extraction returns og:image and img src as absolute https, max 12', async () => {
    const imgs = Array.from({ length: 15 }, (_, i) => `<img alt="" src="/p/${i}.png">`).join('');
    const html = `<html><head><meta content="//cdn.example.com/og.png" property="og:image"></head><body>${imgs}<img src="/p/0.png"><img src="data:image/png;base64,AAA"></body></html>`;
    const okImg = await imgRes();
    requestMock.mockImplementation((u: URL, o: unknown, cb: Cb) => respond(String(u) === 'https://shop.example.com/sp' ? htmlRes(html) : okImg)(u, o, cb));
    const out = await setup().svc.extract('p1', { pageUrl: 'https://shop.example.com/sp' });
    expect(out.images).toHaveLength(12);
    expect(out.images[0]?.url).toBe('https://cdn.example.com/og.png');
    expect(out.images[1]?.url).toBe('https://shop.example.com/p/0.png');
    expect(out.images.every((i) => i.url.startsWith('https://'))).toBe(true);
    expect(new Set(out.images.map((i) => i.url)).size).toBe(12);
  });

  it('rejects a pageUrl that is not html', async () => {
    reply(await imgRes());
    await expect(setup().svc.extract('p1', { pageUrl: 'https://shop.example.com/sp' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bad image in list is skipped, others returned', async () => {
    reply(await imgRes(Buffer.from('junk')), await imgRes());
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/bad.png', 'https://example.com/ok.png'] });
    expect(out.images.map((i) => i.url)).toEqual(['https://example.com/ok.png']);
    expect(out.cutouts.map((c) => c.sourceUrl)).toEqual(['https://example.com/ok.png']);
  });
  it('kết nối qua lookup riêng: tên phân giải ra địa chỉ nội bộ ở lần nối thật bị chặn (chống DNS rebinding)', async () => {
    replyAll(await imgRes());
    await setup().svc.extract('p1', { imageUrls: ['https://example.com/a.png'] });
    const opts = (requestMock.mock.calls[0] as [URL, { lookup: (h: string, o: object, cb: (...a: unknown[]) => void) => void }])[1];
    expect(typeof opts.lookup).toBe('function');
    jest.spyOn(dns, 'lookup').mockImplementation(((_h: string, _o: unknown, cb: (...a: unknown[]) => void) => cb(null, [{ address: '10.0.0.5', family: 4 }])) as never);
    const got = await new Promise<unknown[]>((resolve) => opts.lookup('example.com', { all: true }, (...a: unknown[]) => resolve(a)));
    expect(got[0]).toBeInstanceOf(Error);
  });

  it('thân ảnh vượt 8MB khi không khai content-length cũng bị cắt', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 1);
    reply({ status: 200, headers: { 'content-type': 'image/png' }, chunks: Array.from({ length: 9 }, () => chunk) });
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/stream.png'] });
    expect(out.images).toEqual([]);
  });

  it('ảnh quá nhiều điểm ảnh (bom giải nén) bị bỏ qua, không dựng bản tách nền', async () => {
    reply(await imgRes(await png(5000, 5000)));
    const out = await setup().svc.extract('p1', { imageUrls: ['https://example.com/bomb.png'] });
    expect(out.images).toEqual([]);
    expect(out.cutouts).toEqual([]);
  });

  it('quá nhiều lượt trích xuất cùng lúc: lượt vượt hàng đợi nhận 503, lượt đang chạy vẫn xong', async () => {
    const waiting: Cb[] = [];
    requestMock.mockImplementation((_u: unknown, _o: unknown, cb: Cb) =>
      Object.assign(new EventEmitter(), {
        destroy: jest.fn(),
        end: () => waiting.push(cb),
      }),
    );
    const { svc } = setup();
    const runs = Array.from({ length: 6 }, (_, i) => svc.extract('p1', { imageUrls: [`https://example.com/${i}.png`] }));
    await expect(svc.extract('p1', { imageUrls: ['https://example.com/over.png'] })).rejects.toBeInstanceOf(ServiceUnavailableException);
    let finished = false;
    const all = Promise.all(runs).then((r) => {
      finished = true;
      return r;
    });
    while (!finished) {
      await new Promise((r) => setImmediate(r));
      while (waiting.length > 0) {
        const cb = waiting.shift()!;
        cb(Object.assign(new EventEmitter(), { statusCode: 404, headers: {}, resume: jest.fn(), destroy: jest.fn() }));
      }
    }
    await expect(all).resolves.toHaveLength(6);
  });
});
