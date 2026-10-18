import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Length } from 'class-validator';
import type { WasteDeskGiftFulfilRequest } from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { WasteGiftRedemptionsService } from './waste-gift-redemptions.service';

export class WasteDeskGiftFulfilDto implements WasteDeskGiftFulfilRequest {
  @IsString()
  @Length(4, 40)
  code!: string;

  @IsString()
  @Length(1, 64)
  pointId!: string;
}

@Controller('waste/desk/gifts')
export class WasteDeskGiftsController {
  constructor(private readonly gifts: WasteGiftRedemptionsService) {}

  @Post('fulfil')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  fulfil(@CurrentUser('sub') userId: string, @Body() body: WasteDeskGiftFulfilDto) {
    return this.gifts.fulfilAtDesk(userId, body);
  }
}
