import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrderListQuery, RepurchaseDto } from './dto/orders.dto';
import { CancelOrderDto, ChooseRefundDestinationDto, ReturnEstimateDto, ReturnRequestDto } from './dto/return-request.dto';
import { OrdersService } from './orders.service';
import { OrderReturnsService } from './order-returns.service';
import { CustomerRefundsService } from './customer-refunds.service';

export class MyRefundsQuery {
  @IsOptional() @IsString() @MaxLength(64) orderId?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly returns: OrderReturnsService,
    private readonly refunds: CustomerRefundsService,
  ) {}

  @Get()
  list(@CurrentUser('sub') userId: string, @Query() query: OrderListQuery) {
    return this.orders.list(userId, { status: query.status, group: query.group, q: query.q }, query.page, query.limit);
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

  /** Body tuỳ chọn: nơi nhận tiền hoàn của đơn trả trước đã thanh toán (D2). Không gửi = Ví Tubu. */
  @Post(':code/cancel')
  cancel(@CurrentUser('sub') userId: string, @Param('code') code: string, @Body() dto: CancelOrderDto) {
    return this.orders.cancel(userId, code, dto ?? {});
  }

  @Post(':code/repurchase')
  repurchase(@CurrentUser('sub') userId: string, @Param('code') code: string, @Body() dto: RepurchaseDto) {
    return this.orders.repurchase(userId, code, { items: dto?.items, addSource: dto?.addSource });
  }

  @Post(':code/return-request')
  requestReturn(
    @CurrentUser('sub') userId: string,
    @Param('code') code: string,
    @Body() dto: ReturnRequestDto,
  ) {
    return this.returns.request(userId, code, dto);
  }

  /** Số tiền dự kiến hoàn cho các dòng khách đang chọn trong form đổi/trả (không ghi gì). */
  @Post(':code/return-estimate')
  estimateReturn(
    @CurrentUser('sub') userId: string,
    @Param('code') code: string,
    @Body() dto: ReturnEstimateDto,
  ) {
    return this.returns.estimate(userId, code, dto);
  }

  @Get('me/returns')
  myReturns(@CurrentUser('sub') userId: string) {
    return this.returns.listMine(userId);
  }

  /** Các khoản hoàn tiền của khách (chuyển khoản chờ xử lý, tiền về muộn) — hiện ở chi tiết đơn. */
  @Get('me/refunds')
  myRefunds(@CurrentUser('sub') userId: string, @Query() q: MyRefundsQuery) {
    return this.refunds.listMine(userId, q.orderId);
  }

  /** Tài khoản ngân hàng khách dùng gần nhất — điền sẵn ô "Tài khoản ngân hàng" khi chọn nơi nhận hoàn tiền. */
  @Get('me/refund-bank')
  myRefundBank(@CurrentUser('sub') userId: string) {
    return this.refunds.lastBankDetails(userId).then((bank) => ({ bank }));
  }

  @Post('me/refunds/:id/destination')
  chooseRefundDestination(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ChooseRefundDestinationDto,
  ) {
    return this.refunds.chooseDestination(userId, id, dto);
  }
}
