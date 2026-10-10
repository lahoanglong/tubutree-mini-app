/**
 * Khách gần đây của CTV khi lên đơn hộ — lưu trên máy của CTV để lần sau điền sẵn tên, SĐT và
 * địa chỉ thay vì nhập lại cả 5 trường (mỗi đơn từng mất khoảng 13 chạm).
 *
 * Chỉ lưu cục bộ (không thêm API/DB), tách theo tài khoản vì máy có thể dùng chung, và luôn bọc
 * try/catch: localStorage có thể ném lỗi hoặc rỗng (chế độ riêng tư, webview chặn).
 */
export interface RecentCustomer {
  recipient: string;
  phone: string;
  street: string;
  province: string;
  provinceCode: string;
  ward: string;
  wardCode: string;
  usedAt: number;
}

export const MAX_RECENT_CUSTOMERS = 8;

const KEY_PREFIX = 'tubu_ctv_recent_customers';

const keyOf = (userId: string) => `${KEY_PREFIX}:${userId}`;

/** SĐT về dạng nội địa 0xxxxxxxxx để +84... và 0... cùng một khách. */
export const normalizeCustomerPhone = (phone: string) => phone.replace(/\s/g, '').replace(/^\+84/, '0');

const STRING_FIELDS = ['recipient', 'phone', 'street', 'province', 'provinceCode', 'ward', 'wardCode'] as const;

function isRecentCustomer(v: unknown): v is RecentCustomer {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return STRING_FIELDS.every((f) => typeof o[f] === 'string') && typeof o.usedAt === 'number';
}

export function loadRecentCustomers(userId: string | undefined): RecentCustomer[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(keyOf(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecentCustomer)
      .sort((a, b) => b.usedAt - a.usedAt)
      .slice(0, MAX_RECENT_CUSTOMERS);
  } catch {
    return [];
  }
}

function write(userId: string, list: RecentCustomer[]): void {
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(list));
  } catch {
    /* không lưu được thì lần sau nhập tay, không ảnh hưởng đơn đã tạo */
  }
}

export function saveRecentCustomer(userId: string | undefined, customer: RecentCustomer, now = Date.now()): void {
  if (!userId) return;
  const key = normalizeCustomerPhone(customer.phone);
  const rest = loadRecentCustomers(userId).filter((c) => normalizeCustomerPhone(c.phone) !== key);
  write(userId, [{ ...customer, usedAt: now }, ...rest].slice(0, MAX_RECENT_CUSTOMERS));
}

/** Tên + 3 số cuối SĐT để phân biệt các khách trùng tên. */
export function recentCustomerLabel(c: RecentCustomer): string {
  const tail = normalizeCustomerPhone(c.phone).slice(-3);
  return tail ? `${c.recipient} · …${tail}` : c.recipient;
}
