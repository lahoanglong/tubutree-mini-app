import { getStorage, setStorage } from 'zmp-sdk/apis';
import { getSessionAttribution, normalizeEntryToken } from '../utils/entry-source';

export const FIRST_TOUCH_KEY = 'tubu_first_touch';
/** Storage Zalo có thể không bao giờ trả lời ngoài Zalo hay khi cầu nối native treo; số liệu không được giữ đăng nhập lại. */
const STORAGE_TIMEOUT_MS = 2_000;

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

async function resolveFirstTouch(): Promise<FirstTouch | undefined> {
  try {
    const res = await withTimeout(getStorage({ keys: [FIRST_TOUCH_KEY] }), STORAGE_TIMEOUT_MS);
    const saved = parseStored((res as Record<string, unknown>)[FIRST_TOUCH_KEY]);
    if (saved) return saved;
  } catch {
    return undefined;
  }
  // Máy chưa có chạm đầu: chỉ nguồn có tên (link/QR/thẻ) mới tính; mở app trần không phải một "nguồn" để lưu, nên lần
  // quét thẻ sau đó vẫn là chạm đầu có thật.
  const launch = getSessionAttribution();
  if (!launch) return undefined;
  const ft: FirstTouch = { source: launch.source, at: new Date().toISOString() };
  if (launch.campaign) ft.campaign = launch.campaign;
  try {
    await withTimeout(setStorage({ data: { [FIRST_TOUCH_KEY]: JSON.stringify(ft) } }), STORAGE_TIMEOUT_MS);
  } catch {
    /* không lưu được thì chỉ mất bản bền; lần đăng nhập này vẫn gửi được */
  }
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
