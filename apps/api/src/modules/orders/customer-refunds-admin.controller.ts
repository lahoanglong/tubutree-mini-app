import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { CustomerRefundsService } from './customer-refunds.service';

const CUSTOMER_REFUND_STATUSES = ['PENDING', 'COMPLETED'] as const;

export class ListCustomerRefundsQuery extends PaginationQuery {
  @IsOptional() @IsIn(CUSTOMER_REFUND_STATUSES) status?: (typeof CUSTOMER_REFUND_STATUSES)[number];
}

export class MarkCustomerRefundPaidDto {
  @IsOptional() @IsString() @MaxLength(100) bankRef?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@Roles('ADMIN')
@Controller('admin/customer-refunds')
export class CustomerRefundsAdminController {
  constructor(private readonly refunds: CustomerRefundsService) {}

  @Get()
  list(@Query() q: ListCustomerRefundsQuery) {
    return this.refunds.list(q.status, q.page, q.limit);
  }

  @Post(':id/mark-paid')
  markPaid(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: MarkCustomerRefundPaidDto) {
    return this.refunds.markPaid(adminId, id, dto);
  }
}
