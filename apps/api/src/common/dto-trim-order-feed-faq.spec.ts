import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFaqDto, UpdateFaqDto } from '../modules/faq/dto/faq.dto';
import { CommentDto, ReportDto } from '../modules/feed/community-feed.controller';
import { UpdateOrderStatusDto } from '../modules/admin/admin.controller';

/** Các DTO đã có @MaxLength từ trước: Trim chạy trước nên trần và "không rỗng" đo trên chuỗi đã cắt ký tự vô hình. */
async function keys<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const errs = await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true });
  return errs.flatMap((e) => Object.keys(e.constraints ?? {}).map((k) => `${e.property}.${k}`));
}
const ZW = '\u200b';
const faq = { question: 'Giao hàng bao lâu?', answer: '2 đến 3 ngày.' };

describe('FAQ: category', () => {
  it('category chỉ có ký tự vô hình bị cắt thành rỗng; vẫn giữ trần 100 trên chuỗi đã cắt', async () => {
    expect(plainToInstance(CreateFaqDto, { ...faq, category: `${ZW}\u00a0` }).category).toBe('');
    expect(plainToInstance(UpdateFaqDto, { category: ` Giao hàng${ZW}` }).category).toBe('Giao hàng');
    expect(await keys(CreateFaqDto, { ...faq, category: `${ZW}${'c'.repeat(100)}${ZW}` })).toEqual([]);
    expect(await keys(CreateFaqDto, { ...faq, category: 'c'.repeat(101) })).toContain('category.maxLength');
    expect(await keys(UpdateFaqDto, { category: 'c'.repeat(101) })).toContain('category.maxLength');
  });
  it('câu hỏi/trả lời toàn U+200B bị chặn; 501 và 4001 ký tự bị chặn', async () => {
    expect(await keys(CreateFaqDto, { question: ZW.repeat(3), answer: ZW })).toEqual(expect.arrayContaining(['question.isNotEmpty', 'answer.isNotEmpty']));
    expect(await keys(UpdateFaqDto, { question: ZW })).toContain('question.isNotEmpty');
    expect(await keys(CreateFaqDto, { question: 'q'.repeat(501), answer: 'a'.repeat(4001) })).toEqual(expect.arrayContaining(['question.maxLength', 'answer.maxLength']));
  });
});

describe('Cộng đồng: bình luận và báo cáo', () => {
  it('CommentDto.body toàn U+200B bị chặn minLength; 501 ký tự bị chặn; 500 qua', async () => {
    expect(await keys(CommentDto, { body: `${ZW}${ZW}` })).toContain('body.minLength');
    expect(await keys(CommentDto, { body: 'b'.repeat(501) })).toContain('body.maxLength');
    expect(await keys(CommentDto, { body: `${ZW}${'b'.repeat(500)}\u00a0` })).toEqual([]);
  });
  it('ReportDto.reason được cắt hai đầu; 501 ký tự bị chặn', async () => {
    expect(plainToInstance(ReportDto, { targetType: 'POST', reason: `${ZW} spam ${ZW}` }).reason).toBe('spam');
    expect(await keys(ReportDto, { targetType: 'POST', reason: 'r'.repeat(501) })).toContain('reason.maxLength');
    expect(await keys(ReportDto, { targetType: 'POST', reason: 'r'.repeat(500) })).toEqual([]);
  });
});

describe('Admin đổi trạng thái đơn: note là lý do huỷ/trả khách đọc', () => {
  it('note 501 ký tự bị chặn, 500 qua (đo sau khi cắt)', async () => {
    expect(await keys(UpdateOrderStatusDto, { status: 'CANCELLED', note: 'n'.repeat(501) })).toContain('note.maxLength');
    expect(await keys(UpdateOrderStatusDto, { status: 'CANCELLED', note: `${ZW}${'n'.repeat(500)} ` })).toEqual([]);
  });
  it('note toàn ký tự vô hình thành chuỗi rỗng sau khi cắt (không còn là "một ký tự lạ" lọt vào thông báo khách)', () => {
    expect(plainToInstance(UpdateOrderStatusDto, { status: 'CANCELLED', note: `${ZW}\ufeff` }).note).toBe('');
    expect(plainToInstance(UpdateOrderStatusDto, { status: 'CANCELLED', note: '  Hết hàng ' }).note).toBe('Hết hàng');
  });
});
