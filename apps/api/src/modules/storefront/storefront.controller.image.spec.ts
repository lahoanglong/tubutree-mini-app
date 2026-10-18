import 'reflect-metadata';
import { RequestMethod, StreamableFile } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { StorefrontController } from './storefront.controller';

const handler = StorefrontController.prototype.image;

function run(result: { mime: string; data: Buffer; versionOk: boolean }, kind = 'avatar', version: unknown = 'v1') {
  const getPublicImage = jest.fn().mockResolvedValue(result);
  const controller = new StorefrontController({ getPublicImage } as never, {} as never);
  const res = { set: jest.fn() };
  return { getPublicImage, res, out: controller.image('s1', kind, version, res as never) };
}

describe('StorefrontController.image (GET storefront/image/:id/:kind)', () => {
  it('route công khai (thẻ img và trình thu thập link không gửi token), không trùng route public/:slug', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('image/:id/:kind');
  });

  it('hạn mức riêng cao hơn mức chung vì một trang gian hàng tải ảnh bằng thẻ img không token (đếm theo IP)', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(1200);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(60_000);
  });

  it('truyền id, loại ảnh và mã v xuống service; trả đúng byte với Content-Type theo ảnh', async () => {
    const { getPublicImage, out } = run({ mime: 'image/webp', data: Buffer.from('abc'), versionOk: true }, 'cover', 'abc123');
    const file = await out;
    expect(getPublicImage).toHaveBeenCalledWith('s1', 'cover', 'abc123');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders().type).toBe('image/webp');
  });

  it('mã v khớp: cache vĩnh viễn nhưng chỉ ở trình duyệt (gian hàng bị gỡ không nằm lại ở CDN dùng chung), mở cross-origin, chặn đoán MIME', async () => {
    const { res, out } = run({ mime: 'image/png', data: Buffer.from('a'), versionOk: true });
    await out;
    expect(res.set).toHaveBeenCalledWith({
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('mã v sai hoặc thiếu: cache ngắn, không immutable', async () => {
    const { res, out } = run({ mime: 'image/png', data: Buffer.from('a'), versionOk: false });
    await out;
    const headers = res.set.mock.calls[0]![0] as Record<string, string>;
    expect(headers['Cache-Control']).toBe('private, max-age=300');
  });
});
