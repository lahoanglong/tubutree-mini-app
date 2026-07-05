import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateFaqDto {
  @IsOptional() @IsString() category?: string;
  @IsString() question!: string;
  @IsString() answer!: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFaqDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() question?: string;
  @IsOptional() @IsString() answer?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
