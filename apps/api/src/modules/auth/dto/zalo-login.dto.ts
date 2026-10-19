import { Allow, IsString, IsNotEmpty, IsOptional } from 'class-validator';

/** POST /api/auth/zalo-mini-app */
export class ZaloMiniAppLoginDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  /** Token từ apis.getPhoneNumber() — backend giải mã lấy SĐT (spec §6.1 bước 5). */
  @IsString()
  @IsOptional()
  phoneToken?: string;

  /** Mã giới thiệu từ deep link ?ref= (nếu được bạn bè mời vào app). */
  @IsString()
  @IsOptional()
  referralCode?: string;

  /** Nguồn chạm đầu {source, campaign?, at?} từ máy khách. Cố ý không validate chặt ở đây: số liệu phân tích không được làm 400 một lần đăng nhập, common/attribution.ts bỏ giá trị bẩn. */
  @IsOptional()
  @Allow()
  firstTouch?: unknown;
}
