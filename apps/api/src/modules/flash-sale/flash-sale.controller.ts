import { BadRequestException, Controller, Delete, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { FlashSaleService } from './flash-sale.service';

const ACTIVE_LIMIT_MAX = 50;

/** `?limit=` tuỳ chọn, số nguyên 1..50; sai thì 400 chứ không lặng lẽ bỏ qua (khách thấy ngay lỗi thay vì danh sách dài bất ngờ). */
function parseActiveLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(n >= 1 && n <= ACTIVE_LIMIT_MAX)) throw new BadRequestException(`limit phải là số nguyên từ 1 đến ${ACTIVE_LIMIT_MAX}.`);
  return n;
}

// Không @Public() ở class: /remind cần userId từ JWT. /active, /slots và /upcoming công khai (khách chưa đăng nhập vẫn xem được Giờ vàng).
@Controller('flash-sales')
export class FlashSaleController {
  constructor(private readonly flashSale: FlashSaleService) {}

  @Public()
  @PublicCache('LIVE')
  @Get('active')
  active(@Query('limit') limit?: string) {
    return this.flashSale.listActive(undefined, parseActiveLimit(limit));
  }

  /** Các khung Giờ vàng của trang /flash-sale. Không phụ thuộc người gọi nên cache chung được. */
  @Public()
  @PublicCache('LIVE')
  @Get('slots')
  slots() {
    return this.flashSale.listSlots();
  }

  @Public()
  @PublicCache('LIVE')
  @Get('slots/:id/items')
  slotItems(@Param('id') id: string) {
    return this.flashSale.listSlotItems(id);
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
