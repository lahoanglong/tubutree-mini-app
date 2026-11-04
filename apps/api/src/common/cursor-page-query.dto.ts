import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';

// Query rỗng (`?take=`) trước đây được controller coi như không gửi (`take ?` / `cursor ||`).
export const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

/**
 * Query phân trang cursor dùng chung (`cursor` + `take`). Giữ nguyên là chuỗi để các service/clampTake
 * hiện có tiếp tục kẹp giá trị; DTO chặn đầu vào mà Prisma sẽ từ chối bằng PrismaClientValidationError
 * (→ 500) hoặc làm tràn int: `take` không phải số nguyên dương tối đa 4 chữ số ("1.5", "1e3", "-1") và `cursor` là
 * mảng/object (?cursor=a&cursor=b, ?cursor[x]=y).
 */
export class CursorPageQuery {
  @IsOptional() @Transform(emptyToUndefined) @IsString() cursor?: string;
  @IsOptional() @Transform(emptyToUndefined) @Matches(/^[1-9]\d{0,3}$/, { message: 'take phải là số nguyên dương tối đa 4 chữ số.' }) take?: string;
}
