/** Backend đặt sẵn tên này cho tài khoản khách chưa biết tên thật (auth.service loginAsGuest). */
const GUEST_PLACEHOLDER_NAME = 'Khách';

/** Tên dùng được để điền sẵn form địa chỉ: bỏ tên giữ chỗ của tài khoản khách và chuỗi rỗng. */
export function usableProfileName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n.toLowerCase() === GUEST_PLACEHOLDER_NAME.toLowerCase() ? '' : n;
}

// Cùng tập ký tự vô hình với `trimInvisible` của API (apps/api/src/common/text-trim.ts), để client và API cùng coi một tên là rỗng.
const INVISIBLE = '\u00ad\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u2800\u3164\ufeff\uffa0';
const EDGE = new RegExp(`^[\\s${INVISIBLE}]+|[\\s${INVISIBLE}]+$`, 'g');

/** Họ tên khách gõ ở form hồ sơ, cắt khoảng trắng và ký tự vô hình hai đầu như `Trim` của UpdateMeDto. */
export function cleanProfileName(name: string): string {
  return name.replace(EDGE, '');
}

export const PROFILE_NAME_REQUIRED = 'Nhập họ tên để lưu hồ sơ.';

/**
 * Lỗi ô Họ và tên khi lưu hồ sơ. Xoá trắng tên (hoặc chỉ còn khoảng trắng, ký tự vô hình) thì chặn lưu: trước đây form bỏ tên rỗng
 * khỏi lời gọi, API giữ tên cũ mà vẫn báo "Đã cập nhật hồ sơ".
 */
export function profileNameError(name: string): string | null {
  return cleanProfileName(name) ? null : PROFILE_NAME_REQUIRED;
}
