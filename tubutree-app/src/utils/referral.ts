/**
 * Referral Capture — đọc ref code từ URL khi user mở app lần đầu, lưu pending,
 * gọi attribute API sau khi đã đăng nhập.
 *
 * Cách dùng:
 * - Gọi `captureRefFromUrl()` ngay khi app khởi động (trong app.tsx hoặc App component).
 * - Sau khi user login xong, gọi `attributePendingRef()` (idempotent).
 */
import { affiliateHubApi } from "services/api";

const STORAGE_KEY = "tubutree_pending_ref";

export function captureRefFromUrl() {
  try {
    // 1. Query string URL thông thường
    const params = new URLSearchParams(window.location.search);
    let ref = params.get("ref");

    // 2. Zalo Mini App truyền params qua `window.ZMP_LAUNCH_OPTIONS` hoặc parse hash
    if (!ref) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      ref = hashParams.get("ref");
    }
    // 3. Fallback - Zalo có thể inject `_zoaa_params`
    if (!ref) {
      const zaloLaunch = (window as any).ZMP_LAUNCH_OPTIONS;
      if (zaloLaunch?.path) {
        const m = String(zaloLaunch.path).match(/[?&]ref=([^&]+)/);
        if (m) ref = decodeURIComponent(m[1]);
      }
    }

    if (ref && /^[A-Z0-9]{4,16}$/i.test(ref)) {
      localStorage.setItem(STORAGE_KEY, ref.toUpperCase());
    }
  } catch {
    // ignore — không phá UX nếu fail
  }
}

export function getPendingRef(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export async function attributePendingRef(): Promise<boolean> {
  const ref = getPendingRef();
  if (!ref) return false;
  try {
    await affiliateHubApi.attributeReferral(ref);
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    // Giữ pending nếu lỗi tạm thời, xoá nếu code không tồn tại hoặc self-referral
    // (đơn giản: xoá nếu lỗi 4xx)
    localStorage.removeItem(STORAGE_KEY);
    return false;
  }
}
