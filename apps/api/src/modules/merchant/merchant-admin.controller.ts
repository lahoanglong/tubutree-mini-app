import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationQuery } from '../../common/pagination';
import { MerchantFulfilmentService } from './merchant-fulfilment.service';

class CreateMerchantPayoutDto {
  @IsString() @IsNotEmpty() storefrontId!: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class MarkMerchantPayoutPaidDto {
  @IsString() @IsNotEmpty() @MaxLength(100) bankRef!: string;
}

class MerchantPayoutListQuery extends PaginationQuery {
  @IsOptional() @IsString() storefrontId?: string;
}

/** Admin: giám sát đơn đối tác tự giao và đối soát (docs/2026-10-14-merchant-fulfilment-design.md mục 7, 8). */
@Controller('admin/merchant-fulfilment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class MerchantAdminController {
  constructor(private readonly fulfilment: MerchantFulfilmentService) {}

  @Get('overview')
  overview() {
    return this.fulfilment.adminOverview();
  }

  @Get('statements/:storefrontId')
  statement(@Param('storefrontId') storefrontId: string) {
    return this.fulfilment.statementFor(storefrontId);
  }

  @Get('payouts')
  payouts(@Query() q: MerchantPayoutListQuery) {
    return this.fulfilment.listPayouts(q.storefrontId, q.page, q.limit);
  }

  @Post('payouts')
  createPayout(@CurrentUser('sub') adminId: string, @Body() dto: CreateMerchantPayoutDto) {
    return this.fulfilment.createPayout(adminId, dto.storefrontId, dto.note);
  }

  @Post('payouts/:id/paid')
  markPaid(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: MarkMerchantPayoutPaidDto) {
    return this.fulfilment.markPayoutPaid(adminId, id, dto.bankRef);
  }

  @Post('payouts/:id/cancel')
  cancelPayout(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.fulfilment.cancelPayout(adminId, id);
  }
}
