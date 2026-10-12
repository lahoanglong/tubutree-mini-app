import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { clampTake } from '../../common/pagination';
import {
  MAX_SUBSCRIPTION_QUANTITY,
  SUBSCRIPTION_PAYMENT_METHODS,
  SubscriptionsService,
  type SubscriptionPaymentMethod,
} from './subscriptions.service';

class CreateSubDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) @Max(MAX_SUBSCRIPTION_QUANTITY) quantity!: number;
  @IsIn([4, 6, 8, 10]) intervalWeeks!: number;
  @IsString() addressId!: string;
  /** YYYY-MM-DD giờ Việt Nam; bỏ trống = giao đơn đầu ngay. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @IsOptional() @IsIn(SUBSCRIPTION_PAYMENT_METHODS) paymentMethod?: SubscriptionPaymentMethod;
}
class UpdateSubDto {
  @IsOptional() @IsInt() @Min(1) @Max(MAX_SUBSCRIPTION_QUANTITY) quantity?: number;
  @IsOptional() @IsString() addressId?: string;
  @IsOptional() @IsIn(SUBSCRIPTION_PAYMENT_METHODS) paymentMethod?: SubscriptionPaymentMethod;
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
  skipCycle(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.subs.skipCycle(userId, id);
  }
}
