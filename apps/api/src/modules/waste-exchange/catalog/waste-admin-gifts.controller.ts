import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { WASTE_GIFT_REDEMPTION_STATUS_VALUES } from '@tubutree/shared-types';
import type { GiftRedemptionsQuery, WasteGiftCancelRequest, WasteGiftRedemptionStatus } from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';

export class GiftFulfilByIdDto {
  @IsString()
  @Length(4, 40)
  code!: string;
}

export class WasteGiftCancelDto implements WasteGiftCancelRequest {
  @IsString()
  @Length(3, 500)
  reason!: string;

  @OptionalNotNull()
  @IsBoolean()
  refundPoints?: boolean;
}

export class GiftRedemptionsQueryDto implements GiftRedemptionsQuery {
  @IsOptional()
  @IsIn(WASTE_GIFT_REDEMPTION_STATUS_VALUES)
  status?: WasteGiftRedemptionStatus;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  overdue?: boolean;
}

@Controller('admin/waste')
export class WasteAdminGiftsController {
  constructor(private readonly redemptions: WasteGiftRedemptionsService) {}

  @Get('gift-redemptions')
  @Roles('ADMIN', 'STAFF')
  queue(@CurrentUser('sub') viewerId: string, @Query() q: GiftRedemptionsQueryDto) {
    return this.redemptions.queue(viewerId, q);
  }

  @Post('gift-redemptions/:id/fulfil')
  @HttpCode(200)
  @Roles('ADMIN', 'STAFF')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  fulfil(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: GiftFulfilByIdDto) {
    return this.redemptions.fulfilById(userId, id, body);
  }

  @Post('gift-redemptions/:id/cancel')
  @HttpCode(200)
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  cancel(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteGiftCancelDto) {
    return this.redemptions.cancel(userId, id, body);
  }
}
