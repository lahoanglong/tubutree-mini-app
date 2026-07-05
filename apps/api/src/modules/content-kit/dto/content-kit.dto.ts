import { Allow, IsArray, IsOptional, IsString } from 'class-validator';

export class UpsertContentKitDto {
  @IsOptional() @IsArray() @IsString({ each: true }) captions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) usps?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) videoUrls?: string[];
  // Mảng {q,a} — validate lỏng như certifications (brand.dto.ts) để không phải khai schema lồng.
  @IsOptional() @IsArray() @Allow() faqs?: { q: string; a: string }[];
}
