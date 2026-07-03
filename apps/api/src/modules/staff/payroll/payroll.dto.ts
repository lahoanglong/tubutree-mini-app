import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class UpdateBankDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankBin?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  bankAccountNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankAccountName?: string;

  @IsOptional()
  @IsString()
  qrImageUrl?: string;
}

export class SetRateDto {
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  hourlyRate!: number;
}

export class FinalizeDto {
  @IsInt() @Min(2020) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;
}

export class MarkPaidDto {
  @IsInt() @Min(2020) @Max(2100) year!: number;
  @IsInt() @Min(1) @Max(12) month!: number;

  @IsString()
  proofImageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdjustDto {
  @IsString()
  staffId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'workDate phải dạng YYYY-MM-DD.' })
  workDate!: string;

  @IsInt()
  amount!: number; // dương=trừ, âm=thưởng

  @IsString()
  @MaxLength(500)
  reason!: string;
}
