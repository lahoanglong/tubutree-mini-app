import { browserStorage, type StorageLike } from './recently-viewed';
import {
  isLegacyGeo,
  LAST_GEO_KEY,
  pickLastGeo as pickLastGeoCore,
  recallLastGeo as recallLastGeoCore,
  rememberLastGeo as rememberLastGeoCore,
  scopedKey,
} from '@tubutree/app-core/address-geo-memory';
import type { AddressDTO } from '../services/shop-api';
import type { GeoValue } from '../components/geo-picker';

export { isLegacyGeo, LAST_GEO_KEY };
/** Đã xin tên + SĐT Zalo cho form địa chỉ rồi (khách chấp nhận hay từ chối đều không xin lại). */
export const ZALO_PREFILL_ASKED_KEY = 'tubu_zalo_prefill_asked';

export function rememberLastGeo(
  geo: GeoValue,
  storage: StorageLike | null = browserStorage(),
  userId?: string | null,
): void {
  rememberLastGeoCore(geo, storage, userId);
}

export function recallLastGeo(storage: StorageLike | null = browserStorage(), userId?: string | null): GeoValue | null {
  return recallLastGeoCore(storage, userId);
}

export function pickLastGeo(addresses: readonly AddressDTO[] | undefined): GeoValue | null {
  return pickLastGeoCore(addresses);
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
