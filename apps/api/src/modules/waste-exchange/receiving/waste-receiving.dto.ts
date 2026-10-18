import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  WASTE_REJECTION_REASON_VALUES,
  WASTE_SHORTFALL_REASON_VALUES,
  type WasteRejectionReason,
  type WasteShortfallReason,
} from '@tubutree/shared-types';

export class WasteMatchDto {
  @IsOptional() @IsString() @MaxLength(32) parcelCode?: string;
  @IsOptional() @IsBoolean() phoneMatchConfirmed?: boolean;
  @IsOptional() @IsString() @MaxLength(64) parcelTracking?: string;
}

export class WasteConfirmLineDto {
  @IsString() @MaxLength(64) itemId!: string;
  @IsInt() @Min(0) @Max(100000) declaredQty!: number;
  @IsInt() @Min(0) @Max(100000) receivedQty!: number;
  @IsOptional() @IsIn(WASTE_SHORTFALL_REASON_VALUES) shortfallReason?: WasteShortfallReason;
}

export class WasteConfirmDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => WasteConfirmLineDto) lines!: WasteConfirmLineDto[];
  @IsOptional() @IsInt() @Min(1) @Max(100000) receivedWeightGrams?: number;
  @IsOptional() @ValidateNested() @Type(() => WasteMatchDto) match?: WasteMatchDto;
}

export class WasteRejectDto {
  @IsIn(WASTE_REJECTION_REASON_VALUES) rejectionReason!: WasteRejectionReason;
  @IsOptional() @IsString() @MaxLength(500) rejectionNote?: string;
  @IsOptional() @ValidateNested() @Type(() => WasteMatchDto) match?: WasteMatchDto;
}
