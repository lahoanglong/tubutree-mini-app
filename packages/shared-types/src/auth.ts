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
  /** Điểm Xanh lô thường (có hạn, trần % khi dùng). Tổng khách thấy = pointsBalance + pointsConvertedBalance. */
  pointsBalance: number;
  /** Điểm Xanh lô quy đổi từ xu cũ: không hết hạn, dùng ở thanh toán tới 100% giá trị hàng, không rút ra tiền. */
  pointsConvertedBalance: number;
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
