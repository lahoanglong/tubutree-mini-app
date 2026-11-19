import { Controller, Get, Header } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { GreenCardService, type GreenCard } from './green-card.service';

@Controller('me/green-card')
export class GreenCardController {
  constructor(private readonly cards: GreenCardService) {}

  /** Cần đăng nhập, chỉ số của chính khách. Cờ growth.referral_viral_enabled tắt thì 404. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser('sub') userId: string): Promise<GreenCard> {
    return this.cards.card(userId);
  }
}
