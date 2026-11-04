import { Transform, Type } from 'class-transformer';
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
  MinLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsUploadedImage, STAFF_IMAGE } from '../../../../common/uploaded-image';
import { OptionalNotNull } from '../../../../common/decorators/optional-not-null.decorator';

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
  @OptionalNotNull()
  @IsDateString()
  startAt?: string;

  @OptionalNotNull()
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
  @IsUploadedImage(STAFF_IMAGE)
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

const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ShiftTemplateDto {
  @Transform(trimString)
  @IsString()
  @MinLength(1, { message: 'Tên ca không được để trống.' })
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
  @OptionalNotNull()
  @Transform(trimString)
  @IsString()
  @MinLength(1, { message: 'Tên ca không được để trống.' })
  @MaxLength(60)
  name?: string;

  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(1440)
  startMin?: number;

  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(1440)
  endMin?: number;

  @OptionalNotNull()
  @IsBoolean()
  active?: boolean;

  @OptionalNotNull()
  @IsInt()
  sortOrder?: number;
}
