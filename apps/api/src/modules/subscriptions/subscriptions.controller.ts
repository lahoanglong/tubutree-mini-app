import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { clampTake } from '../../common/pagination';
import {
  MAX_SUBSCRIPTION_QUANTITY,
  SUBSCRIPTION_INTERVAL_WEEKS,
  SUBSCRIPTION_PAYMENT_METHODS,
  SubscriptionsService,
  type SubscriptionPaymentMethod,
} from './subscriptions.service';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';

class CreateSubDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) @Max(MAX_SUBSCRIPTION_QUANTITY) quantity!: number;
  @IsIn(SUBSCRIPTION_INTERVAL_WEEKS) intervalWeeks!: number;
  @IsString() addressId!: string;
  /** YYYY-MM-DD giờ Việt Nam; bỏ trống = giao đơn đầu ngay. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @IsOptional() @IsIn(SUBSCRIPTION_PAYMENT_METHODS) paymentMethod?: SubscriptionPaymentMethod;
}
export class UpdateSubDto {
  @OptionalNotNull() @IsInt() @Min(1) @Max(MAX_SUBSCRIPTION_QUANTITY) quantity?: number;
  @OptionalNotNull() @IsString() addressId?: string;
  @OptionalNotNull() @IsIn(SUBSCRIPTION_INTERVAL_WEEKS) intervalWeeks?: number;
  @OptionalNotNull() @IsIn(SUBSCRIPTION_PAYMENT_METHODS) paymentMethod?: SubscriptionPaymentMethod;
  /** Dời ngày giao kỳ tới: YYYY-MM-DD giờ Việt Nam, từ ngày mai tới `RESCHEDULE_MAX_DAYS_AHEAD` ngày tới. */
  @OptionalNotNull() @Matches(/^\d{4}-\d{2}-\d{2}$/) nextRunDate?: string;
  /** `nextRunAt` của gói như màn hình đang hiện; bắt buộc khi gửi `nextRunDate`. Lệch bản trong DB (cron vừa ra đơn kỳ) thì 409. */
  @OptionalNotNull() @IsISO8601({ strict: true }) expectedNextRunAt?: string;
}
export class SkipSubDto {
  /** `nextRunAt` của gói như thẻ đang hiện; bắt buộc (thiếu thì 400). Lệch bản trong DB (cron 03:00 vừa ra đơn kỳ đó) thì 409, không bỏ qua kỳ sau. */
  @OptionalNotNull() @IsISO8601({ strict: true }) expectedNextRunAt?: string;
}
class StatusDto {
  @IsIn(['ACTIVE', 'PAUSED', 'CANCELLED']) status!: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
}

@Controller('me/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get()
  list(@CurrentUser('sub') userId: string, @Query() query: CursorPageQuery) {
    return this.subs.list(userId, { take: clampTake(query.take, 100, 200), cursor: query.cursor });
  }

  /** Gợi ý giao định kỳ theo nhịp mua (cờ subscriptions.smart_interval_enabled). Khai trước các route `:id`. */
  @Get('suggestions')
  suggestions(@CurrentUser('sub') userId: string) {
    return this.subs.suggestions(userId);
  }

  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateSubDto) {
    return this.subs.create(userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: UpdateSubDto) {
    return this.subs.update(userId, id, dto);
  }

  @Post(':id/status')
  setStatus(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.subs.setStatus(userId, id, dto.status);
  }

  @Post(':id/skip')
  skipCycle(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: SkipSubDto) {
    return this.subs.skipCycle(userId, id, dto?.expectedNextRunAt);
  }

  /** "Đặt kỳ này ngay": ra đơn kỳ tới ngay hôm nay, kỳ sau tính lại từ hôm nay. */
  @Post(':id/run-now')
  runNow(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subs.runNow(userId, id);
  }
}
