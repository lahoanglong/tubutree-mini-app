import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsIn, IsInt, IsString, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';

class CreateSubDto {
  @IsString() variationId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsIn([4, 6, 8, 10]) intervalWeeks!: number;
  @IsString() addressId!: string;
}
class StatusDto {
  @IsIn(['ACTIVE', 'PAUSED', 'CANCELLED']) status!: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
}

@Controller('me/subscriptions')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get()
  list(@CurrentUser('sub') userId: string) {
    return this.subs.list(userId);
  }

  @Post()
  create(@CurrentUser('sub') userId: string, @Body() dto: CreateSubDto) {
    return this.subs.create(userId, dto);
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
