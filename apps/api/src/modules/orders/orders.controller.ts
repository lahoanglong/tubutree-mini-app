import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrderListQuery } from './dto/orders.dto';
import { OrdersService } from './orders.service';

class ReturnRequestDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(6) images?: string[];
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentUser('sub') userId: string, @Query() query: OrderListQuery) {
    return this.orders.list(userId, { status: query.status, group: query.group }, query.page, query.limit);
  }

  // PHẢI đứng TRƯỚC @Get(':code'): Express khớp route theo thứ tự khai báo — đặt sau thì
  // "active-count" bị coi là mã đơn → 404 "Không tìm thấy đơn hàng", badge tab im lặng về 0.
  @Get('active-count')
  activeCount(@CurrentUser('sub') userId: string) {
    return this.orders.activeCount(userId);
  }

  @Get(':code')
  detail(@CurrentUser('sub') userId: string, @Param('code') code: string) {
    return this.orders.detailView(userId, code);
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
