import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { OrderStatus } from '@tubutree/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQuery } from '../../common/pagination';
import { OrdersService } from './orders.service';

class OrderListQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED', 'RETURNED', 'CANCELLED'])
  status?: OrderStatus;
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
}
