import { IsString, IsNotEmpty } from 'class-validator';

/** POST /api/auth/refresh */
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}
