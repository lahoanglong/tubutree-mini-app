import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

export class CreateFaqDto {
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  // Giới hạn độ dài: FAQ được nạp nguyên văn vào system prompt của AI tư vấn
  // (AiAdvisorService) — không chặn size thì 1 entry quá dài vẫn phình token/chi phí
  // dù đã giới hạn SỐ LƯỢNG FAQ nạp vào prompt (MAX_FAQ_IN_PROMPT).
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) question!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(4000) answer!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFaqDto {
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @Trim() @IsString() @IsNotEmpty() @MaxLength(500) question?: string;
  @IsOptional() @Trim() @IsString() @IsNotEmpty() @MaxLength(4000) answer?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
