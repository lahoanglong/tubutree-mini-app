import { IsOptional, IsString } from 'class-validator';

/**
 * Query khoảng thời gian của lịch ca/chấm công. Chỉ ép kiểu chuỗi: thiếu/không hợp lệ vẫn do controller
 * trả đúng thông điệp 400 cũ. Mảng/object (?from=a&from=b) bị chặn ở đây vì Prisma coi là sai kiểu → 500.
 */
export class DateRangeQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class AdminShiftsQuery extends DateRangeQuery {
  // staffId mảng/object đi thẳng vào where của Prisma → PrismaClientValidationError (500).
  @IsOptional() @IsString() staffId?: string;
}

/** Query kỳ lương. `reprice` chỉ nhận '1'/'true' ở controller, giá trị khác coi như tắt. */
export class YearMonthQuery {
  @IsOptional() @IsString() year?: string;
  @IsOptional() @IsString() month?: string;
}

export class RecomputePayrollQuery extends YearMonthQuery {
  @IsOptional() @IsString() reprice?: string;
}
