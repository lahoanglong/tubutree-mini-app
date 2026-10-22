import type { UserRole } from './enums';

/** Payload nhúng trong JWT access token. */
export interface JwtPayload {
  sub: string; // userId
  role: UserRole;
  zaloId?: string;
  affiliateEnabled?: boolean;
  dealerEnabled?: boolean;
  /** Nhóm việc của STAFF (CSKH, KHO) — JwtStrategy đọc từ DB mỗi request, không ký vào token. */
  staffPermissions?: string[];
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

/** Thân GET /api/auth/me: hồ sơ + cờ chủ nhãn (đăng nhập/refresh không trả cờ này). */
export interface AuthMeResponse extends AuthUser {
  /** true khi user là chủ ít nhất một nhãn: client biết có nên gọi /brand/owner/me, khỏi chịu 404 của người không phải chủ. */
  ownsBrand: boolean;
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
