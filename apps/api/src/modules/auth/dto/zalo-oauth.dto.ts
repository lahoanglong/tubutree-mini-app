import { IsOptional, IsString, IsNotEmpty } from 'class-validator';

/** POST /api/auth/zalo-oauth — Zalo Web Login OAuth v4 (PKCE). */
export class ZaloOAuthDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  /** code_verifier của PKCE (web sinh ra, gửi kèm khi đổi token). */
  @IsOptional()
  @IsString()
  codeVerifier?: string;
}
