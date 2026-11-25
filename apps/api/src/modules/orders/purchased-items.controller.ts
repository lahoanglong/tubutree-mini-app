import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PurchasedItemsQuery } from './dto/orders.dto';
import { PurchasedItemsService } from './purchased-items.service';
import { RepurchaseDueService, type RepurchaseDueResponse } from './repurchase-due.service';

@Controller('me')
export class PurchasedItemsController {
  constructor(
    private readonly purchased: PurchasedItemsService,
    private readonly repurchaseDue: RepurchaseDueService,
  ) {}

  @Get('purchased-items')
  list(@CurrentUser('sub') userId: string, @Query() q: PurchasedItemsQuery) {
    return this.purchased.list(userId, { cursor: q.cursor, limit: q.limit, variationId: q.variationId });
  }

  /** Thẻ "Mua lại" hàng tiêu hao ở Tài khoản và giỏ trống. Luôn 200; cờ tắt hay không có món thì `{ item: null }`. */
  @Get('repurchase-due')
  due(@CurrentUser('sub') userId: string): Promise<RepurchaseDueResponse> {
    return this.repurchaseDue.forUser(userId);
  }
}
