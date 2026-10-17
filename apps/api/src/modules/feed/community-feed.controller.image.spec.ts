import 'reflect-metadata';
import { StreamableFile } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CommunityFeedController } from './community-feed.controller';

const handler = CommunityFeedController.prototype.image;

function run(result: { mime: string; data: Buffer; isPublic: boolean; versionOk: boolean }, user: unknown = undefined, version: unknown = 'v1') {
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

  // Một trang feed là 20 ảnh tải bằng thẻ img (không có token nên đếm theo IP): với mức chung 300/phút, vài khách chung IP
  // (CGNAT) lướt feed là ảnh bị 429 và vỡ. Hạn mức riêng chỉ cho route này; route khác giữ mức toàn cục.
  it('hạn mức riêng cao hơn mức chung cho route ảnh, các route khác giữ mức toàn cục', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(1200);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(60_000);
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, CommunityFeedController.prototype.getFeed)).toBeUndefined();
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, CommunityFeedController.prototype.getPost)).toBeUndefined();
  });

  it('truyền id, chỉ số, người xem và mã v xuống service; trả đúng byte với Content-Type theo ảnh', async () => {
    const user = { sub: 'u1', role: 'CUSTOMER' };
    const { getImage, out } = run({ mime: 'image/webp', data: Buffer.from('abc'), isPublic: true, versionOk: true }, user, 'abc123');
    const file = await out;
    expect(getImage).toHaveBeenCalledWith('p1', 2, user, 'abc123');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders().type).toBe('image/webp');
  });

  it('ảnh bài đã đăng, mã v khớp: cache vĩnh viễn nhưng chỉ ở trình duyệt (như ảnh minh chứng đổi trả), mở cross-origin, chặn đoán MIME', async () => {
    const { res, out } = run({ mime: 'image/png', data: Buffer.from('a'), isPublic: true, versionOk: true });
    await out;
    expect(res.set).toHaveBeenCalledWith({
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    });
  });

  it('ảnh bài đã đăng, mã v sai hoặc thiếu: cache ngắn, không immutable (URL không gắn với nội dung nên có thể đã đổi)', async () => {
    const { res, out } = run({ mime: 'image/png', data: Buffer.from('a'), isPublic: true, versionOk: false });
    await out;
    const headers = res.set.mock.calls[0]![0] as Record<string, string>;
    expect(headers['Cache-Control']).toBe('private, max-age=300');
    expect(headers['Cache-Control']).not.toContain('immutable');
  });

  it('ảnh bài chưa/không còn hiển thị: không lưu lại, kể cả khi mã v khớp', async () => {
    for (const versionOk of [true, false]) {
      const { res, out } = run({ mime: 'image/png', data: Buffer.from('a'), isPublic: false, versionOk });
      await out;
      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({ 'Cache-Control': 'private, no-store', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' }),
      );
    }
  });
});
