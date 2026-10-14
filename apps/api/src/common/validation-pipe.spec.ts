import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsUploadedImage } from './uploaded-image';
import { createValidationPipe } from './validation-pipe';

class Child {
  @IsInt() qty!: number;
}

class Body {
  @IsString() @IsNotEmpty() question!: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(5) code?: string;
  @IsOptional() @IsIn(['A', 'B']) kind?: string;
  @IsOptional() @IsBoolean() flag?: boolean;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsString() @MaxLength(10, { message: 'Tên tối đa 10 ký tự.' }) name?: string;
  @IsOptional() @ValidateNested() @Type(() => Child) child?: Child;
}

const pipe = createValidationPipe();
async function messagesOf(value: Record<string, unknown>): Promise<string[]> {
  try {
    await pipe.transform(value, { type: 'body', metatype: Body, data: undefined });
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const res = (e as BadRequestException).getResponse() as { message: string[]; statusCode: number };
    expect(res.statusCode).toBe(400);
    return res.message;
  }
  throw new Error('không ném lỗi');
}

describe('createValidationPipe — thông báo kiểm tra dữ liệu bằng tiếng Việt (ADMINOPS-16)', () => {
  it('lỗi mặc định của class-validator được dịch, giữ dạng mảng message như trước', async () => {
    expect(await messagesOf({ question: '' })).toEqual(['Câu hỏi không được để trống.']);
    expect(await messagesOf({ question: 1 })).toEqual(['Câu hỏi phải là chuỗi ký tự.']);
    expect(await messagesOf({ question: 'q', rating: 1.5 })).toEqual(['Số sao phải là số nguyên.']);
    expect(await messagesOf({ question: 'q', rating: 0 })).toEqual(['Số sao không được nhỏ hơn 1.']);
    expect(await messagesOf({ question: 'q', rating: 9 })).toEqual(['Số sao không được lớn hơn 5.']);
    expect(await messagesOf({ question: 'q', code: 'ab' })).toEqual(['Mã phải có ít nhất 3 ký tự.']);
    expect(await messagesOf({ question: 'q', code: 'abcdef' })).toEqual(['Mã không được dài quá 5 ký tự.']);
    expect(await messagesOf({ question: 'q', kind: 'C' })).toEqual(['Trường «kind» chỉ nhận một trong: A, B.']);
    expect(await messagesOf({ question: 'q', flag: 'yes' })).toEqual(['Trường «flag» chỉ nhận đúng hoặc sai.']);
    expect(await messagesOf({ question: 'q', startAt: 'abc' })).toEqual(['Thời gian bắt đầu phải là ngày giờ hợp lệ (ISO 8601).']);
  });

  it('trường lạ bị chặn với câu tiếng Việt', async () => {
    expect(await messagesOf({ question: 'q', foo: 1 })).toEqual(['Không nhận trường «foo».']);
  });

  it('thông báo tự viết (đã tiếng Việt) giữ nguyên; lỗi lồng nhau có đường dẫn', async () => {
    expect(await messagesOf({ question: 'q', name: 'x'.repeat(11) })).toEqual(['Tên tối đa 10 ký tự.']);
    expect(await messagesOf({ question: 'q', child: { qty: 'a' } })).toEqual(['Trường «qty» phải là số nguyên.']);
  });

  it('dữ liệu hợp lệ vẫn qua, transform như cũ', async () => {
    await expect(pipe.transform({ question: 'q', rating: 3 }, { type: 'body', metatype: Body, data: undefined })).resolves.toMatchObject({
      question: 'q',
      rating: 3,
    });
  });
});

class LineDto {
  @IsInt() @Min(1) quantity!: number;
}
class SampleDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MinLength(5) @MaxLength(20) comment?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(2) @IsUploadedImage({}, { each: true }) images?: string[];
  @IsOptional() @IsIn(['COD', 'BANK']) method?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LineDto) items?: LineDto[];
}

const runSample = (value: Record<string, unknown>) => pipe.transform(value, { type: 'body', metatype: SampleDto, data: undefined });

async function sampleMessagesOf(value: Record<string, unknown>): Promise<string[]> {
  try {
    await runSample(value);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const body = (e as BadRequestException).getResponse() as { message: string[]; statusCode: number; error: string };
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    return body.message;
  }
  throw new Error('không ném lỗi');
}

// ENGAGE-6: ValidationPipe mặc định trả câu tiếng Anh kỹ thuật ("each value in images must be shorter than...")
// và miniapp hiện nguyên văn message[0] cho khách.
describe('createValidationPipe — thông điệp lỗi tiếng Việt', () => {
  it('giữ cấu hình toàn cục: whitelist + forbidNonWhitelisted + transform', async () => {
    await expect(runSample({ rating: 5, lạ: 1 })).rejects.toBeInstanceOf(BadRequestException);
    const ok = (await runSample({ rating: 5 })) as SampleDto;
    expect(ok).toBeInstanceOf(SampleDto);
  });

  it('khoảng giá trị và độ dài có số cụ thể', async () => {
    expect(await sampleMessagesOf({ rating: 9 })).toEqual(['Số sao không được lớn hơn 5.']);
    expect(await sampleMessagesOf({ rating: 0 })).toEqual(['Số sao không được nhỏ hơn 1.']);
    expect(await sampleMessagesOf({ rating: 5, comment: 'ngắn' })).toEqual(['Nội dung đánh giá phải có ít nhất 5 ký tự.']);
    expect(await sampleMessagesOf({ rating: 5, comment: 'x'.repeat(21) })).toEqual(['Nội dung đánh giá không được dài quá 20 ký tự.']);
  });

  it('kiểu dữ liệu, giá trị cho phép, email, thiếu trường', async () => {
    expect(await sampleMessagesOf({ rating: 'năm' })).toEqual(
      expect.arrayContaining(['Số sao phải là số nguyên.']),
    );
    expect(await sampleMessagesOf({ rating: 5, method: 'CASH' })).toEqual([expect.stringMatching(/^Trường «method» chỉ nhận một trong: COD, BANK\.$/)]);
    expect(await sampleMessagesOf({ rating: 5, email: 'abc' })).toEqual(['Email không hợp lệ.']);
    expect(await sampleMessagesOf({})).toEqual(expect.arrayContaining(['Số sao phải là số nguyên.']));
  });

  it('trường lạ bị từ chối bằng tiếng Việt', async () => {
    expect(await sampleMessagesOf({ rating: 5, status: 'X' })).toEqual(['Không nhận trường «status».']);
  });

  it('mảng: mỗi phần tử và số phần tử tối đa', async () => {
    expect(await sampleMessagesOf({ rating: 5, images: ['a', 'b', 'c'] })).toEqual(
      expect.arrayContaining(['Ảnh chỉ được có tối đa 2 mục.']),
    );
    const eachMsg = await sampleMessagesOf({ rating: 5, images: ['javascript:alert(1)'] });
    expect(eachMsg).toHaveLength(1);
    expect(eachMsg[0]).toMatch(/chỉ nhận ảnh đã tải lên/);
  });

  it('lỗi lồng nhau mang đường dẫn tới phần tử', async () => {
    expect(await sampleMessagesOf({ rating: 5, items: [{ quantity: 0 }] })).toEqual(['Số lượng (mục 1) không được nhỏ hơn 1.']);
  });

  it('không còn câu tiếng Anh nào lọt ra', async () => {
    const all = [
      ...(await sampleMessagesOf({ rating: 9, comment: 1, method: 'Z', email: 'x', images: 'a', lạ: 1 })),
    ].join(' ');
    expect(all).not.toMatch(/\b(must|should|each value|property)\b/);
  });
});
