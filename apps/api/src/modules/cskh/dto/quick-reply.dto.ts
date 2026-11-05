import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Trim, TrimEach } from '../../../common/decorators/trim.decorator';

export class CreateQuickReplyDto {
  @IsOptional() @Trim() @IsString() @MaxLength(60) category?: string;
  @TrimEach() @IsArray() @ArrayMaxSize(50) @IsString({ each: true, message: 'Mỗi từ khoá phải là chuỗi' }) @MaxLength(60, { each: true }) keywords!: string[];
  @Trim() @IsString() @MaxLength(120) title!: string;
  @Trim() @IsString() @MaxLength(2000) content!: string;
  @IsOptional() @IsBoolean() isGreeting?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateQuickReplyDto {
  @OptionalNotNull() @Trim() @IsString() @MaxLength(60) category?: string;
  @OptionalNotNull() @TrimEach() @IsArray() @ArrayMaxSize(50) @IsString({ each: true, message: 'Mỗi từ khoá phải là chuỗi' }) @MaxLength(60, { each: true }) keywords?: string[];
  @OptionalNotNull() @Trim() @IsString() @MaxLength(120) title?: string;
  @OptionalNotNull() @Trim() @IsString() @MaxLength(2000) content?: string;
  @OptionalNotNull() @IsBoolean() isGreeting?: boolean;
  @OptionalNotNull() @IsInt() @Min(0) sortOrder?: number;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
}
