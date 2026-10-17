import 'reflect-metadata';
import { StreamableFile } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CommunityFeedController } from './community-feed.controller';

const handler = CommunityFeedController.prototype.image;

function run(result: { mime: string; data: Buffer; isPublic: boolean }, user: unknown = undefined, version: unknown = 'v1') {
  const getImage = jest.fn().mockResolvedValue(result);
  const controller = new CommunityFeedController({ getImage } as never);
  const res = { set: jest.fn() };
  return { getImage, res, out: controller.image('p1', 2, version, user as never, res as never) };
}

describe('CommunityFeedController.image (GET feed/posts/:id/images/:index)', () => {
  it('route công khai (thẻ img không gửi token) nhưng vẫn nhận ra người xem nếu có Bearer', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(OptionalJwtAuthGuard);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('posts/:id/images/:index');
  });

  it('truyền id, chỉ số, người xem và mã v xuống service; trả đúng byte với Content-Type theo ảnh', async () => {
    const user = { sub: 'u1', role: 'CUSTOMER' };
    const { getImage, out } = run({ mime: 'image/webp', data: Buffer.from('abc'), isPublic: true }, user, 'abc123');
    const file = await out;
    expect(getImage).toHaveBeenCalledWith('p1', 2, user, 'abc123');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders().type).toBe('image/webp');
  });

  it('ảnh bài đã đăng: cache công khai vĩnh viễn như ảnh đánh giá, mở cross-origin, chặn đoán MIME', async () => {
    const { res, out } = run({ mime: 'image/png', data: Buffer.from('a'), isPublic: true });
    await out;
    expect(res.set).toHaveBeenCalledWith({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('ảnh bài chưa/không còn hiển thị: không vào cache dùng chung hay lưu lại', async () => {
    const { res, out } = run({ mime: 'image/png', data: Buffer.from('a'), isPublic: false });
    await out;
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' }),
    );
  });
});
