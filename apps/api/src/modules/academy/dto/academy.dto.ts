import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IsImageRef } from '../../../common/uploaded-image';
import { Trim } from '../../../common/decorators/trim.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

// Ảnh bìa là link https hoặc ảnh base64 nén (cùng trần IMAGE_MAX của brand/storefront); mô tả khoá là đoạn ngắn, bài viết là
// văn bản dài. Trần chọn rộng vì chưa có khoá học nào trên PROD, chỉ để chặn payload vô hạn từ một request lỗi.
const COVER_MAX = 1_500_000;
const DESCRIPTION_MAX = 5000;
const BODY_MAX = 50_000;
const VIDEO_URL_MAX = 500;

export class CreateCourseDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsOptional() @Trim() @IsString() @MaxLength(DESCRIPTION_MAX) description?: string;
  @IsOptional() @IsString() @MaxLength(COVER_MAX) @IsImageRef() coverUrl?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateCourseDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @OptionalNotNull() @Trim() @IsString() @MaxLength(DESCRIPTION_MAX) description?: string;
  @OptionalNotNull() @IsString() @MaxLength(COVER_MAX) @IsImageRef() coverUrl?: string;
  @OptionalNotNull() @IsInt() @Min(0) sortOrder?: number;
  @OptionalNotNull() @IsBoolean() isPublished?: boolean;
}

export class CreateLessonDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title!: string;
  @IsIn(['VIDEO', 'ARTICLE']) contentType!: 'VIDEO' | 'ARTICLE';
  @IsOptional() @Trim() @IsString() @MaxLength(VIDEO_URL_MAX) videoUrl?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(BODY_MAX) body?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateLessonDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(200) title?: string;
  @OptionalNotNull() @IsIn(['VIDEO', 'ARTICLE']) contentType?: 'VIDEO' | 'ARTICLE';
  @OptionalNotNull() @Trim() @IsString() @MaxLength(VIDEO_URL_MAX) videoUrl?: string;
  @OptionalNotNull() @Trim() @IsString() @MaxLength(BODY_MAX) body?: string;
  @OptionalNotNull() @IsInt() @Min(0) sortOrder?: number;
}
