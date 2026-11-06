import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { IsUploadedImage, IsUploadedMediaUrl, PUBLIC_CONTENT_IMAGE } from '../../../common/uploaded-image';
import { Trim } from '../../../common/decorators/trim.decorator';
import { KeysetCursorField } from '../../../common/keyset-cursor';

export class CreateReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @Trim() @IsString() @MaxLength(2000) comment?: string;
  // Đánh giá hiện công khai và có thưởng Điểm Xanh theo media (MONEY-10): chỉ ảnh đã tải lên Cloudinary, hoặc ảnh
  // raster base64 nén khi miniapp chưa cấu hình Cloudinary (ENGAGE-6). Chuỗi bất kỳ/host lạ/SVG bị chặn.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUploadedImage({ ...PUBLIC_CONTENT_IMAGE, verifySignature: true }, { each: true, message: 'Ảnh đánh giá phải là ảnh đã tải lên từ ứng dụng.' })
  images?: string[];
  // Review video (UGC §6.14.9) — chỉ video khách tải lên Cloudinary qua ứng dụng; không có đường base64.
  @IsOptional() @IsUploadedMediaUrl({ message: 'Video đánh giá phải là video đã tải lên từ ứng dụng.' }) videoUrl?: string;
  // Lần mua (đơn) được đánh giá: mỗi đơn đã nhận một đánh giá. Đơn đã có đánh giá thì lần gửi này sửa nó.
  @IsOptional() @IsString() @MaxLength(64) orderId?: string;
}

export const REVIEW_MEDIA_FILTERS = ['photo', 'video'] as const;
export type ReviewMediaFilter = (typeof REVIEW_MEDIA_FILTERS)[number];

/** Bộ lọc danh sách đánh giá công khai: số sao và/hoặc có ảnh, có video. Lọc trong truy vấn, không trên 100 dòng đã trả. */
export class PublicReviewsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsIn(REVIEW_MEDIA_FILTERS) media?: ReviewMediaFilter;
  /** `nextCursor` của trang trước (cùng bộ lọc). Không gửi là trang đầu, như trước khi có phân trang. */
  @KeysetCursorField() cursor?: string;
}
