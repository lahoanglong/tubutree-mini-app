/** Backend đặt sẵn tên này cho tài khoản khách chưa biết tên thật (auth.service loginAsGuest). */
const GUEST_PLACEHOLDER_NAME = 'Khách';

/** Tên dùng được để điền sẵn form địa chỉ: bỏ tên giữ chỗ của tài khoản khách và chuỗi rỗng. */
export function usableProfileName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n.toLowerCase() === GUEST_PLACEHOLDER_NAME.toLowerCase() ? '' : n;
}
