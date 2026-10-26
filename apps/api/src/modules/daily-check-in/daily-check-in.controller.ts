import { Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DailyCheckInService } from './daily-check-in.service';

@Controller()
export class DailyCheckInController {
  constructor(private readonly dailyCheckIn: DailyCheckInService) {}

  /** Trạng thái điểm danh gộp (Điểm Xanh + giọt nước) và dải 7 ngày. */
  @Get('me/daily-check-in')
  status(@CurrentUser('sub') userId: string) {
    return this.dailyCheckIn.status(userId);
  }

  /** Một nút điểm danh: cộng Điểm Xanh và giọt nước; bên nào đã xong hôm nay thì bỏ qua, không lỗi. */
  @Post('me/daily-check-in')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  checkIn(@CurrentUser('sub') userId: string) {
    return this.dailyCheckIn.run(userId);
  }
}
