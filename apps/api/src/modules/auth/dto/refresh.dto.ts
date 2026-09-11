import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * POST /api/auth/refresh và /api/auth/logout.
 *
 * `refreshToken` là TUỲ CHỌN vì web shop gửi token qua cookie `HttpOnly` (`x-client: web`),
 * không qua thân request. Controller tự bắt lỗi khi cả hai đường đều rỗng.
 */
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  refreshToken?: string;
}
