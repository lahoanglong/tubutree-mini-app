import { IsDateString, IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class CheckinDto {
  @IsString()
  shiftId!: string;

  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  locationToken?: string;

  @IsOptional()
  @IsString()
  zaloAccessToken?: string;
}

export class HeartbeatDto {
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  locationToken?: string;

  @IsOptional()
  @IsString()
  zaloAccessToken?: string;
}

export class ManualCheckoutDto {
  @IsString()
  sessionId!: string;
}

export class CheckoutDto {
  @IsOptional()
  @IsDateString()
  at?: string; // giờ lùi (quá khứ) cho quên checkout; bỏ trống = now
}

export class EditSessionDto {
  @IsOptional()
  @IsDateString()
  checkinAt?: string;

  @IsOptional()
  @IsDateString()
  checkoutAt?: string;
}

export class AddSessionDto {
  @IsString()
  shiftId!: string;

  @IsDateString()
  checkinAt!: string;

  @IsDateString()
  checkoutAt!: string;
}
