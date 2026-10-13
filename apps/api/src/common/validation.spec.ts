import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsUploadedImage } from './uploaded-image';
import { createValidationPipe } from './validation';

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

const pipe = createValidationPipe();
const run = (value: Record<string, unknown>) => pipe.transform(value, { type: 'body', metatype: SampleDto, data: undefined });

async function messagesOf(value: Record<string, unknown>): Promise<string[]> {
  try {
    await run(value);
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
    await expect(run({ rating: 5, lạ: 1 })).rejects.toBeInstanceOf(BadRequestException);
    const ok = (await run({ rating: 5 })) as SampleDto;
    expect(ok).toBeInstanceOf(SampleDto);
  });

  it('khoảng giá trị và độ dài có số cụ thể', async () => {
    expect(await messagesOf({ rating: 9 })).toEqual(['Số sao không được lớn hơn 5.']);
    expect(await messagesOf({ rating: 0 })).toEqual(['Số sao không được nhỏ hơn 1.']);
    expect(await messagesOf({ rating: 5, comment: 'ngắn' })).toEqual(['Nội dung đánh giá phải có ít nhất 5 ký tự.']);
    expect(await messagesOf({ rating: 5, comment: 'x'.repeat(21) })).toEqual(['Nội dung đánh giá không được dài quá 20 ký tự.']);
  });

  it('kiểu dữ liệu, giá trị cho phép, email, thiếu trường', async () => {
    expect(await messagesOf({ rating: 'năm' })).toEqual(
      expect.arrayContaining(['Số sao phải là số nguyên.']),
    );
    expect(await messagesOf({ rating: 5, method: 'CASH' })).toEqual([expect.stringMatching(/^Trường «method» chỉ nhận một trong: COD, BANK\.$/)]);
    expect(await messagesOf({ rating: 5, email: 'abc' })).toEqual(['Email không hợp lệ.']);
    expect(await messagesOf({})).toEqual(expect.arrayContaining(['Số sao phải là số nguyên.']));
  });

  it('trường lạ bị từ chối bằng tiếng Việt', async () => {
    expect(await messagesOf({ rating: 5, status: 'X' })).toEqual(['Không nhận trường «status».']);
  });

  it('mảng: mỗi phần tử và số phần tử tối đa', async () => {
    expect(await messagesOf({ rating: 5, images: ['a', 'b', 'c'] })).toEqual(
      expect.arrayContaining(['Ảnh chỉ được có tối đa 2 mục.']),
    );
    const eachMsg = await messagesOf({ rating: 5, images: ['javascript:alert(1)'] });
    expect(eachMsg).toHaveLength(1);
    expect(eachMsg[0]).toMatch(/chỉ nhận ảnh đã tải lên/);
  });

  it('lỗi lồng nhau mang đường dẫn tới phần tử', async () => {
    expect(await messagesOf({ rating: 5, items: [{ quantity: 0 }] })).toEqual(['Số lượng (mục 1) không được nhỏ hơn 1.']);
  });

  it('không còn câu tiếng Anh nào lọt ra', async () => {
    const all = [
      ...(await messagesOf({ rating: 9, comment: 1, method: 'Z', email: 'x', images: 'a', lạ: 1 })),
    ].join(' ');
    expect(all).not.toMatch(/\b(must|should|each value|property)\b/);
  });
});
