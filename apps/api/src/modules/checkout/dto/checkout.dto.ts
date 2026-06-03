import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { PaymentMethod } from '@tubutree/shared-types';
import { IsIn } from 'class-validator';

export class InvoiceRequestDto {
  @IsString() taxCode!: string;
  @IsString() companyName!: string;
  @IsString() address!: string;
  @IsString() email!: string;
}

export class QuoteDto {
  @IsString() addressId!: string;
  @IsOptional() @IsInt() @Min(0) pointsToUse?: number;
}

export class PlaceOrderDto {
  @IsString() addressId!: string;

  @IsIn(Object.values(PaymentMethod))
  paymentMethod!: PaymentMethod;

  @IsOptional() @IsInt() @Min(0) pointsToUse?: number;

  @IsOptional() @IsString() note?: string;

  /** Mã giới thiệu CTV (nếu mua qua link chia sẻ). */
  @IsOptional() @IsString() referralCode?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => InvoiceRequestDto)
  invoiceRequest?: InvoiceRequestDto;
}
