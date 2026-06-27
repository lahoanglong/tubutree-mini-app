import { Allow, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBrandDto {
  @IsString() name!: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() tagline?: string;
  @IsOptional() @IsString() story?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @Allow() certifications?: unknown;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateBrandDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() tagline?: string;
  @IsOptional() @IsString() story?: string;
  @IsOptional() @IsString() origin?: string;
  @IsOptional() @Allow() certifications?: unknown;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class VerifyBrandDto {
  @IsBoolean() isVerified!: boolean;
}

export class PromotionDto {
  @IsString() title!: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() themeColor?: string;
  @IsOptional() @IsString() couponCode?: string;
  @IsString() startAt!: string;
  @IsString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdatePromotionDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() themeColor?: string;
  @IsOptional() @IsString() couponCode?: string;
  @IsOptional() @IsString() startAt?: string;
  @IsOptional() @IsString() endAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class DealerRewardDto {
  @IsOptional() @IsString() brandId?: string;
  @IsIn(['TOUR', 'GIFT', 'OTHER']) type!: 'TOUR' | 'GIFT' | 'OTHER';
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsInt() @Min(0) threshold!: number;
  @IsOptional() @IsString() period?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateDealerRewardDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) threshold?: number;
  @IsOptional() @IsString() period?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
