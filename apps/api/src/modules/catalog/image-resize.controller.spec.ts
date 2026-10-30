import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ImageResizeController } from './image-resize.controller';
import { ImageResizeService } from './image-resize.service';

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
