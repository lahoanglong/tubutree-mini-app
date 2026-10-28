import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** GET me/points/transactions: không tham số = 100 dòng mới nhất; `before` + `beforeId` = trang kế (dòng cũ hơn mốc). */
export class PointsTransactionsQuery {
  /** createdAt (ISO) của dòng cuối trang trước. */
  @IsOptional()
  @IsDateString()
  before?: string;

  /** id của dòng cuối trang trước, để phân định các dòng cùng createdAt. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  beforeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
