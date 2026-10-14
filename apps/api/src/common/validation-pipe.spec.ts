import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
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
    expect(await messagesOf({ question: '' })).toEqual(['question không được để trống.']);
    expect(await messagesOf({ question: 1 })).toEqual(['question phải là chuỗi ký tự.']);
    expect(await messagesOf({ question: 'q', rating: 1.5 })).toEqual(['rating phải là số nguyên.']);
    expect(await messagesOf({ question: 'q', rating: 0 })).toEqual(['rating không được nhỏ hơn 1.']);
    expect(await messagesOf({ question: 'q', rating: 9 })).toEqual(['rating không được lớn hơn 5.']);
    expect(await messagesOf({ question: 'q', code: 'ab' })).toEqual(['code phải có ít nhất 3 ký tự.']);
    expect(await messagesOf({ question: 'q', code: 'abcdef' })).toEqual(['code tối đa 5 ký tự.']);
    expect(await messagesOf({ question: 'q', kind: 'C' })).toEqual(['kind phải là một trong: A, B.']);
    expect(await messagesOf({ question: 'q', flag: 'yes' })).toEqual(['flag phải là true/false.']);
    expect(await messagesOf({ question: 'q', startAt: 'abc' })).toEqual(['startAt phải là ngày giờ hợp lệ (ISO 8601).']);
  });

  it('trường lạ bị chặn với câu tiếng Việt', async () => {
    expect(await messagesOf({ question: 'q', foo: 1 })).toEqual(['Trường foo không được gửi lên.']);
  });

  it('thông báo tự viết (đã tiếng Việt) giữ nguyên; lỗi lồng nhau có đường dẫn', async () => {
    expect(await messagesOf({ question: 'q', name: 'x'.repeat(11) })).toEqual(['Tên tối đa 10 ký tự.']);
    expect(await messagesOf({ question: 'q', child: { qty: 'a' } })).toEqual(['child.qty phải là số nguyên.']);
  });

  it('dữ liệu hợp lệ vẫn qua, transform như cũ', async () => {
    await expect(pipe.transform({ question: 'q', rating: 3 }, { type: 'body', metatype: Body, data: undefined })).resolves.toMatchObject({
      question: 'q',
      rating: 3,
    });
  });
});
