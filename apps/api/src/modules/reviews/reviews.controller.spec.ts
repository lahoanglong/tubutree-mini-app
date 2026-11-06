import 'reflect-metadata';
import { BadRequestException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createValidationPipe } from '../../common/validation-pipe';
import { PUBLIC_CACHE_POLICY_KEY } from '../../common/decorators/public-cache.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

describe('ReviewsController — danh sách đánh giá công khai (L3-13)', () => {
  it('GET products/:slug/reviews công khai, cache USER_CONTENT (đánh giá mới duyệt hiện chậm tối đa 60 giây ở CDN)', () => {
    const fn = ReviewsController.prototype.list;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn)).toBe(true);
    expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, fn)).toBe('USER_CONTENT');
    expect(Reflect.getMetadata('path', fn)).toBe('products/:slug/reviews');
  });

  it('các route theo người dùng (can-review, đánh giá của mình) không cache chung', () => {
    for (const name of ['canReview', 'findOwn', 'create', 'remove'] as const) {
      expect(Reflect.getMetadata(PUBLIC_CACHE_POLICY_KEY, ReviewsController.prototype[name])).toBeUndefined();
    }
  });
});

// Lọc theo sao/ảnh/video chạy ở máy chủ: lọc ở client chỉ thấy 100 đánh giá mới nhất, sản phẩm nhiều đánh giá báo "không có
// đánh giá khớp" dù có. Đi qua HTTP với ValidationPipe toàn cục để chắc query sai kiểu bị chặn 400 trước khi tới Prisma.
describe('GET /products/:slug/reviews: tham số lọc rating, media qua HTTP', () => {
  const listByProduct = jest.fn().mockResolvedValue({ average: 0, count: 0, videoCount: 0, distribution: {}, items: [] });
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReviewsController],
      providers: [{ provide: ReviewsService, useValue: { listByProduct } }],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(createValidationPipe());
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => listByProduct.mockClear());

  const get = async (qs: string) => {
    const res = await fetch(`${base}/products/nuoc-rua-chen/reviews${qs}`);
    await res.arrayBuffer();
    return res;
  };

  it.each([
    ['', {}],
    ['?rating=1', { rating: 1 }],
    ['?rating=5', { rating: 5 }],
    ['?media=photo', { media: 'photo' }],
    ['?media=video', { media: 'video' }],
    ['?rating=4&media=photo', { rating: 4, media: 'photo' }],
    ['?hasVideo=true', { hasVideo: true }],
    ['?hasVideo=1', { hasVideo: true }],
    ['?hasVideo=false', { hasVideo: false }],
    ['?hasVideo=0', { hasVideo: false }],
    ['?rating=2&hasVideo=true&cursor=abc', { rating: 2, hasVideo: true, cursor: 'abc' }],
    ['?media=photo&hasVideo=true', { media: 'photo', hasVideo: true }],
    ['?cursor=MTc2MTk1NTIwMDAwMHxyOTk', { cursor: 'MTc2MTk1NTIwMDAwMHxyOTk' }],
    ['?rating=1&media=video&cursor=abc', { rating: 1, media: 'video', cursor: 'abc' }],
    ['?cursor=', {}],
  ])('%s → 200, service nhận bộ lọc %j (rating là số, cursor rỗng coi như trang đầu)', async (qs, filter) => {
    const res = await get(qs);
    expect(res.status).toBe(200);
    expect(listByProduct).toHaveBeenCalledTimes(1);
    expect(listByProduct.mock.calls[0]![0]).toBe('nuoc-rua-chen');
    expect({ ...listByProduct.mock.calls[0]![1] }).toEqual(filter);
  });

  it.each(['?rating=0', '?rating=6', '?rating=1.5', '?rating=abc', '?rating=', '?rating=1&rating=2', '?rating[x]=1', '?media=audio', '?media=photo&media=video', '?hasVideo=', '?hasVideo=yes', '?hasVideo=TRUE', '?hasVideo=2', '?hasVideo=true&hasVideo=true', '?hasVideo[x]=1', '?khac=1', '?cursor=a&cursor=b', '?cursor[x]=1', `?cursor=${'a'.repeat(121)}`])(
    '%s → 400, không gọi service, không gắn cache công khai',
    async (qs) => {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(res.headers.get('cache-control') ?? '').not.toContain('public');
      expect(listByProduct).not.toHaveBeenCalled();
    },
  );

  it('con trỏ hỏng (service báo 400): trả 400, không gắn cache công khai để CDN không giữ lỗi', async () => {
    listByProduct.mockRejectedValueOnce(new BadRequestException('Con trỏ trang không hợp lệ. Bạn tải lại danh sách nhé.'));
    const res = await get('?cursor=hong');
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control') ?? '').not.toContain('public');
  });

  it('kết quả lọc cache công khai như danh sách đầy đủ (CDN tách bản theo URL có query)', async () => {
    const res = await get('?rating=1');
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, s-maxage=60');
  });
});
