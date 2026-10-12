import { Transform } from 'class-transformer';
import { IsNumberString, IsOptional, IsString } from 'class-validator';

// Query rỗng (`?take=`) trước đây được controller coi như không gửi (`take ?` / `cursor ||`).
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

/**
 * Query phân trang cursor dùng chung (`cursor` + `take`). Giữ nguyên là chuỗi để các service/clampTake
 * hiện có tiếp tục kẹp giá trị; DTO chỉ chặn đầu vào mà Prisma sẽ từ chối bằng PrismaClientValidationError
 * (→ 500): `take` không phải số (NaN) và `cursor` là mảng/object (?cursor=a&cursor=b, ?cursor[x]=y).
 */
export class CursorPageQuery {
  @IsOptional() @Transform(emptyToUndefined) @IsString() cursor?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsNumberString() take?: string;
}
