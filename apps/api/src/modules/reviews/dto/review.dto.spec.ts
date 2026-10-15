import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createValidationPipe } from '../../../common/validation-pipe';
import { CreateReviewDto } from './review.dto';

const IMG = 'https://res.cloudinary.com/tubu/image/upload/v1/a.jpg';
const VID = 'https://res.cloudinary.com/tubu/video/upload/v1/rv.mp4';
const JPEG_DATA_URL = `data:image/jpeg;base64,${'A'.repeat(300_000)}==`;

async function errorsOf(body: Record<string, unknown>) {
  const errs = await validate(plainToInstance(CreateReviewDto, { rating: 5, ...body }));
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}

/** ValidationPipe toàn cục ở main.ts. */
const pipe = createValidationPipe();
const asBody = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype: CreateReviewDto, data: undefined });

describe('CreateReviewDto — ảnh/video đánh giá (MONEY-10)', () => {
  it('ảnh và video đã tải lên Cloudinary (https) → hợp lệ', async () => {
    expect(await errorsOf({ images: [IMG], videoUrl: VID })).toEqual([]);
  });

  it.each([
    ['chuỗi bất kỳ', 'x'],
    ['host lạ', 'https://example.com/a.jpg'],
    ['http không mã hoá', 'http://res.cloudinary.com/tubu/image/upload/a.jpg'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:text/html', 'data:text/html;base64,PHNjcmlwdD4='],
    ['SVG base64', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['GIF base64', 'data:image/gif;base64,R0lGODlhAQABAAAAACw='],
  ])('ảnh %s → bị từ chối bằng thông báo tiếng Việt', async (_label, value) => {
    expect(await errorsOf({ images: [value] })).toEqual(['Ảnh đánh giá phải là ảnh đã tải lên từ ứng dụng.']);
  });

  it.each([
    ['host lạ', 'https://example.com/not-a-video'],
    ['youtube', 'https://www.youtube.com/watch?v=abc'],
    ['http', 'http://res.cloudinary.com/tubu/video/upload/rv.mp4'],
    ['base64', 'data:video/mp4;base64,AAAA'],
  ])('video %s → bị từ chối', async (_label, value) => {
    expect(await errorsOf({ videoUrl: value })).toEqual(['Video đánh giá phải là video đã tải lên từ ứng dụng.']);
  });
});

// ENGAGE-6: miniapp chưa cấu hình Cloudinary nên ảnh đánh giá thường là base64 nén (~200-500 nghìn ký tự), trong khi
// DTO cũ chặn mỗi ảnh ≤ 500 ký tự → mọi đánh giá có ảnh bị 400 bằng tiếng Anh.
describe('CreateReviewDto.images qua ValidationPipe toàn cục (ENGAGE-6)', () => {
  it('nhận ảnh base64 nén như miniapp gửi khi chưa có Cloudinary', async () => {
    const dto = (await asBody({ rating: 5, images: [JPEG_DATA_URL] })) as CreateReviewDto;
    expect(dto.images).toHaveLength(1);
  });

  it('nhận URL https trên host upload Cloudinary', async () => {
    await expect(asBody({ rating: 4, images: [IMG] })).resolves.toBeDefined();
  });

  it('từ chối ảnh base64 vượt trần nội dung công khai (700.000 ký tự) và quá 5 ảnh', async () => {
    await expect(asBody({ rating: 5, images: [`data:image/jpeg;base64,${'A'.repeat(750_000)}`] })).rejects.toThrow();
    await expect(asBody({ rating: 5, images: Array(6).fill(JPEG_DATA_URL) })).rejects.toThrow();
  });

  it('lỗi 400 là câu tiếng Việt, không lộ câu tiếng Anh của class-validator', async () => {
    const err = await asBody({ rating: 9, images: Array(6).fill(IMG) }).catch((e: { getResponse(): { message: string[] } }) => e);
    const messages = (err as { getResponse(): { message: string[] } }).getResponse().message;
    expect(messages).toEqual(expect.arrayContaining(['Số sao không được lớn hơn 5.', 'Ảnh chỉ được có tối đa 5 mục.']));
    expect(messages.join(' ')).not.toMatch(/\b(must|should)\b/);
  });

  it('đánh giá không ảnh vẫn hợp lệ', async () => {
    await expect(asBody({ rating: 5, comment: 'Rất ổn' })).resolves.toBeDefined();
  });
});

describe('CreateReviewDto.orderId (mỗi lần mua một đánh giá)', () => {
  it('không bắt buộc (app cũ không gửi); có thì giữ nguyên tới service', async () => {
    await expect(asBody({ rating: 5 })).resolves.toBeDefined();
    const dto = (await asBody({ rating: 5, orderId: 'cm1order0001' })) as CreateReviewDto;
    expect(dto.orderId).toBe('cm1order0001');
  });

  it('không phải chuỗi hoặc dài bất thường → 400', async () => {
    await expect(asBody({ rating: 5, orderId: 123 })).rejects.toThrow();
    await expect(asBody({ rating: 5, orderId: 'x'.repeat(65) })).rejects.toThrow();
  });
});
