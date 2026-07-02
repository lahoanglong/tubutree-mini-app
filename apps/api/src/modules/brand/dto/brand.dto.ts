import { Allow, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

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
  // Gán chủ nhãn (lộ trình B): userId của đối tác → cho phép họ tự quản nhãn.
  @IsOptional() @IsString() ownerUserId?: string;
}

export class VerifyBrandDto {
  @IsBoolean() isVerified!: boolean;
}

/** Brand-owner CHỈ sửa thông tin nhãn (không name/slug/verified/publish/cert). */
export class UpdateOwnedBrandDto {
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() tagline?: string;
  @IsOptional() @IsString() story?: string;
  @IsOptional() @IsString() origin?: string;
}

export class PromotionDto {
  @IsString() title!: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() themeColor?: string;
  @IsOptional() @IsString() couponCode?: string;
  // @IsDateString: endpoint self-service /brand/owner/* dùng chung DTO này với client ít
  // tin cậy hơn admin → chặn chuỗi không phải ngày (new Date('x')→Invalid Date→Prisma 500).
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdatePromotionDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsOptional() @IsString() themeColor?: string;
  @IsOptional() @IsString() couponCode?: string;
  @IsOptional() @IsDateString() startAt?: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class DealerRewardDto {
  @IsOptional() @IsString() brandId?: string;
  @IsIn(['TOUR', 'GIFT', 'OTHER']) type!: 'TOUR' | 'GIFT' | 'OTHER';
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsInt() @Min(0) threshold!: number;
  @IsOptional() @IsIn(['QUARTER', 'YEAR']) period?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class ProductIdsDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) productIds!: string[];
}

export class UpdateDealerRewardDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) threshold?: number;
  @IsOptional() @IsIn(['QUARTER', 'YEAR']) period?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
