import { getStorage, removeStorage, setStorage } from 'zmp-sdk/apis';
import { getSessionAttribution, normalizeEntryToken } from '../utils/entry-source';

export const FIRST_TOUCH_KEY = 'tubu_first_touch';
/**
 * Storage Zalo có thể không bao giờ trả lời ngoài Zalo hay khi cầu nối native treo, mà đăng nhập đang đợi loadFirstTouch():
 * số liệu không được giữ đăng nhập lại quá hạn này. Lần ghi không được đợi (xem resolveFirstTouch), nên đây cũng là trần của cả hàm.
 */
const STORAGE_TIMEOUT_MS = 500;
/** Cùng hạn với API (apps/api/src/common/attribution.ts): API bỏ chạm quá 90 ngày, nên máy cũng không giữ bản quá hạn. */
const FIRST_TOUCH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Nguồn chạm đầu trên máy, gửi kèm đăng nhập để API ghi vào tài khoản MỚI (API không bao giờ ghi đè). */
export interface FirstTouch {
  source: string;
  campaign?: string;
  /** ISO, lúc máy này thấy nguồn lần đầu (API chỉ nhận nếu trong 90 ngày gần nhất). */
  at?: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('storage timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function parseStored(raw: unknown): FirstTouch | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const source = normalizeEntryToken(v.source);
    if (!source) return undefined;
    const out: FirstTouch = { source };
    const campaign = normalizeEntryToken(v.campaign);
    if (campaign) out.campaign = campaign;
    if (typeof v.at === 'string' && !Number.isNaN(Date.parse(v.at))) out.at = v.at;
    return out;
  } catch {
    return undefined;
  }
}

function isExpired(ft: FirstTouch): boolean {
  return ft.at !== undefined && Date.now() - Date.parse(ft.at) > FIRST_TOUCH_MAX_AGE_MS;
}

function touchFromLaunch(): FirstTouch | undefined {
  const launch = getSessionAttribution();
  if (!launch) return undefined;
  const ft: FirstTouch = { source: launch.source, at: new Date().toISOString() };
  if (launch.campaign) ft.campaign = launch.campaign;
  return ft;
}

async function resolveFirstTouch(): Promise<FirstTouch | undefined> {
  let expired = false;
  try {
    const res = await withTimeout(getStorage({ keys: [FIRST_TOUCH_KEY] }), STORAGE_TIMEOUT_MS);
    const saved = parseStored((res as Record<string, unknown>)[FIRST_TOUCH_KEY]);
    if (saved && !isExpired(saved)) return saved;
    expired = saved !== undefined;
  } catch {
    // Không đọc được (lỗi hay quá hạn chờ) thì không biết máy đã có chạm đầu hay chưa: gửi nguồn của lần mở này để tài khoản mới
    // vẫn có nguồn (API chỉ ghi khi cột còn trống), nhưng KHÔNG ghi xuống máy kẻo đè lên chạm đầu thật chưa đọc được.
    return touchFromLaunch();
  }
  // Máy chưa có chạm đầu (hoặc bản cũ đã quá hạn): chỉ nguồn có tên (link/QR/thẻ) mới tính; mở app trần không phải một
  // "nguồn" để lưu, nên lần quét thẻ sau đó vẫn là chạm đầu có thật.
  const ft = touchFromLaunch();
  if (!ft) {
    if (expired) void removeStorage({ keys: [FIRST_TOUCH_KEY] }).catch(() => undefined);
    return undefined;
  }
  // Không đợi ghi: đăng nhập cần câu trả lời ngay; ghi lỗi thì chỉ mất bản bền, lần đăng nhập này vẫn gửi được.
  void setStorage({ data: { [FIRST_TOUCH_KEY]: JSON.stringify(ft) } }).catch(() => undefined);
  return ft;
}

let pending: Promise<FirstTouch | undefined> | null = null;

/** Một lần mỗi lần mở app: đọc hoặc tạo chạm đầu của máy. Không bao giờ ném. */
export function loadFirstTouch(): Promise<FirstTouch | undefined> {
  pending ??= resolveFirstTouch();
  return pending;
}

export function __resetFirstTouchForTest(): void {
  pending = null;
}
