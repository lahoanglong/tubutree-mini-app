import { Controller, Get, Header, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrderEcoImpactService, type OrderEcoImpact } from './order-eco-impact.service';

@Controller('me/eco-impact')
export class OrderEcoImpactController {
  constructor(private readonly impact: OrderEcoImpactService) {}

  /** Cần đăng nhập, chỉ đơn của chính khách. Cờ growth.referral_viral_enabled tắt thì 404. */
  @Get('orders/:code')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser('sub') userId: string, @Param('code') code: string): Promise<OrderEcoImpact> {
    return this.impact.forOrder(userId, code);
  }
}
