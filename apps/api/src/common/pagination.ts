import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Trần trang của phân trang OFFSET: trang N bắt Postgres đọc rồi bỏ (N-1)×limit dòng, nên trang sâu là cách rẻ nhất để một
 * request quét cả bảng. Cần dữ liệu cũ hơn thì thu hẹp bộ lọc hoặc tìm kiếm.
 */
export const MAX_PAGE = 1000;
export const PAGE_TOO_DEEP_MSG = `Chỉ xem được tối đa ${MAX_PAGE} trang. Hãy thu hẹp bộ lọc hoặc dùng ô tìm kiếm để tìm dữ liệu cũ hơn.`;

/** Query phân trang chuẩn (Build Spec §12.1). */
export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE, { message: PAGE_TOO_DEEP_MSG })
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export function paginated<T>(data: T[], page: number, limit: number, total: number): PaginatedResult<T> {
  return { data, meta: { page, limit, total } };
}

/** Kẹp `take` từ query string vào [1, max]; thiếu/không phải số thì dùng mặc định. */
export function clampTake(raw: unknown, def: number, max: number): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(Math.floor(n), 1), max);
}

export function skipTake(page: number, limit: number): { skip: number; take: number } {
  return { skip: (page - 1) * limit, take: limit };
}
