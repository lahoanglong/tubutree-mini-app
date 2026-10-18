import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { WASTE_POINT_KIND_VALUES, WASTE_POINT_STAFF_ROLE_VALUES, WASTE_POINT_STATUS_VALUES } from '@tubutree/shared-types';
import type {
  AdminWastePointQuery,
  WasteOpeningHours,
  WastePointKind,
  WastePointStaffAddRequest,
  WastePerkReviewRequest,
  WastePointStaffRole,
  WastePointStatus,
  WastePointUpsertRequest,
  WasteReorderRequest,
} from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { WASTE_POINTS_MAX_PER_SITE } from '../waste.constants';
import { WasteAdminPointsService } from './waste-admin-points.service';

export class AdminWastePointQueryDto implements AdminWastePointQuery {
  @IsOptional()
  @IsIn(WASTE_POINT_STATUS_VALUES)
  status?: WastePointStatus;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  perkPending?: boolean;
}

export class WastePointCreateDto implements WastePointUpsertRequest {
  @IsOptional()
  @IsIn(WASTE_POINT_KIND_VALUES)
  kind?: WastePointKind;

  @Length(1, 120)
  name!: string;

  @Length(1, 300)
  addressLine!: string;

  @Length(1, 10)
  provinceCode!: string;

  @Length(1, 100)
  provinceName!: string;

  @Length(1, 20)
  communeCode!: string;

  @Length(1, 100)
  communeName!: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsObject()
  openingHours?: WasteOpeningHours;

  @IsOptional()
  @IsIn(WASTE_POINT_STATUS_VALUES)
  status?: WastePointStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  monthlyQuotaPoints?: number;

  @IsOptional()
  @IsBoolean()
  giftHandoverEnabled?: boolean;

  @IsOptional()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  itemIds?: string[];
}

export class WastePointUpdateDto implements Partial<WastePointUpsertRequest> {
  @OptionalNotNull()
  @IsIn(WASTE_POINT_KIND_VALUES)
  kind?: WastePointKind;

  @OptionalNotNull()
  @Length(1, 120)
  name?: string;

  @OptionalNotNull()
  @Length(1, 300)
  addressLine?: string;

  @OptionalNotNull()
  @Length(1, 10)
  provinceCode?: string;

  @OptionalNotNull()
  @Length(1, 100)
  provinceName?: string;

  @OptionalNotNull()
  @Length(1, 20)
  communeCode?: string;

  @OptionalNotNull()
  @Length(1, 100)
  communeName?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @MaxLength(20)
  phone?: string | null;

  @OptionalNotNull()
  @IsObject()
  openingHours?: WasteOpeningHours;

  @OptionalNotNull()
  @IsIn(WASTE_POINT_STATUS_VALUES)
  status?: WastePointStatus;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  monthlyQuotaPoints?: number | null;

  @OptionalNotNull()
  @IsBoolean()
  giftHandoverEnabled?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @MaxLength(1000)
  note?: string | null;

  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  itemIds?: string[];
}

export class WasteReorderDto implements WasteReorderRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WASTE_POINTS_MAX_PER_SITE)
  @IsString({ each: true })
  ids!: string[];
}

export class WastePointStaffAddDto implements WastePointStaffAddRequest {
  @IsString()
  @Length(1, 64)
  userId!: string;

  @IsIn(WASTE_POINT_STAFF_ROLE_VALUES)
  role!: WastePointStaffRole;
}

export class WastePerkReviewDto implements WastePerkReviewRequest {
  @IsString()
  @MaxLength(300)
  expectedPendingText!: string;
}

@Controller('admin/waste/points')
export class WasteAdminPointsController {
  constructor(private readonly points: WasteAdminPointsService) {}

  @Get()
  @Roles('ADMIN')
  list(@CurrentUser('sub') adminId: string, @Query() q: AdminWastePointQueryDto) {
    return this.points.list(adminId, q);
  }

  @Post()
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  create(@CurrentUser('sub') adminId: string, @Body() body: WastePointCreateDto) {
    return this.points.create(adminId, body);
  }

  @Put('order')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  reorder(@CurrentUser('sub') adminId: string, @Body() body: WasteReorderDto) {
    return this.points.reorder(adminId, body);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  update(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() body: WastePointUpdateDto) {
    return this.points.update(adminId, id, body);
  }

  @Post(':id/staff')
  @HttpCode(200)
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  addStaff(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() body: WastePointStaffAddDto) {
    return this.points.addStaff(adminId, id, body);
  }

  @Delete(':id/staff/:userId')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  removeStaff(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Param('userId') userId: string) {
    return this.points.removeStaff(adminId, id, userId);
  }

  @Post(':id/perk/approve')
  @HttpCode(200)
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  approvePerk(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() body: WastePerkReviewDto) {
    return this.points.approvePerk(adminId, id, body.expectedPendingText);
  }

  @Post(':id/perk/reject')
  @HttpCode(200)
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  rejectPerk(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() body: WastePerkReviewDto) {
    return this.points.rejectPerk(adminId, id, body.expectedPendingText);
  }
}
