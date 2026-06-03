import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAddressDto {
  @IsString() @MaxLength(120) recipient!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsString() province!: string;
  @IsString() district!: string;
  @IsString() ward!: string;
  @IsString() @MaxLength(255) street!: string;
  @IsString() provinceCode!: string;
  @IsString() districtCode!: string;
  @IsString() wardCode!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsString() @MaxLength(120) recipient?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() ward?: string;
  @IsOptional() @IsString() @MaxLength(255) street?: string;
  @IsOptional() @IsString() provinceCode?: string;
  @IsOptional() @IsString() districtCode?: string;
  @IsOptional() @IsString() wardCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
