import { IsOptional, IsString } from 'class-validator';

/**
 * Query khoảng thời gian của lịch ca/chấm công. Chỉ ép kiểu chuỗi: thiếu/không hợp lệ vẫn do controller
 * trả đúng thông điệp 400 cũ. Không khai báo thì ValidationPipe (transform) ép mảng/object thành chuỗi "a,b" hay
 * "[object Object]" rồi chạy tiếp như giá trị thật; @IsString chặn lại để trả 400 rõ ràng.
 */
export class DateRangeQuery {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class AdminShiftsQuery extends DateRangeQuery {
  // Cùng lý do với from/to: staffId mảng/object không được ép thầm thành chuỗi rồi đi vào where.
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
