import { CashbackStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsIn, IsNumberString, IsOptional } from 'class-validator';

const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

/**
 * Query của GET /admin/cashback/transactions. `status` lạ hoặc mảng đi thẳng vào where của Prisma
 * thành PrismaClientValidationError (500); `take` không phải số thành NaN. Lấy giá trị hợp lệ từ enum
 * Prisma để không lệch schema.
 */
export class CashbackAdminListQuery {
  @IsOptional() @Transform(emptyToUndefined) @IsIn(Object.values(CashbackStatus)) status?: CashbackStatus;
  @IsOptional() @Transform(emptyToUndefined) @IsNumberString() take?: string;
}
