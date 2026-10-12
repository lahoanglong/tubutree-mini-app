/**
 * Tên miền web để dựng link chia sẻ/giới thiệu (Q-20): app.tubutree.com là host đang phục vụ web trên PROD;
 * shop.tubutree.com không dùng được vì web coi "shop" là subdomain gian hàng CTV.
 */
export const DEFAULT_WEB_BASE_URL = 'https://app.tubutree.com';

/** Biến để trống (`VITE_WEB_BASE_URL=`) vẫn rơi về mặc định, nếu không link thành "/product/..." không mở được. */
export function resolveWebBaseUrl(raw: string | undefined): string {
  return raw?.trim().replace(/\/+$/, '') || DEFAULT_WEB_BASE_URL;
}

export const WEB_BASE_URL = resolveWebBaseUrl(import.meta.env.VITE_WEB_BASE_URL as string | undefined);
