import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

export class CreateCourseDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateCourseDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @OptionalNotNull() @IsString() description?: string;
  @OptionalNotNull() @IsString() coverUrl?: string;
  @OptionalNotNull() @IsInt() @Min(0) sortOrder?: number;
  @OptionalNotNull() @IsBoolean() isPublished?: boolean;
}

export class CreateLessonDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsIn(['VIDEO', 'ARTICLE']) contentType!: 'VIDEO' | 'ARTICLE';
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateLessonDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @OptionalNotNull() @IsIn(['VIDEO', 'ARTICLE']) contentType?: 'VIDEO' | 'ARTICLE';
  @OptionalNotNull() @IsString() videoUrl?: string;
  @OptionalNotNull() @IsString() body?: string;
  @OptionalNotNull() @IsInt() @Min(0) sortOrder?: number;
}
