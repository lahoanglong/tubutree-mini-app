import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { WASTE_GIFT_KIND_VALUES, WASTE_GIFT_REDEMPTION_STATUS_VALUES, WASTE_GIFT_STATUS_VALUES } from '@tubutree/shared-types';
import type {
  CouponType,
  GiftRedemptionsQuery,
  WasteGiftCancelRequest,
  WasteGiftKind,
  WasteGiftRedemptionStatus,
  WasteGiftStatus,
  WasteGiftUpsertRequest,
  WasteReorderRequest,
  WasteVoucherSpec,
} from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { WasteAdminGiftsService } from './waste-admin-gifts.service';
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

export class WasteVoucherSpecDto implements WasteVoucherSpec {
  @IsIn(['PERCENT', 'AMOUNT', 'FREESHIP'])
  type!: CouponType;

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  value!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrder!: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDiscount!: number | null;

  @IsInt()
  @Min(1)
  @Max(365)
  validDays!: number;
}

export class WasteGiftCreateDto implements WasteGiftUpsertRequest {
  @IsOptional()
  @IsIn(WASTE_GIFT_KIND_VALUES)
  kind?: WasteGiftKind;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_000_000)
  pointsCost?: number;

  @IsOptional()
  @IsIn(WASTE_GIFT_STATUS_VALUES)
  status?: WasteGiftStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  claimInstructions?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => WasteVoucherSpecDto)
  voucher?: WasteVoucherSpecDto;
}

export class WasteGiftUpdateDto implements Partial<WasteGiftUpsertRequest> {
  @OptionalNotNull()
  @IsIn(WASTE_GIFT_KIND_VALUES)
  kind?: WasteGiftKind;

  @OptionalNotNull()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(40)
  label?: string | null;

  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(2_000_000)
  pointsCost?: number;

  @OptionalNotNull()
  @IsIn(WASTE_GIFT_STATUS_VALUES)
  status?: WasteGiftStatus;

  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  claimInstructions?: string | null;

  @OptionalNotNull()
  @ValidateNested()
  @Type(() => WasteVoucherSpecDto)
  voucher?: WasteVoucherSpecDto;
}

export class WasteReorderDto implements WasteReorderRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

@Controller('admin/waste')
export class WasteAdminGiftsController {
  constructor(
    private readonly redemptions: WasteGiftRedemptionsService,
    private readonly gifts: WasteAdminGiftsService,
  ) {}

  @Get('gifts')
  @Roles('ADMIN')
  listGifts(@CurrentUser('sub') adminId: string) {
    return this.gifts.list(adminId);
  }

  @Post('gifts')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  createGift(@CurrentUser('sub') adminId: string, @Body() body: WasteGiftCreateDto) {
    return this.gifts.create(adminId, body);
  }

  @Put('gifts/order')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  reorderGifts(@CurrentUser('sub') adminId: string, @Body() body: WasteReorderDto) {
    return this.gifts.reorder(adminId, body);
  }

  @Patch('gifts/:id')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  updateGift(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() body: WasteGiftUpdateDto) {
    return this.gifts.update(adminId, id, body);
  }

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
