import type { InvoiceInfo } from './checkout-rules';

export const EMPTY_INVOICE: InvoiceInfo = { taxCode: '', companyName: '', address: '', email: '' };
const STORAGE_KEY = 'tubu_invoice';
const keyFor = (userId: string) => `${STORAGE_KEY}:${userId}`;

/**
 * Thông tin hoá đơn VAT khách đã dùng lần trước (đỡ nhập lại); không có hoặc hỏng thì để trống. Khoá theo tài khoản và xoá khi
 * đăng xuất: máy dùng chung không được điền sẵn MST/công ty/địa chỉ/email của người trước cho người sau.
 */
export function loadSavedInvoice(userId: string | null | undefined): InvoiceInfo {
  if (!userId) return EMPTY_INVOICE;
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (raw) {
      const p = JSON.parse(raw) as Partial<InvoiceInfo>;
      return {
        taxCode: typeof p.taxCode === 'string' ? p.taxCode : '',
        companyName: typeof p.companyName === 'string' ? p.companyName : '',
        address: typeof p.address === 'string' ? p.address : '',
        email: typeof p.email === 'string' ? p.email : '',
      };
    }
  } catch {
    /* chế độ riêng tư/dữ liệu hỏng: nhập lại */
  }
  return EMPTY_INVOICE;
}

export function saveInvoice(userId: string | null | undefined, invoice: InvoiceInfo): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(invoice));
  } catch {
    /* hết dung lượng/chế độ riêng tư: lần sau nhập lại, không được làm hỏng đơn vừa đặt */
  }
}

/** Xoá mọi bản lưu hoá đơn của trình duyệt này, kể cả khoá không theo tài khoản của bản cũ. */
export function clearSavedInvoices(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k === STORAGE_KEY || k?.startsWith(`${STORAGE_KEY}:`)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* chế độ riêng tư: không có gì để xoá */
  }
}
