import type { MissionTarget } from './game-newbie';
import { PROFILE_REFERRAL_SECTION } from './profile-sections';

// Tách khỏi game-newbie.ts: Mini App có gói đầu nạp module đó (qua i18n), còn bảng đường dẫn chỉ trang Vườn Xanh dùng.

/**
 * Đường dẫn nút "Làm ngay" của từng đích, mỗi nền một bảng (cùng đích, khác đường dẫn). "Mời bạn" mở khối mã giới thiệu ở Cá nhân, nơi
 * khách thật sự sao chép và chia sẻ mã; Ví chỉ hiện số dư.
 */
export const MISSION_PATHS = {
  miniapp: {
    catalog: '/browse',
    'delivered-orders': '/orders?tab=delivered',
    invite: `/profile?section=${PROFILE_REFERRAL_SECTION}`,
  },
  web: {
    catalog: '/san-pham',
    'delivered-orders': '/tai-khoan/don-hang?tab=delivered',
    invite: `/tai-khoan?section=${PROFILE_REFERRAL_SECTION}`,
  },
} as const satisfies Record<'miniapp' | 'web', Record<Exclude<MissionTarget, 'checkin'>, string>>;
