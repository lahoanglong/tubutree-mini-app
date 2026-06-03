import type { UserRole } from './enums';

/** Payload nhúng trong JWT access token. */
export interface JwtPayload {
  sub: string; // userId
  role: UserRole;
  zaloId?: string;
  affiliateEnabled?: boolean;
  dealerEnabled?: boolean;
}

/** Hồ sơ user trả về client sau khi đăng nhập. */
export interface AuthUser {
  id: string;
  zaloId?: string | null;
  phone?: string | null;
  email?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  role: UserRole;
  tierId?: string | null;
  referralCode: string;
  pointsBalance: number;
  walletBalance: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse extends AuthTokens {
  user: AuthUser;
}

/** Body cho POST /api/auth/zalo-mini-app */
export interface ZaloMiniAppLoginDto {
  code: string;
  accessToken: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}
