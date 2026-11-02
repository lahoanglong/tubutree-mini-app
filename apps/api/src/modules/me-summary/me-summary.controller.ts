import { Controller, Get, Header } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MeSummaryService } from './me-summary.service';

@Controller('me/summary')
export class MeSummaryController {
  constructor(private readonly summary: MeSummaryService) {}

  /** Số đơn theo tab, đơn đang xử lý, tin chưa đọc, gói định kỳ: một lời gọi cho Cá nhân và thanh đáy. Cần đăng nhập, chỉ dữ liệu của chính khách. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentUser('sub') userId: string) {
    return this.summary.get(userId);
  }
}
