import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateReviewDto } from './review.dto';

const IMG = 'https://res.cloudinary.com/tubu/image/upload/v1/a.jpg';
const VID = 'https://res.cloudinary.com/tubu/video/upload/v1/rv.mp4';

async function errorsOf(body: Record<string, unknown>) {
  const errs = await validate(plainToInstance(CreateReviewDto, { rating: 5, ...body }));
  return errs.flatMap((e) => Object.values(e.constraints ?? {}));
}

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
  ])('ảnh %s → bị từ chối bằng thông báo tiếng Việt', async (_label, value) => {
    expect(await errorsOf({ images: [value] })).toEqual(['Ảnh đánh giá phải là ảnh đã tải lên từ ứng dụng.']);
  });

  it.each([
    ['host lạ', 'https://example.com/not-a-video'],
    ['youtube', 'https://www.youtube.com/watch?v=abc'],
    ['http', 'http://res.cloudinary.com/tubu/video/upload/rv.mp4'],
  ])('video %s → bị từ chối', async (_label, value) => {
    expect(await errorsOf({ videoUrl: value })).toEqual(['Video đánh giá phải là video đã tải lên từ ứng dụng.']);
  });
});
