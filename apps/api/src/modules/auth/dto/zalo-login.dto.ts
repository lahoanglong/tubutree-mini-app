import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

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
}
