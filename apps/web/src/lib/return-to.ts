// Giữ "khách đang làm dở việc gì" qua vòng chuyển hướng Zalo OAuth: đăng nhập xong phải quay lại
// đúng trang (và đúng món định thêm vào giỏ) thay vì rơi về trang chủ với giỏ trống.
//
// sessionStorage (không phải query của redirect_uri): Zalo chỉ nhận redirect_uri đã đăng ký nên không
// đính thêm tham số vào được; sessionStorage sống qua vòng đi/về cùng tab, và cùng chỗ với PKCE verifier.
const RETURN_KEY = 'tubu_return_to';
const PENDING_ADD_KEY = 'tubu_pending_add';
const PENDING_ADD_TTL_MS = 30 * 60_000;
const MAX_PATH_LENGTH = 512;

/**
 * Chỉ nhận đường dẫn nội bộ của chính site ("/gio-hang", "/san-pham/x?ref=a"). Chặn "//host", "/\host",
 * "https://host" và ký tự điều khiển (trình duyệt bỏ tab/xuống dòng khi phân tích URL nên "/\t/host" thành "//host")
 * — nếu không, ?returnTo= thành open redirect sau khi đăng nhập. Không quay lại các trang đăng nhập (vòng lặp).
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_PATH_LENGTH) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  const pathname = raw.split(/[?#]/)[0]!;
  if (pathname === '/dang-nhap' || pathname.startsWith('/dang-nhap/')) return null;
  return raw;
}

/** Đường dẫn trang đăng nhập mang theo nơi cần quay lại. */
export function loginHref(returnTo?: string | null): string {
  const safe = safeReturnPath(returnTo);
  return safe ? `/dang-nhap?returnTo=${encodeURIComponent(safe)}` : '/dang-nhap';
}

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Ghi nhớ nơi quay lại; truyền null để xoá giá trị cũ còn sót từ lần đăng nhập dở trước. */
export function rememberReturnTo(path: string | null | undefined): void {
  const s = store();
  if (!s) return;
  try {
    const safe = safeReturnPath(path);
    if (safe) s.setItem(RETURN_KEY, safe);
    else s.removeItem(RETURN_KEY);
  } catch {
    /* không có storage thì chỉ mất việc quay lại đúng trang */
  }
}

/** Đọc rồi xoá nơi cần quay lại (dùng đúng một lần ở callback). */
export function takeReturnTo(): string | null {
  const s = store();
  if (!s) return null;
  try {
    const v = s.getItem(RETURN_KEY);
    s.removeItem(RETURN_KEY);
    return safeReturnPath(v);
  } catch {
    return null;
  }
}

export interface PendingAdd {
  variationId: string;
  quantity: number;
  /** Khách bấm "Mua ngay": thêm xong đi tiếp tới thanh toán thay vì dừng ở trang sản phẩm. */
  buyNow?: boolean;
}

/** Món khách bấm "Thêm vào giỏ"/"Mua ngay" khi chưa đăng nhập — thêm nốt (và đi tiếp tới thanh toán) sau khi đăng nhập xong. */
export function rememberPendingAdd(item: PendingAdd): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(PENDING_ADD_KEY, JSON.stringify({ ...item, at: Date.now() }));
  } catch {
    /* không có storage thì khách tự bấm lại sau khi đăng nhập */
  }
}

/**
 * Lấy (và xoá) món đang chờ nếu nó thuộc một trong các phân loại của trang hiện tại và chưa quá hạn;
 * món của trang khác được giữ nguyên để trang đó tự nhận.
 */
export function takePendingAdd(variationIds: readonly string[]): PendingAdd | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(PENDING_ADD_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingAdd> & { at?: number };
    const fresh = typeof v.at === 'number' && Date.now() - v.at <= PENDING_ADD_TTL_MS;
    if (!fresh) {
      s.removeItem(PENDING_ADD_KEY);
      return null;
    }
    if (typeof v.variationId !== 'string' || !variationIds.includes(v.variationId)) return null;
    s.removeItem(PENDING_ADD_KEY);
    const quantity = Number.isInteger(v.quantity) && (v.quantity as number) > 0 ? (v.quantity as number) : 1;
    return { variationId: v.variationId, quantity, ...(v.buyNow === true ? { buyNow: true } : {}) };
  } catch {
    return null;
  }
}
