import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ShiftItemDto {
  @IsDateString()
  workDate!: string; // 'YYYY-MM-DD'

  @IsDateString()
  startAt!: string; // ISO

  @IsDateString()
  endAt!: string; // ISO

  @IsOptional()
  @IsString()
  templateId?: string;
}

export class CreateShiftsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShiftItemDto)
  items!: ShiftItemDto[];
}

export class UpdateShiftDto {
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}

export class CopyWeekDto {
  @IsDateString()
  sourceWeekStart!: string;

  @IsDateString()
  targetWeekStart!: string;
}

export class CancelShiftDto {
  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsBoolean()
  isEmergency?: boolean;

  @IsOptional()
  @IsString()
  evidenceUrl?: string;
}

export class ApproveShiftDto {
  @IsOptional()
  @IsDateString()
  approvedStart?: string;

  @IsOptional()
  @IsDateString()
  approvedEnd?: string;
}

export class RejectShiftDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class BulkApproveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

export class ShiftTemplateDto {
  @IsString()
  @MaxLength(60)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(1440)
  startMin!: number;

  @IsInt()
  @Min(0)
  @Max(1440)
  endMin!: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateShiftTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  startMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  endMin?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
