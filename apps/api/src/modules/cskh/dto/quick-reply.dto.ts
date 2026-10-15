import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

export class CreateQuickReplyDto {
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true, message: 'Mỗi từ khoá phải là chuỗi' }) @MaxLength(60, { each: true }) keywords!: string[];
  @IsString() @MaxLength(120) title!: string;
  @IsString() @MaxLength(2000) content!: string;
  @IsOptional() @IsBoolean() isGreeting?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateQuickReplyDto {
  @OptionalNotNull() @IsString() @MaxLength(60) category?: string;
  @OptionalNotNull() @IsArray() @ArrayMaxSize(50) @IsString({ each: true, message: 'Mỗi từ khoá phải là chuỗi' }) @MaxLength(60, { each: true }) keywords?: string[];
  @OptionalNotNull() @IsString() @MaxLength(120) title?: string;
  @OptionalNotNull() @IsString() @MaxLength(2000) content?: string;
  @OptionalNotNull() @IsBoolean() isGreeting?: boolean;
  @OptionalNotNull() @IsInt() @Min(0) sortOrder?: number;
  @OptionalNotNull() @IsBoolean() isActive?: boolean;
}
