import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Trim, TrimEach } from '../../../common/decorators/trim.decorator';

// Endpoint upsert CHỈ ADMIN gọi được (content-kit-admin.controller.ts) nên rủi ro thấp, nhưng vẫn
// giới hạn hợp lý để 1 request lỗi/paste nhầm không tạo payload khổng lồ (JSON column không giới
// hạn ở DB) làm phình productContentKit hoặc chậm getForCtv (map/substitute trên mảng lớn).
const MAX_ITEMS = 20;

/** Một câu hỏi thường gặp của bộ nội dung; CTV đọc nguyên văn nên có trần từng trường. */
export class ContentKitFaqDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(300) q!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(2000) a!: string;
}

export class UpsertContentKitDto {
  // Đoạn caption quảng bá (CTV copy nguyên văn) — cho phép dài hơn usps vì thường là cả đoạn văn.
  @OptionalNotNull() @TrimEach() @IsArray() @ArrayMaxSize(MAX_ITEMS) @IsString({ each: true }) @MaxLength(2000, { each: true }) captions?: string[];
  // Gạch đầu dòng USP ngắn.
  @OptionalNotNull() @TrimEach() @IsArray() @ArrayMaxSize(MAX_ITEMS) @IsString({ each: true }) @MaxLength(300, { each: true }) usps?: string[];
  @OptionalNotNull() @TrimEach() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(500, { each: true }) videoUrls?: string[];
  @OptionalNotNull() @IsArray() @ArrayMaxSize(MAX_ITEMS) @ValidateNested({ each: true }) @Type(() => ContentKitFaqDto) faqs?: ContentKitFaqDto[];
}
