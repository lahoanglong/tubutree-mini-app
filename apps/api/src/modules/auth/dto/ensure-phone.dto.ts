import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

/**
 * POST /api/auth/ensure-phone — gọi giữa một phiên ĐÃ đăng nhập (kể cả khách) khi checkout xin
 * SĐT (A7-01, audit 2026-09). Khác ZaloMiniAppLoginDto/route /auth/zalo-mini-app: route này
 * KHÔNG @Public() — bắt buộc JWT hợp lệ của phiên đang chạy, để backend biết CHÍNH XÁC đang là
 * ai và không bao giờ âm thầm trả token của một user khác (xem AuthService.ensurePhoneForCurrentUser).
 */
export class EnsurePhoneDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  accessToken!: string;

  /** Token từ apis.getPhoneNumber() — có thể vắng mặt khi gọi NGẦM (nâng cấp khách, không xin SĐT). */
  @IsString()
  @IsOptional()
  phoneToken?: string;
}
