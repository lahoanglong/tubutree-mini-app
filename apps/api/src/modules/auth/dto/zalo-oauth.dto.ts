import { Allow, IsOptional, IsString, IsNotEmpty } from 'class-validator';

/** POST /api/auth/zalo-oauth — Zalo Web Login OAuth v4 (PKCE). */
export class ZaloOAuthDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** code_verifier của PKCE (web sinh ra, gửi kèm khi đổi token). */
  @IsOptional()
  @IsString()
  codeVerifier?: string;

  /** Mã giới thiệu từ deep link ?ref= (nếu được bạn bè mời vào app). */
  @IsOptional()
  @IsString()
  referralCode?: string;

  /** Nguồn chạm đầu {source, campaign?, at?} từ máy khách. Cố ý không validate chặt ở đây: số liệu phân tích không được làm 400 một lần đăng nhập, common/attribution.ts bỏ giá trị bẩn. */
  @IsOptional()
  @Allow()
  firstTouch?: unknown;
}
