import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCourseDto, CreateLessonDto, UpdateCourseDto, UpdateLessonDto } from './academy.dto';

async function keys<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}).map((k) => `${e.property}.${k}`));
}

describe('Academy DTO: trần độ dài', () => {
  const course = { title: 'Khoá học' };
  const lesson = { title: 'Bài 1', contentType: 'ARTICLE' };

  it.each([
    ['description', 5000, CreateCourseDto, course],
    ['description', 5000, UpdateCourseDto, course],
    ['body', 50_000, CreateLessonDto, lesson],
    ['body', 50_000, UpdateLessonDto, lesson],
    ['videoUrl', 500, CreateLessonDto, lesson],
    ['videoUrl', 500, UpdateLessonDto, lesson],
  ] as const)('%s đúng trần %i qua, vượt 1 ký tự báo maxLength (%p)', async (field, max, cls, base) => {
    expect(await keys(cls as new () => object, { ...base, [field]: 'x'.repeat(max) })).toEqual([]);
    expect(await keys(cls as new () => object, { ...base, [field]: 'x'.repeat(max + 1) })).toContain(`${field}.maxLength`);
  });

  it('coverUrl vượt trần ảnh 1.500.000 ký tự báo maxLength; link https bình thường qua', async () => {
    expect(await keys(CreateCourseDto, { ...course, coverUrl: 'https://res.cloudinary.com/tubu/image/upload/v1/a.jpg' })).toEqual([]);
    expect(await keys(CreateCourseDto, { ...course, coverUrl: `https://x.vn/${'a'.repeat(1_500_000)}` })).toContain('coverUrl.maxLength');
    expect(await keys(UpdateCourseDto, { coverUrl: `https://x.vn/${'a'.repeat(1_500_000)}` })).toContain('coverUrl.maxLength');
  });

  it('mô tả và nội dung chỉ gồm ký tự vô hình bị cắt thành rỗng, tiêu đề toàn ký tự vô hình bị chặn', async () => {
    expect(plainToInstance(CreateCourseDto, { ...course, description: '\u200b \ufeff' }).description).toBe('');
    expect(await keys(CreateCourseDto, { title: '\u200b\u200b' })).toContain('title.isNotEmpty');
    expect(await keys(CreateLessonDto, { ...lesson, title: '\u00a0' })).toContain('title.isNotEmpty');
  });

  it('videoUrl dán thừa khoảng trắng và ký tự vô hình hai đầu được cắt trước khi đếm trần', async () => {
    const dto = plainToInstance(CreateLessonDto, { ...lesson, videoUrl: `\u200b${'y'.repeat(500)}\n` });
    expect(dto.videoUrl).toBe('y'.repeat(500));
    expect(await validate(dto)).toEqual([]);
  });
});
