import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ImageResizeController } from './image-resize.controller';
import { ImageFallbackRedirect, ImageResizeService } from './image-resize.service';

/**
 * Hạn mức sai ?v= đếm theo `client` mà controller truyền xuống. Triển khai Vietnix chỉ có MỘT proxy (Apache aaPanel, sau
 * mod_remoteip nếu bật Cloudflare) nối thêm IP khách vào cuối X-Forwarded-For, nên `trust proxy` = 1 và IP thật là phần tử cuối.
 */
async function boot() {
  const get = jest.fn(async (_s: unknown, _w: number, _f: string, _client: string) => ({ data: Buffer.from('x'), mime: 'image/webp', etag: '"k"' }));
  const moduleRef = await Test.createTestingModule({
    controllers: [ImageResizeController],
    providers: [{ provide: ImageResizeService, useValue: { keyFor: () => null, get } }],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  app.set('trust proxy', 1);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  const call = async (xff?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/img?u=%2Fpublic-image%2Fproduct%2Fp%2F0%3Fv%3Dx&w=320`, { headers: xff ? { 'x-forwarded-for': xff } : {} });
    await res.arrayBuffer();
    return get.mock.calls.at(-1)?.[3];
  };
  return { app, call };
}

describe('ImageResizeController: IP của khách cho hạn mức sai ?v=', () => {
  let ctx: Awaited<ReturnType<typeof boot>>;
  beforeAll(async () => {
    ctx = await boot();
  });
  afterAll(() => ctx.app.close());

  it('lấy IP proxy ghi ở cuối X-Forwarded-For', async () => {
    expect(await ctx.call('203.0.113.7')).toBe('203.0.113.7');
  });

  it('khách giả đầu chuỗi X-Forwarded-For (nối IP người khác) vẫn bị tính theo IP thật do proxy ghi', async () => {
    expect(await ctx.call('198.51.100.9, 203.0.113.7')).toBe('203.0.113.7');
    expect(await ctx.call('198.51.100.9, 192.0.2.1, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('không có header thì dùng địa chỉ kết nối, không bao giờ là chuỗi rỗng dùng chung', async () => {
    expect(await ctx.call()).toMatch(/127\.0\.0\.1/);
  });
});

describe('ImageResizeController: định dạng theo Accept', () => {
  it('AVIF, WebP, JPEG theo Accept; luôn Vary: Accept và immutable', async () => {
    const get = jest.fn(async (_s: unknown, _w: number, f: string) => ({ data: Buffer.from(f), mime: `image/${f}`, etag: `"${f}"` }));
    const moduleRef = await Test.createTestingModule({
      controllers: [ImageResizeController],
      providers: [{ provide: ImageResizeService, useValue: { keyFor: () => null, get } }],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    await app.listen(0, '127.0.0.1');
    try {
      const { port } = app.getHttpServer().address() as { port: number };
      const url = `http://127.0.0.1:${port}/img?u=https%3A%2F%2Fcontent.pancake.vn%2Fa.jpg&w=320`;
      const seen: Record<string, string | null>[] = [];
      for (const accept of ['image/avif,image/webp,image/apng,*/*;q=0.8', 'image/webp,*/*', '*/*']) {
        const res = await fetch(url, { headers: { accept } });
        await res.arrayBuffer();
        seen.push({ type: res.headers.get('content-type'), vary: res.headers.get('vary'), cache: res.headers.get('cache-control') });
      }
      expect(seen.map((x) => x.type)).toEqual(['image/avif', 'image/webp', 'image/jpeg']);
      expect(seen.every((x) => x.vary === 'Accept' && x.cache === 'public, max-age=31536000, immutable')).toBe(true);
      expect(get.mock.calls.map((c) => c[2])).toEqual(['avif', 'webp', 'jpeg']);
    } finally {
      await app.close();
    }
  });
});

describe('ImageResizeController: máy bận thì không trả 503', () => {
  async function bootWith(get: jest.Mock) {
    const moduleRef = await Test.createTestingModule({
      controllers: [ImageResizeController],
      providers: [{ provide: ImageResizeService, useValue: { keyFor: () => null, get } }],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as { port: number };
    return { app, base: `http://127.0.0.1:${port}` };
  }

  it('AVIF bận: bản WebP thay thế có cache ngắn riêng trình duyệt, vẫn Vary: Accept', async () => {
    const { app, base } = await bootWith(jest.fn(async () => ({ data: Buffer.from('w'), mime: 'image/webp', etag: '"wk"', degraded: true })));
    try {
      const res = await fetch(`${base}/img?u=https%3A%2F%2Fcontent.pancake.vn%2Fa.jpg&w=320`, { headers: { accept: 'image/avif,image/webp,*/*' } });
      await res.arrayBuffer();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      expect(res.headers.get('cache-control')).toBe('private, max-age=300');
      expect(res.headers.get('vary')).toBe('Accept');
      expect(res.headers.get('x-image-fallback')).toBe('avif-busy');
    } finally {
      await app.close();
    }
  });

  it('hàng đợi đầy: 302 về ảnh gốc, no-store, vẫn Vary: Accept; ảnh của API chuyển tương đối nên đúng cả sau tiền tố /api', async () => {
    const get = jest
      .fn()
      .mockRejectedValueOnce(new ImageFallbackRedirect('https://content.pancake.vn/a.jpg', 'queue-full'))
      .mockRejectedValueOnce(new ImageFallbackRedirect('public-image/product/p/0?v=x', 'miss-limit'));
    const { app, base } = await bootWith(get);
    try {
      const a = await fetch(`${base}/img?u=https%3A%2F%2Fcontent.pancake.vn%2Fa.jpg&w=320`, { redirect: 'manual' });
      expect(a.status).toBe(302);
      expect(a.headers.get('location')).toBe('https://content.pancake.vn/a.jpg');
      expect(a.headers.get('cache-control')).toBe('no-store');
      expect(a.headers.get('vary')).toBe('Accept');
      expect(a.headers.get('x-image-fallback')).toBe('queue-full');
      const b = await fetch(`${base}/img?u=%2Fpublic-image%2Fproduct%2Fp%2F0%3Fv%3Dx&w=320`, { redirect: 'manual' });
      expect(b.status).toBe(302);
      expect(new URL(b.headers.get('location') as string, `${base}/api/img?w=320`).pathname).toBe('/api/public-image/product/p/0');
      expect(b.headers.get('x-image-fallback')).toBe('miss-limit');
    } finally {
      await app.close();
    }
  });

  it('lỗi khác (ảnh không có) vẫn đi đường lỗi thường', async () => {
    const { NotFoundException } = await import('@nestjs/common');
    const { app, base } = await bootWith(jest.fn().mockRejectedValue(new NotFoundException()));
    try {
      const res = await fetch(`${base}/img?u=https%3A%2F%2Fcontent.pancake.vn%2Fa.jpg&w=320`, { redirect: 'manual' });
      expect(res.status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
