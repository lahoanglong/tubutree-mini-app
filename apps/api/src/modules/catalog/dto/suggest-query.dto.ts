import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Tên SP dài nhất cỡ vài chục ký tự; từ khoá dài hơn chỉ tốn công gấp dấu/LIKE mà không khớp thêm gì. */
export const SEARCH_Q_MAX_LENGTH = 100;

export class SuggestQuery {
  @IsOptional() @IsString() @MaxLength(SEARCH_Q_MAX_LENGTH) q?: string;
}
