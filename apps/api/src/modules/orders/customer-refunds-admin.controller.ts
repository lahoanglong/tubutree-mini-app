import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { CustomerRefundsService } from './customer-refunds.service';

const CUSTOMER_REFUND_STATUSES = ['PENDING', 'COMPLETED'] as const;
const CUSTOMER_REFUND_KINDS = ['END_CUSTOMER', 'CANCEL', 'RETURN', 'LATE_PAYMENT'] as const;

export class ListCustomerRefundsQuery extends PaginationQuery {
  @IsOptional() @IsIn(CUSTOMER_REFUND_STATUSES) status?: (typeof CUSTOMER_REFUND_STATUSES)[number];
  @IsOptional() @IsIn(CUSTOMER_REFUND_KINDS) kind?: (typeof CUSTOMER_REFUND_KINDS)[number];
}

export class MarkCustomerRefundPaidDto {
  /** Mã giao dịch ngân hàng — bằng chứng đã chuyển, khách thấy trong thông báo. */
  @IsString() @MinLength(1) @MaxLength(100) bankRef!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /** Tài khoản khách gửi qua kênh khác khi khoản chưa có tài khoản nhận. */
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) accountName?: string;
}

@Roles('ADMIN')
@Controller('admin/customer-refunds')
export class CustomerRefundsAdminController {
  constructor(private readonly refunds: CustomerRefundsService) {}

  @Get()
  list(@Query() q: ListCustomerRefundsQuery) {
    return this.refunds.list(q.status, q.page, q.limit, q.kind);
  }

  @Post(':id/mark-paid')
  markPaid(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: MarkCustomerRefundPaidDto) {
    return this.refunds.markPaid(adminId, id, dto);
  }
}
