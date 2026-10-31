import { Controller, Delete, Get, Header, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { FlashSaleService } from './flash-sale.service';

// Không @Public() ở class: /remind cần userId từ JWT. /active và /upcoming công khai (khách chưa đăng nhập vẫn xem được Giờ vàng).
@Controller('flash-sales')
export class FlashSaleController {
  constructor(private readonly flashSale: FlashSaleService) {}

  @Public()
  @PublicCache('LIVE')
  @Get('active')
  active() {
    return this.flashSale.listActive();
  }

  /**
   * Item sắp diễn ra. Công khai; có phiên hợp lệ thì kèm trạng thái đã-nhắc của khách (`reminded`), không có thì `reminded: false`.
   * `private, no-store`: bản có phiên khác nhau theo khách nên proxy/CDN không được giữ chung.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  @Get('upcoming')
  upcoming(@CurrentUser('sub') userId?: string) {
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
