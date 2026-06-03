import { IsString, IsNotEmpty } from 'class-validator';

/** POST /api/auth/zalo-mini-app */
export class ZaloMiniAppLoginDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  accessToken!: string;
}
