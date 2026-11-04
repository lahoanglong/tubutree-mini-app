import type { AdminInvoiceRequest, AdminInvoiceStatus, AdminOrderStatusHistoryRow, AdminShippingAddress } from './admin-client';
import { INVOICE_URL_MAX } from './admin-client';
import type { Tone } from './recycling';

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Địa chỉ giao hiển thị cho CSKH: người nhận + SĐT + dòng địa chỉ. Hệ hành chính 2 cấp thì `district` rỗng — bỏ
 * phần rỗng để không ra ", ,". Không có gì để hiện (đơn cũ/đơn tạo tay) → null.
 */
export function formatShippingAddress(
  addr: AdminShippingAddress | null | undefined,
): { recipient: string; phone: string; line: string } | null {
  if (!addr || typeof addr !== 'object') return null;
  const line = [addr.street, addr.ward, addr.district, addr.province].map(text).filter(Boolean).join(', ');
  const recipient = text(addr.recipient);
  const phone = text(addr.phone);
  if (!line && !recipient && !phone) return null;
  return { recipient, phone, line };
}

const ACTOR_LABEL: Record<string, string> = {
  ADMIN: 'Admin',
  CUSTOMER: 'Khách',
  MERCHANT: 'Đối tác',
  PANCAKE: 'Pancake',
  SYSTEM: 'Hệ thống',
};

/** Ai đổi trạng thái: loại tác nhân + tên/SĐT nếu có tài khoản. */
export function actorLabel(row: Pick<AdminOrderStatusHistoryRow, 'actorType' | 'actor'>): string {
  const base = ACTOR_LABEL[row.actorType] ?? row.actorType;
  const who = row.actor?.fullName || row.actor?.phone;
  return who ? `${base} · ${who}` : base;
}

export function invoiceStatusLabel(status: AdminInvoiceStatus | null | undefined): { label: string; tone: Tone } | null {
  if (status === 'REQUESTED') return { label: 'Chờ xuất hoá đơn', tone: 'warning' };
  if (status === 'ISSUED') return { label: 'Đã xuất hoá đơn', tone: 'success' };
  if (status === 'FAILED') return { label: 'Xuất hoá đơn lỗi', tone: 'danger' };
  return null;
}

/** Cùng luật với AdminService.issueOrderInvoice — BE vẫn là chốt chặn cuối (lỗi hiện nguyên văn). */
export function canIssueInvoice(o: {
  invoiceRequest?: AdminInvoiceRequest | null;
  invoiceStatus?: AdminInvoiceStatus | null;
  status: string;
}): boolean {
  return !!o.invoiceRequest && o.invoiceStatus !== 'ISSUED' && o.status !== 'CANCELLED' && o.status !== 'RETURNED';
}

function isInternalHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (host.startsWith('[')) {
    const m = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(host);
    if (m) {
      const hi = parseInt(m[1]!, 16);
      return isInternalHost(`${hi >> 8}.${hi & 255}.0.0`);
    }
    return host === '[::]' || host === '[::1]' || /^\[f[cd]/.test(host) || /^\[fe[89ab]/.test(host);
  }
  return false;
}

/** Link hoá đơn tuỳ chọn; có thì phải là https hợp lệ ≤ 500 ký tự (khớp IssueInvoiceDto). null = hợp lệ. */
export function invoiceUrlError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.length > INVOICE_URL_MAX) return `Link tối đa ${INVOICE_URL_MAX} ký tự.`;
  try {
    const u = new URL(v);
    if (u.protocol === 'https:') {
      if (u.username || u.password) return 'Link hoá đơn không được kèm tài khoản/mật khẩu.';
      // Máy chủ mới biết danh sách tên miền được phép (env); ở đây chỉ chặn sớm địa chỉ nội bộ rõ ràng.
      const h = u.hostname.toLowerCase().replace(/\.$/, '');
      if (isInternalHost(h)) return 'Link hoá đơn không được trỏ tới địa chỉ nội bộ.';
      return null;
    }
  } catch {
    /* rơi xuống thông báo chung */
  }
  return 'Link hoá đơn phải là địa chỉ https hợp lệ.';
}
