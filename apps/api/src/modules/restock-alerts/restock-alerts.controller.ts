import { Body, Controller, Delete, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { RestockAlertsService } from './restock-alerts.service';

class RestockStatusQuery {
  @IsString() @MaxLength(64) productId!: string;
}

class SubscribeRestockDto {
  @IsString() @MaxLength(64) variationId!: string;
}

@Controller()
export class RestockAlertsController {
  constructor(private readonly restock: RestockAlertsService) {}

  /**
   * Trang sản phẩm hỏi khi biến thể đang chọn hết hàng: cờ có bật không và khách đã đăng ký biến thể nào. Công khai (khách chưa đăng nhập
   * vẫn thấy nút để bấm rồi đăng nhập); `private, no-store` vì bản có phiên khác nhau theo khách.
   */
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  @Get('restock-alerts')
  status(@Query() q: RestockStatusQuery, @CurrentUser('sub') userId?: string) {
    return this.restock.status(q.productId, userId);
  }

  /** Trang Yêu thích: mọi phân loại khách đang chờ hàng về, kèm sản phẩm. Cần đăng nhập; chỉ đọc đăng ký của chính phiên. */
  @Header('Cache-Control', 'private, no-store')
  @Get('me/restock-alerts')
  mine(@CurrentUser('sub') userId: string) {
    return this.restock.mine(userId);
  }

  @Post('me/restock-alerts')
  subscribe(@CurrentUser('sub') userId: string, @Body() dto: SubscribeRestockDto) {
    return this.restock.subscribe(userId, dto.variationId);
  }

  @Delete('me/restock-alerts/:variationId')
  unsubscribe(@CurrentUser('sub') userId: string, @Param('variationId') variationId: string) {
    return this.restock.unsubscribe(userId, variationId);
  }
}
