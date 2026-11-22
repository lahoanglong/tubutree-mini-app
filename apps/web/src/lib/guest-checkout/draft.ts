/**
 * Nháp biểu mẫu nhận hàng của khách chưa đăng nhập (`/thanh-toan`): họ tên, SĐT, tỉnh/phường, số nhà, ghi chú. Khách quay về giỏ thêm món cho
 * đủ mốc miễn phí giao rồi trở lại thì không phải gõ lại. Giữ trong sessionStorage (chỉ tab này, mất khi đóng tab), không giữ cách trả tiền,
 * khoá theo dõi hay gì khác. Đặt đơn xong thì xoá.
 */

const DRAFT_KEY = 'tubu.guestCheckout.draft';

export interface GuestDraftGeo {
  province: string;
  provinceCode: string;
  ward: string;
  wardCode: string;
}

export interface GuestCheckoutDraft {
  name: string;
  phone: string;
  geo: GuestDraftGeo;
  street: string;
  note: string;
}

/** Trần độ dài khi đọc lại: bằng `maxLength` của từng ô (bản lưu bị sửa tay không làm ô vượt trần). */
const MAX = { name: 120, phone: 20, street: 255, note: 500, geoName: 120, geoCode: 20 } as const;
const EMPTY_GEO: GuestDraftGeo = { province: '', provinceCode: '', ward: '', wardCode: '' };
export const EMPTY_GUEST_DRAFT: GuestCheckoutDraft = { name: '', phone: '', geo: EMPTY_GEO, street: '', note: '' };

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

function geoOf(v: unknown): GuestDraftGeo {
  const g = (v ?? {}) as Record<string, unknown>;
  const geo = {
    province: text(g.province, MAX.geoName),
    provinceCode: text(g.provinceCode, MAX.geoCode),
    ward: text(g.ward, MAX.geoName),
    wardCode: text(g.wardCode, MAX.geoCode),
  };
  // Tên và mã luôn đi cặp (GeoPicker đặt cả hai): thiếu một nửa thì bỏ cấp đó, phường không đứng một mình khi chưa có tỉnh.
  if (!geo.province || !geo.provinceCode) return EMPTY_GEO;
  if (!geo.ward || !geo.wardCode) return { ...geo, ward: '', wardCode: '' };
  return geo;
}

export function readGuestDraft(): GuestCheckoutDraft {
  try {
    const raw = storage()?.getItem(DRAFT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_GUEST_DRAFT;
    const d = parsed as Record<string, unknown>;
    return {
      name: text(d.name, MAX.name),
      phone: text(d.phone, MAX.phone),
      geo: geoOf(d.geo),
      street: text(d.street, MAX.street),
      note: text(d.note, MAX.note),
    };
  } catch {
    return EMPTY_GUEST_DRAFT;
  }
}

const isEmpty = (d: GuestCheckoutDraft) => !d.name && !d.phone && !d.geo.provinceCode && !d.street && !d.note;

/** Lưu nháp; biểu mẫu trống thì xoá bản lưu. Không ghi được (chế độ riêng tư, hết chỗ) thì thôi: biểu mẫu vẫn chạy. */
export function saveGuestDraft(d: GuestCheckoutDraft): void {
  const s = storage();
  if (!s) return;
  try {
    if (isEmpty(d)) s.removeItem(DRAFT_KEY);
    else s.setItem(DRAFT_KEY, JSON.stringify({ name: d.name, phone: d.phone, geo: d.geo, street: d.street, note: d.note }));
  } catch {
    /* bỏ qua */
  }
}

export function clearGuestDraft(): void {
  try {
    storage()?.removeItem(DRAFT_KEY);
  } catch {
    /* bỏ qua */
  }
}
