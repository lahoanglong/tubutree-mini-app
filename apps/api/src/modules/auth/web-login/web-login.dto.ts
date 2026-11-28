import { Allow, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

/** POST /api/auth/email-otp/request. Định dạng email kiểm ở EmailOtpService (normalizeEmail) để mọi đường cùng một luật và một câu báo. */
export class EmailOtpRequestDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;
}

/** POST /api/auth/email-otp/verify. */
export class EmailOtpVerifyDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  email!: string;

  /** Mã 6 số nguyên văn (không Trim: OTP thô đi thẳng tới chỗ so). */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Mã gồm đúng 6 chữ số.' })
  code!: string;

  /** Mã giới thiệu từ deep link ?ref= (chỉ dùng khi lần này tạo tài khoản mới). */
  @IsOptional()
  @IsString()
  @Trim()
  @MaxLength(32)
  referralCode?: string;

  /** Nguồn chạm đầu; cố ý không validate chặt (xem ZaloOAuthDto.firstTouch). */
  @IsOptional()
  @Allow()
  firstTouch?: unknown;
}

/** POST /api/auth/google/callback: `code` và `state` trang /dang-nhap/google nhận từ Google. */
export class GoogleCallbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  state!: string;

  @IsOptional()
  @IsString()
  @Trim()
  @MaxLength(32)
  referralCode?: string;

  @IsOptional()
  @Allow()
  firstTouch?: unknown;
}
