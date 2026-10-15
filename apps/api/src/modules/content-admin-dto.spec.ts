import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '../common/validation-pipe';
import { CreateFaqDto, UpdateFaqDto } from './faq/dto/faq.dto';
import { CreateCourseDto, CreateLessonDto, UpdateCourseDto } from './academy/dto/academy.dto';
import { CreateSaleDto } from './flash-sale/flash-sale-admin.controller';

const pipe = createValidationPipe();
async function run(metatype: new () => object, value: Record<string, unknown>) {
  return pipe.transform(value, { type: 'body', metatype, data: undefined });
}
async function messagesOf(metatype: new () => object, value: Record<string, unknown>): Promise<string[]> {
  try {
    await run(metatype, value);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return ((e as BadRequestException).getResponse() as { message: string[] }).message;
  }
  throw new Error('không ném lỗi');
}

describe('DTO nội dung admin: không nhận chuỗi rỗng/toàn khoảng trắng (ADMINOPS-16)', () => {
  it('FAQ toàn khoảng trắng → 400 tiếng Việt; có chữ thì được cắt khoảng trắng hai đầu', async () => {
    expect(await messagesOf(CreateFaqDto, { question: '   ', answer: '  ' })).toEqual([
      'Câu hỏi không được để trống.',
      'Câu trả lời không được để trống.',
    ]);
    expect(await messagesOf(UpdateFaqDto, { question: ' ' })).toEqual(['Câu hỏi không được để trống.']);
    await expect(run(CreateFaqDto, { question: '  Ship bao lâu? ', answer: ' 2 ngày ' })).resolves.toMatchObject({
      question: 'Ship bao lâu?',
      answer: '2 ngày',
    });
  });

  it('khoá học/bài học tiêu đề rỗng → 400', async () => {
    expect(await messagesOf(CreateCourseDto, { title: '' })).toEqual(['Tiêu đề không được để trống.']);
    expect(await messagesOf(UpdateCourseDto, { title: '  ' })).toEqual(['Tiêu đề không được để trống.']);
    expect(await messagesOf(CreateLessonDto, { title: ' ', contentType: 'VIDEO' })).toEqual(['Tiêu đề không được để trống.']);
    await expect(run(CreateCourseDto, { title: ' Trồng rau ' })).resolves.toMatchObject({ title: 'Trồng rau' });
  });

  it('đợt giờ vàng: tiêu đề rỗng và ngày không phải ISO → 400', async () => {
    expect(await messagesOf(CreateSaleDto, { title: ' ', startAt: 'abc', endAt: '2099-01-01T00:00:00Z' })).toEqual([
      'Tiêu đề không được để trống.',
      'Thời gian bắt đầu phải là ngày giờ hợp lệ (ISO 8601).',
    ]);
  });
});
