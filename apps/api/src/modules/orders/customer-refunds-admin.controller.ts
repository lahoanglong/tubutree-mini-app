import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { CustomerRefundsService } from './customer-refunds.service';

/** OPEN = mọi khoản còn việc (chờ đối soát, chờ chuyển khoản, đang chuyển khoản) — cùng tập với thẻ "Hoàn tiền khách". */
const CUSTOMER_REFUND_STATUSES = ['OPEN', 'UNVERIFIED', 'PENDING', 'PROCESSING', 'COMPLETED', 'DISMISSED'] as const;
const CUSTOMER_REFUND_KINDS = ['END_CUSTOMER', 'CANCEL', 'RETURN', 'LATE_PAYMENT', 'OVERPAYMENT'] as const;

export class ListCustomerRefundsQuery extends PaginationQuery {
  @IsOptional() @IsIn(CUSTOMER_REFUND_STATUSES) status?: (typeof CUSTOMER_REFUND_STATUSES)[number];
  @IsOptional() @IsIn(CUSTOMER_REFUND_KINDS) kind?: (typeof CUSTOMER_REFUND_KINDS)[number];
}

/** Admin khác người đang chuyển khoản phải chọn tiếp quản tường minh kèm lý do (ghi vào lịch sử đơn). */
export class TakeOverRefundDto {
  @IsOptional() @IsBoolean() takeOver?: boolean;
  @IsOptional() @IsString() @MaxLength(300) takeOverReason?: string;
}

export class MarkCustomerRefundPaidDto extends TakeOverRefundDto {
  /** Mã giao dịch ngân hàng — bằng chứng đã chuyển, khách thấy trong thông báo. */
  @IsString() @MinLength(1) @MaxLength(100) bankRef!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** Tài khoản khách gửi qua kênh khác khi khoản chưa có tài khoản nhận. */
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
}

export class ClaimCustomerRefundDto {
  /** Tài khoản khách gửi qua kênh khác khi khoản chưa có tài khoản nhận. */
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
}

/** "Xác nhận tiền dư": số dư thực nhận trên sao kê (mặc định số Pancake báo; service chặn vượt số đó). */
export class VerifyOverpaymentDto {
  @IsOptional() @IsInt() @Min(1) amount?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** "Không phải tiền dư": lý do bắt buộc (lưu vào khoản và lịch sử đơn). */
export class DismissOverpaymentDto {
  @IsString() @MinLength(5) @MaxLength(300) reason!: string;
}

@Roles('ADMIN')
@AllowStaff('KE_TOAN')
@Controller('admin/customer-refunds')
export class CustomerRefundsAdminController {
  constructor(private readonly refunds: CustomerRefundsService) {}

  @Get()
  list(@Query() q: ListCustomerRefundsQuery) {
    return this.refunds.list(q.status, q.page, q.limit, q.kind);
  }

  /** "Bắt đầu chuyển khoản" (khoản sang Đang chuyển khoản): khoá nơi nhận trước khi admin chuyển tiền (khách không đổi sang Ví được nữa). */
  @Post(':id/claim')
  claim(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ClaimCustomerRefundDto) {
    return this.refunds.claim(adminId, id, dto);
  }

  /** Trả khoản về hàng chờ khi chưa chuyển được (khách lại đổi được nơi nhận). */
  @Post(':id/release')
  release(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: TakeOverRefundDto) {
    return this.refunds.release(adminId, id, dto);
  }

  /** Khoản dư Pancake báo đã đối chiếu sao kê: thành khoản chờ chuyển khoản, khách được báo để chọn nơi nhận. */
  @Post(':id/verify')
  verify(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: VerifyOverpaymentDto) {
    return this.refunds.verifyOverpayment(adminId, id, dto);
  }

  /** Khoản dư Pancake báo nhưng sao kê không có: đóng khoản, không báo khách. */
  @Post(':id/dismiss')
  dismiss(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: DismissOverpaymentDto) {
    return this.refunds.dismissOverpayment(adminId, id, dto);
  }

  @Post(':id/mark-paid')
  markPaid(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: MarkCustomerRefundPaidDto) {
    return this.refunds.markPaid(adminId, id, dto);
  }
}
