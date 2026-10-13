import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

export class CreateCourseDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateCourseDto {
  @IsOptional() @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class CreateLessonDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsIn(['VIDEO', 'ARTICLE']) contentType!: 'VIDEO' | 'ARTICLE';
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateLessonDto {
  @IsOptional() @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @IsOptional() @IsIn(['VIDEO', 'ARTICLE']) contentType?: 'VIDEO' | 'ARTICLE';
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
