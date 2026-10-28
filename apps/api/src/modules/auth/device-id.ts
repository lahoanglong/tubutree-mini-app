import { createHash } from 'node:crypto';

/**
 * deviceId là thứ DUY NHẤT xác thực tài khoản khách (xem GuestLoginDto): ai đọc được nó đăng nhập được tài khoản đó.
 * Vì vậy chỉ lưu bản băm, để CSKH xem cột zaloId hay bảng sự kiện cũng không lộ khoá.
 */
export function hashDeviceId(deviceId: string): string {
  return createHash('sha256').update(deviceId).digest('hex');
}

/** Khoá zaloId của dòng khách. Giữ tiền tố `guest_` để mọi chỗ kiểm khách vãng lai (real-user, báo cáo, gộp `_merged_`) vẫn đúng. */
export function guestZaloId(deviceId: string): string {
  return `guest_h_${hashDeviceId(deviceId)}`;
}

/** Khoá thô cũ (trước khi băm); chỉ để tìm dòng đã tạo trước đây và đổi sang khoá băm. */
export function legacyGuestZaloId(deviceId: string): string {
  return `guest_${deviceId}`;
}

const HASHED_GUEST_KEY = /^guest_h_[0-9a-f]{64}$/;

/** deviceId do máy khách chọn có thể được dựng sao cho khoá thô trùng khoá băm của người khác; loại trước khi dùng làm khoá cũ. */
export function isHashedGuestKey(zaloId: string): boolean {
  return HASHED_GUEST_KEY.test(zaloId);
}
