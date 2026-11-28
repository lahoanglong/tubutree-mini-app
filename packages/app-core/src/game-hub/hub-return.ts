/**
 * Màn game riêng (game mini, Chọn Chuẩn Xanh) có nút quay lại về `/game` (web `/vuon-xanh`) không kèm tab, nên khách rơi về tab Chăm vườn và phải
 * bấm lại Sảnh Game sau mỗi ván. Thẻ ở Sảnh Game đặt dấu này trước khi rời trang; Vườn Xanh mở lại trong `HUB_RETURN_TTL_MS` thì mở thẳng Sảnh
 * Game rồi xoá dấu. Dấu nằm trong sessionStorage nên đóng app là hết.
 */
export const HUB_RETURN_KEY = 'tubu.game.hubReturn';
export const HUB_RETURN_TTL_MS = 30 * 60_000;

export interface HubReturnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type Store = () => HubReturnStorage | null;

export function markHubReturn(store: Store, now = Date.now()): void {
  try {
    store()?.setItem(HUB_RETURN_KEY, String(now));
  } catch {
    /* kho bị chặn (chế độ riêng tư): quay về tab mặc định */
  }
}

/** Chỉ đọc, không xoá, nên gọi được trong hàm khởi tạo state; xoá bằng `clearHubReturn` trong effect. */
export function hasHubReturn(store: Store, now = Date.now()): boolean {
  try {
    const raw = store()?.getItem(HUB_RETURN_KEY) ?? null;
    if (raw === null) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now >= at && now - at < HUB_RETURN_TTL_MS;
  } catch {
    return false;
  }
}

export function clearHubReturn(store: Store): void {
  try {
    store()?.removeItem(HUB_RETURN_KEY);
  } catch {
    /* kho bị chặn: không có gì để xoá */
  }
}

/** sessionStorage của trình duyệt (lấy qua globalThis lúc gọi vì app-core không có kiểu DOM), hoặc null trên máy chủ hay khi bị chặn. */
export function browserSessionStore(): HubReturnStorage | null {
  try {
    return (globalThis as unknown as { sessionStorage?: HubReturnStorage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}
