import { getZaloUserInfo } from './zmp-bridge';
import { useAuthStore } from '../store/auth';

/** Backend đặt sẵn tên này cho tài khoản khách chưa biết tên thật (auth.service loginAsGuest). */
const GUEST_PLACEHOLDER_NAME = 'Khách';

/** Tên dùng được để điền sẵn form địa chỉ: bỏ tên giữ chỗ của tài khoản khách và chuỗi rỗng. */
export function usableProfileName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return n.toLowerCase() === GUEST_PLACEHOLDER_NAME.toLowerCase() ? '' : n;
}

export interface ZaloProfile {
  name: string;
  phone: string;
}

/**
 * Xin tên + SĐT Zalo để điền sẵn form địa chỉ của đơn đầu (Q-27). Không bao giờ throw: khách từ chối
 * hoặc đang chạy ngoài Zalo thì trường tương ứng trả '' và khách tự nhập. Chỉ hỏi phần còn thiếu của
 * tài khoản, và hỏi lần lượt (tên rồi SĐT) vì hai sheet native không được chồng lên nhau.
 */
export async function requestZaloProfile(): Promise<ZaloProfile> {
  const user = useAuthStore.getState().user;
  let name = usableProfileName(user?.fullName);
  let phone = user?.phone ?? '';

  if (!name) {
    try {
      const info = await getZaloUserInfo();
      name = usableProfileName(info?.name);
    } catch {
      /* từ chối quyền tên → nhập tay */
    }
  }
  if (!phone) {
    try {
      phone = (await useAuthStore.getState().ensurePhone()) ?? '';
    } catch {
      /* từ chối SĐT → nhập tay */
    }
  }
  return { name, phone };
}
