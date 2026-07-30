import { Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FlashSaleService } from './flash-sale.service';

// Không còn @Public() ở class — /upcoming + /remind cần userId từ JWT, chỉ /active public.
@Controller('flash-sales')
export class FlashSaleController {
  constructor(private readonly flashSale: FlashSaleService) {}

  @Public()
  @Get('active')
  active() {
    return this.flashSale.listActive();
  }

  /** Item sắp diễn ra + trạng thái đã-nhắc của user hiện tại. */
  @Get('upcoming')
  upcoming(@CurrentUser('sub') userId: string) {
    return this.flashSale.listUpcoming(userId);
  }

  @Post('items/:itemId/remind')
  remind(@CurrentUser('sub') userId: string, @Param('itemId') itemId: string) {
    return this.flashSale.setReminder(userId, itemId);
  }

  @Delete('items/:itemId/remind')
  cancelRemind(@CurrentUser('sub') userId: string, @Param('itemId') itemId: string) {
    return this.flashSale.cancelReminder(userId, itemId);
  }
}
