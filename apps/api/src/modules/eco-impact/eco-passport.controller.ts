import { Controller, Get, Header } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EcoPassportService } from './eco-passport.service';
import type { EcoPassport } from './eco-passport.compute';

@Controller('me/eco-passport')
export class EcoPassportController {
  constructor(private readonly passport: EcoPassportService) {}

  /** Cần đăng nhập, chỉ số của chính khách (không nhận id người khác). Cờ `eco.passport_enabled` tắt thì 404. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser('sub') userId: string): Promise<EcoPassport> {
    return this.passport.passport(userId);
  }
}
