import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

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
