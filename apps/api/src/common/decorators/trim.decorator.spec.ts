import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, validate } from 'class-validator';
import { Trim, TrimEach } from './trim.decorator';

class OneDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(5) name!: string;
}
class FreeDto {
  @Trim() value!: unknown;
}
class ManyDto {
  @TrimEach() @IsString({ each: true }) @IsNotEmpty({ each: true }) tags!: string[];
}

describe('Trim', () => {
  it('chuỗi toàn ký tự vô hình (U+200B, U+FEFF, U+2060) thành rỗng và IsNotEmpty báo lỗi', async () => {
    const dto = plainToInstance(OneDto, { name: '\u200b\ufeff\u2060' });
    expect(dto.name).toBe('');
    const errs = await validate(dto);
    expect(errs.flatMap((e) => Object.keys(e.constraints ?? {}))).toContain('isNotEmpty');
  });
  it('U+00A0 và U+200B ở hai đầu bị cắt, MaxLength đếm sau khi cắt', async () => {
    expect(plainToInstance(OneDto, { name: '\u00a0\u200bAn\u200b\u00a0' }).name).toBe('An');
    const ok = plainToInstance(OneDto, { name: '\u00a0\u200babcde\u200b\u00a0' });
    expect(await validate(ok)).toEqual([]);
  });
  it('emoji ghép (ZWJ) và ký tự vô hình ở giữa chuỗi giữ nguyên', () => {
    const family = '👨‍👩‍👧';
    expect(plainToInstance(OneDto, { name: ` ${family} ` }).name).toBe(family);
    expect(plainToInstance(OneDto, { name: 'a\u200bb' }).name).toBe('a\u200bb');
  });
  it('giá trị không phải chuỗi giữ nguyên (số, null, mảng, object, undefined)', () => {
    const obj = { a: 1 };
    const arr = [' x '];
    expect(plainToInstance(FreeDto, { value: 5 }).value).toBe(5);
    expect(plainToInstance(FreeDto, { value: null }).value).toBeNull();
    expect(plainToInstance(FreeDto, { value: arr }).value).toEqual([' x ']);
    expect(plainToInstance(FreeDto, { value: obj }).value).toEqual({ a: 1 });
    expect(plainToInstance(FreeDto, {}).value).toBeUndefined();
  });
});

describe('TrimEach', () => {
  it('cắt từng phần tử chuỗi, giữ phần tử không phải chuỗi và thứ tự', () => {
    const dto = plainToInstance(ManyDto, { tags: [' a ', '\u200bb\u200b', 7, null, '👨‍👩'] });
    expect(dto.tags).toEqual(['a', 'b', 7, null, '👨‍👩']);
  });
  it('phần tử toàn ký tự vô hình thành rỗng và bị IsNotEmpty({each}) chặn', async () => {
    const dto = plainToInstance(ManyDto, { tags: ['ok', '\u200b\u200b'] });
    const errs = await validate(dto);
    expect(errs.flatMap((e) => Object.keys(e.constraints ?? {}))).toContain('isNotEmpty');
  });
  it('giá trị không phải mảng giữ nguyên', () => {
    expect(plainToInstance(ManyDto, { tags: ' x ' as unknown as string[] }).tags).toBe(' x ');
    expect(plainToInstance(ManyDto, {}).tags).toBeUndefined();
  });
});
