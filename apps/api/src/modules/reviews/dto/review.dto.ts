import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateBy } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import { isUploadedReviewMedia } from '../review-media';

function IsUploadedReviewMedia(message: string, options?: ValidationOptions) {
  return ValidateBy({ name: 'isUploadedReviewMedia', validator: { validate: isUploadedReviewMedia } }, { ...options, message });
}

export class CreateReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUploadedReviewMedia('Ảnh đánh giá phải là ảnh đã tải lên từ ứng dụng.', { each: true })
  images?: string[];
  // Review video (UGC §6.14.9) — video khách tải lên Cloudinary qua ứng dụng.
  @IsOptional() @IsUploadedReviewMedia('Video đánh giá phải là video đã tải lên từ ứng dụng.') videoUrl?: string;
}
