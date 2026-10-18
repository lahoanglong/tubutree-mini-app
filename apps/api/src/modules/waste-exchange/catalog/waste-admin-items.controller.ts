import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { WASTE_ITEM_STATUS_VALUES } from '@tubutree/shared-types';
import type { WasteItemStatus, WasteItemUpsertRequest, WasteReorderRequest } from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { WasteAdminItemsService } from './waste-admin-items.service';

const CODE_RULE = /^[A-Z0-9_]{2,40}$/;
const CODE_MESSAGE = 'Mã món chỉ gồm chữ in hoa, số và dấu gạch dưới, 2 đến 40 ký tự.';

export class WasteItemCreateDto implements WasteItemUpsertRequest {
  @Matches(CODE_RULE, { message: CODE_MESSAGE })
  code!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 20)
  unitLabel!: string;

  @IsInt()
  @Min(1)
  @Max(10000)
  unitsPerPoint!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  pointsPerGroup!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  dropsPerUnit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  dailyCapQty?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  monthlyCapQty?: number | null;

  @IsOptional()
  @IsIn(WASTE_ITEM_STATUS_VALUES)
  status?: WasteItemStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prepInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  gramsPerUnit?: number;

  @IsOptional()
  @IsBoolean()
  hazardous?: boolean;
}

export class WasteItemUpdateDto implements Partial<WasteItemUpsertRequest> {
  @OptionalNotNull()
  @Matches(CODE_RULE, { message: CODE_MESSAGE })
  code?: string;

  @OptionalNotNull()
  @IsString()
  @Length(1, 120)
  name?: string;

  @OptionalNotNull()
  @IsString()
  @Length(1, 20)
  unitLabel?: string;

  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(10000)
  unitsPerPoint?: number;

  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  pointsPerGroup?: number;

  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(1000)
  dropsPerUnit?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  dailyCapQty?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  monthlyCapQty?: number | null;

  @OptionalNotNull()
  @IsIn(WASTE_ITEM_STATUS_VALUES)
  status?: WasteItemStatus;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  prepInstructions?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  imageUrl?: string | null;

  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  gramsPerUnit?: number | null;

  @OptionalNotNull()
  @IsBoolean()
  hazardous?: boolean;
}

export class WasteReorderDto implements WasteReorderRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}

@Controller('admin/waste/items')
export class WasteAdminItemsController {
  constructor(private readonly items: WasteAdminItemsService) {}

  @Get()
  @Roles('ADMIN')
  list(@CurrentUser('sub') adminId: string) {
    return this.items.list(adminId);
  }

  @Post()
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  create(@CurrentUser('sub') adminId: string, @Body() body: WasteItemCreateDto) {
    return this.items.create(adminId, body);
  }

  @Put('order')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  reorder(@CurrentUser('sub') adminId: string, @Body() body: WasteReorderDto) {
    return this.items.reorder(adminId, body);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  update(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() body: WasteItemUpdateDto) {
    return this.items.update(adminId, id, body);
  }
}
