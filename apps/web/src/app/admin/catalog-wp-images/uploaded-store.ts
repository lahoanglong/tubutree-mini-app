/**
 * Nhớ các sản phẩm vừa được tải ảnh tay ở bàn duyệt ảnh. Máy chủ chỉ trả sản phẩm còn rỗng ảnh hoặc đã có quyết định, nên sản phẩm đã có ảnh tay biến khỏi danh sách;
 * không nhớ qua lần tải lại (F5) thì thanh "Đã đủ ảnh X/Y" tụt cả tử lẫn mẫu. Lưu theo trình duyệt (localStorage), mỗi id kèm giờ ghi, quá hạn thì bỏ để mẫu số
 * không phình mãi. Mọi truy cập lưu trữ đều có thể ném lỗi (chế độ riêng tư, bị chặn): lỗi thì coi như không nhớ được gì, trang vẫn chạy.
 */
const KEY = 'tubu-wp-triage-uploaded-v1';
export const UPLOADED_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const UPLOADED_MAX = 500;

type Stored = Record<string, number>;

function readRaw(): Stored {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Stored = {};
    for (const [id, at] of Object.entries(parsed)) if (typeof at === 'number' && Number.isFinite(at)) out[id] = at;
    return out;
  } catch {
    return {};
  }
}

function write(map: Stored): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* Không ghi được thì lần tải lại sau chỉ mất phần nhớ này. */
  }
}

/** Id còn hạn, mới nhất trước khi cắt ở UPLOADED_MAX. */
export function readUploaded(now: number = Date.now()): Set<string> {
  const fresh = Object.entries(readRaw()).filter(([, at]) => now - at <= UPLOADED_TTL_MS && at <= now + UPLOADED_TTL_MS);
  fresh.sort((a, b) => b[1] - a[1]);
  return new Set(fresh.slice(0, UPLOADED_MAX).map(([id]) => id));
}

export function rememberUploaded(id: string, now: number = Date.now()): void {
  const kept = Object.entries(readRaw()).filter(([key, at]) => key !== id && now - at <= UPLOADED_TTL_MS);
  kept.sort((a, b) => b[1] - a[1]);
  write(Object.fromEntries([[id, now], ...kept.slice(0, UPLOADED_MAX - 1)]));
}
