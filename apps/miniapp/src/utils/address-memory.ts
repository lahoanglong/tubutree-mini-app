import { browserStorage, type StorageLike } from './recently-viewed';
import type { AddressDTO } from '../services/shop-api';
import type { GeoValue } from '../components/geo-picker';

/** Tỉnh + phường của địa chỉ vừa lưu gần nhất trên máy này (hệ địa giới 2 cấp của Pancake, không có quận). */
export const LAST_GEO_KEY = 'tubu_last_geo';
/** Đã xin tên + SĐT Zalo cho form địa chỉ rồi (khách chấp nhận hay từ chối đều không xin lại). */
export const ZALO_PREFILL_ASKED_KEY = 'tubu_zalo_prefill_asked';

/** Máy dùng chung / đổi tài khoản: mỗi tài khoản một khoá để không điền sẵn nhầm và không bỏ qua bước xin quyền của người sau. */
function scopedKey(base: string, userId?: string | null): string {
  return userId ? `${base}:${userId}` : base;
}

/**
 * Địa chỉ lưu theo địa giới cũ: mã '00' (trước khi dùng danh mục Pancake) hoặc mã tỉnh hệ 3 cấp (trước sắp xếp
 * 2025). Mã đó không gửi được khi đặt đơn (API trả ADDRESS_OUTDATED) nên phải chọn lại tỉnh/phường.
 */
export function isLegacyGeo(g: { provinceCode?: string | null; wardCode?: string | null }): boolean {
  return !g.provinceCode?.startsWith('84_VN') || !g.wardCode || g.wardCode === '00';
}

function hasRealCodes(g: { provinceCode?: string | null; wardCode?: string | null }): boolean {
  return !isLegacyGeo(g);
}

function pickGeo(g: GeoValue): GeoValue {
  return { province: g.province, provinceCode: g.provinceCode, ward: g.ward, wardCode: g.wardCode };
}

export function rememberLastGeo(
  geo: GeoValue,
  storage: StorageLike | null = browserStorage(),
  userId?: string | null,
): void {
  if (!storage || !hasRealCodes(geo)) return;
  try {
    storage.setItem(scopedKey(LAST_GEO_KEY, userId), JSON.stringify(pickGeo(geo)));
  } catch {
    /* hết quota / bị chặn — chỉ mất tiện ích điền sẵn */
  }
}

export function recallLastGeo(storage: StorageLike | null = browserStorage(), userId?: string | null): GeoValue | null {
  try {
    const raw = storage?.getItem(scopedKey(LAST_GEO_KEY, userId));
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof o.province !== 'string' ||
      typeof o.provinceCode !== 'string' ||
      typeof o.ward !== 'string' ||
      typeof o.wardCode !== 'string'
    ) {
      return null;
    }
    const geo: GeoValue = { province: o.province, provinceCode: o.provinceCode, ward: o.ward, wardCode: o.wardCode };
    return hasRealCodes(geo) ? geo : null;
  } catch {
    return null;
  }
}

/** Dự phòng khi máy chưa nhớ gì (địa chỉ tạo trước bản này / đổi máy): lấy từ sổ địa chỉ, ưu tiên địa chỉ mặc định. */
export function pickLastGeo(addresses: readonly AddressDTO[] | undefined): GeoValue | null {
  if (!addresses?.length) return null;
  const usable = addresses.filter(hasRealCodes);
  const a = usable.find((x) => x.isDefault) ?? usable[0];
  return a ? pickGeo(a) : null;
}

// Cờ trong bộ nhớ chỉ dùng khi không ghi được storage — để vẫn không xin lại mỗi lần mở form.
const askedInMemory = new Set<string>();

export function hasAskedZaloPrefill(storage: StorageLike | null = browserStorage(), userId?: string | null): boolean {
  const key = scopedKey(ZALO_PREFILL_ASKED_KEY, userId);
  if (askedInMemory.has(key)) return true;
  try {
    return storage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function markZaloPrefillAsked(storage: StorageLike | null = browserStorage(), userId?: string | null): void {
  const key = scopedKey(ZALO_PREFILL_ASKED_KEY, userId);
  try {
    if (storage) {
      storage.setItem(key, '1');
      return;
    }
  } catch {
    /* rơi xuống cờ trong bộ nhớ */
  }
  askedInMemory.add(key);
}
