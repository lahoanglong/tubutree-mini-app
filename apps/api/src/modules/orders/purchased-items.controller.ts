import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PurchasedItemsQuery } from './dto/orders.dto';
import { PurchasedItemsService } from './purchased-items.service';

@Controller('me/purchased-items')
export class PurchasedItemsController {
  constructor(private readonly purchased: PurchasedItemsService) {}

  @Get()
  list(@CurrentUser('sub') userId: string, @Query() q: PurchasedItemsQuery) {
    return this.purchased.list(userId, { cursor: q.cursor, limit: q.limit, variationId: q.variationId });
  }
}
