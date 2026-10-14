import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';
import { IsCalendarDate } from '../../../common/calendar-date';
import { Trim } from '../../../common/decorators/trim.decorator';

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
  @NotEquals(0, { message: 'Số tiền điều chỉnh phải khác 0 (số dương = trừ lương, số âm = thưởng).' })
  amount!: number; // dương=trừ, âm=thưởng

  // Lý do là dấu vết kiểm toán duy nhất của khoản trừ/thưởng tay — nhân viên đọc nó khi hỏi vì sao lương thiếu.
  @Trim()
  @IsString()
  @MinLength(3, { message: 'Lý do điều chỉnh cần ít nhất 3 ký tự.' })
  @MaxLength(500)
  reason!: string;

  /** Admin xác nhận đây là khoản thứ hai thật (cùng ngày, số tiền, lý do với khoản vừa ghi trong 5 phút). */
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;
}
