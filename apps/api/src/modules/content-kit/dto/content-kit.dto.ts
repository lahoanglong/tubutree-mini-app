import { Allow, ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

// Endpoint upsert CHỈ ADMIN gọi được (content-kit-admin.controller.ts) nên rủi ro thấp, nhưng vẫn
// giới hạn hợp lý để 1 request lỗi/paste nhầm không tạo payload khổng lồ (JSON column không giới
// hạn ở DB) làm phình productContentKit hoặc chậm getForCtv (map/substitute trên mảng lớn).
const MAX_ITEMS = 20;

export class UpsertContentKitDto {
  // Đoạn caption quảng bá (CTV copy nguyên văn) — cho phép dài hơn usps vì thường là cả đoạn văn.
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ITEMS) @IsString({ each: true }) @MaxLength(2000, { each: true }) captions?: string[];
  // Gạch đầu dòng USP ngắn.
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ITEMS) @IsString({ each: true }) @MaxLength(300, { each: true }) usps?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(500, { each: true }) videoUrls?: string[];
  // Mảng {q,a} — validate lỏng như certifications (brand.dto.ts) để không phải khai schema lồng.
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_ITEMS) @Allow() faqs?: { q: string; a: string }[];
}
