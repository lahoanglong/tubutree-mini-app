import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { OrderStatus } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import type { OrdersService } from './orders.service';

class OrderListQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'])
  status?: OrderStatus;
}

class ReturnRequestDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(6) images?: string[];
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentUser('sub') userId: string, @Query() query: OrderListQuery) {
    return this.orders.list(userId, query.status, query.page, query.limit);
  }

  @Get(':code')
  detail(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.orders.detail(userId, code);
  }

  @Post(':code/cancel')
  cancel(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.orders.cancel(userId, code);
  }

  @Post(':code/repurchase')
  repurchase(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.orders.repurchase(userId, code);
  }

  @Post(':code/issue-invoice')
  issueInvoice(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.orders.issueInvoice(userId, code);
  }

  @Post(':code/track')
  track(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.orders.track(userId, code);
  }

  @Post(':code/return-request')
  requestReturn(
    @CurrentUser('sub') userId: string,
    @Param('code') code: string,
    @Body() dto: ReturnRequestDto,
  ) {
    return this.orders.requestReturn(userId, code, dto);
  }

  @Get('me/returns')
  myReturns(@CurrentUser('sub') userId: string) {
    return this.orders.listMyReturns(userId);
  }
}
