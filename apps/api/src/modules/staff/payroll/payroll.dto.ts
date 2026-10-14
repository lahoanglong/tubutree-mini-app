import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/** "YYYY-MM-DD" là ngày có thật: new Date() tự dồn 2026-02-31 sang 03/03, khoản điều chỉnh rơi sang kỳ lương khác. */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function IsCalendarDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: object.constructor,
      propertyName,
      options,
      validator: { validate: isCalendarDate },
    });
  };
}

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
  @IsCalendarDate({ message: 'workDate không phải ngày có thật (vd 31/02).' })
  workDate!: string;

  // Trần ±50 triệu: `@IsInt()` không có biên, một cú gõ thừa số 0 là trừ/thưởng sai cả trăm
  // triệu và chỉ phát hiện được khi nhân viên nhìn bảng lương.
  @IsInt()
  @Min(-50_000_000)
  @Max(50_000_000)
  amount!: number; // dương=trừ, âm=thưởng

  @IsString()
  @MaxLength(500)
  reason!: string;
}
