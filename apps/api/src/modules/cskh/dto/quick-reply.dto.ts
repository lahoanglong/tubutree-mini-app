import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';

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
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true, message: 'Mỗi từ khoá phải là chuỗi' }) @MaxLength(60, { each: true }) keywords?: string[];
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(2000) content?: string;
  @IsOptional() @IsBoolean() isGreeting?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
