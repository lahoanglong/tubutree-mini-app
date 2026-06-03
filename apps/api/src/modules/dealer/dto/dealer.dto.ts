import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ApplyDealerDto {
  @IsString() businessName!: string;
  @IsOptional() @IsString() taxCode?: string;
  @IsString() ownerName!: string;
  @IsString() phone!: string;
  @IsString() address!: string;
  @IsString() cccdFrontUrl!: string;
  @IsString() cccdBackUrl!: string;
  @IsOptional() @IsString() storeFrontUrl?: string;
  @IsOptional() @IsInt() monthlyVolumeEstimate?: number;
  @IsOptional() @IsString() notes?: string;
}

export class DealerOrderLine {
  @IsString() variationId!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class DealerOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DealerOrderLine)
  items!: DealerOrderLine[];

  @IsIn(['CREDIT', 'PREPAID']) paymentMethod!: string;
  @IsOptional() @IsString() note?: string;
}
