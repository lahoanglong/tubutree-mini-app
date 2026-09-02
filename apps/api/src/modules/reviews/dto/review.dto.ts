import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(500, { each: true }) images?: string[];
  // Review video (UGC §6.14.9) — URL video người dùng tải lên (Cloudinary…).
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(1000) videoUrl?: string;
}
