import { getZaloUserInfo } from './zmp-bridge';
import { usableProfileName } from '@tubutree/app-core/profile-name';
import { useAuthStore } from '../store/auth';

export { usableProfileName };

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
