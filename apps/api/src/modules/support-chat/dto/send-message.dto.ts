import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { IsUploadedMediaUrl } from '../../../common/uploaded-image';

export class SendMessageContextDto {
  @IsOptional() @IsString() @MaxLength(40) orderCode?: string;
  @IsOptional() @IsString() @MaxLength(120) productSlug?: string;
}

export class SendMessageDto {
  @Matches(/^[A-Za-z0-9_-]{8,64}$/, { message: 'clientMsgId phải dài 8–64 ký tự chữ, số, - hoặc _' })
  clientMsgId!: string;

  @IsOptional() @IsString() @MaxLength(1000) body?: string;

  // Chỉ URL Cloudinary: base64 sẽ làm phình bảng tin và tin chuyển sang Zalo.
  @IsOptional() @IsUploadedMediaUrl() imageUrl?: string;

  @IsOptional() @ValidateNested() @Type(() => SendMessageContextDto) context?: SendMessageContextDto;

  @IsOptional() @IsIn(['MINIAPP', 'WEB']) source?: 'MINIAPP' | 'WEB';
}
