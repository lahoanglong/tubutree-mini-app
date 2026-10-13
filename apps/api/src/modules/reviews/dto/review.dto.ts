import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
import { IsUploadedImage, PUBLIC_CONTENT_MAX_DATA_URL_LENGTH } from '../../../common/uploaded-image';

export class CreateReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  // Miniapp chưa cấu hình Cloudinary nên ảnh thường là base64 nén (200-500 nghìn ký tự): dùng chung validator ảnh
  // upload với minh chứng đổi/trả (host tin cậy hoặc ảnh raster), không phải trần 500 ký tự của URL.
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsUploadedImage({ maxDataUrlLength: PUBLIC_CONTENT_MAX_DATA_URL_LENGTH }, { each: true }) images?: string[];
  // Review video (UGC §6.14.9) — URL video người dùng tải lên (Cloudinary…).
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(1000) videoUrl?: string;
}
