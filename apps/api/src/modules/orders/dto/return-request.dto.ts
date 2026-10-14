import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsUploadedImage } from '../../../common/uploaded-image';

export class ReturnRequestDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
  // C-050: ảnh minh chứng hiện ở admin web — chặn javascript:/data:text/html/host lạ ngay khi lưu.
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsUploadedImage({}, { each: true }) images?: string[];
}
