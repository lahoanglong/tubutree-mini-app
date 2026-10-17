import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { truncateCodePoints } from '../../../common/truncate-code-points';

/** Tên SP dài nhất cỡ vài chục ký tự; từ khoá dài hơn chỉ tốn công gấp dấu/LIKE mà không khớp thêm gì. */
export const SEARCH_Q_MAX_LENGTH = 100;

export class SuggestQuery {
  // Ô gợi ý gõ tới đâu gọi tới đó: cắt thay vì 400 để người gõ không thấy lỗi. Mảng giữ nguyên cho IsString từ chối.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? truncateCodePoints(value, SEARCH_Q_MAX_LENGTH) : value))
  @IsString()
  q?: string;
}
