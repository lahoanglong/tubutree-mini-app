import { useQuery } from '@tanstack/react-query';
import { getPublicConfig, type PublicConfig } from '../services/shop-api';

/**
 * Các con số nghiệp vụ do BE cấu hình. Giá trị mặc định chỉ dùng khi request chưa về
 * (hoặc lỗi mạng) để UI không nhấp nháy — BE vẫn là nguồn sự thật khi tính tiền.
 */
export const PUBLIC_CONFIG_FALLBACK: PublicConfig = {
  freeshipThreshold: 200_000,
  subscribeDiscountPct: 0.12,
  affiliateWalletMultiplier: 1.5,
  affiliateMinWithdrawBank: 50_000,
  cashbackHoldDays: 30,
  // Tắt cho tới khi server xác nhận (Gomdon đã cấu hình + admin bật) — không hứa dịch vụ thu gom
  // khi chưa biết backend có làm được không.
  recyclingEnabled: false,
  // Không hứa ngày giao khi server chưa xác nhận cấu hình (dự án 4a, Ruling 9).
  shippingEta: null,
};

/**
 * `isLoaded` = số liệu đến từ server thật. Màn nào hứa một con số cụ thể với user
 * (ví dụ ngưỡng freeship) nên chờ `isLoaded` rồi mới hiện, thay vì hiện giá trị mặc định.
 */
export function usePublicConfig(): PublicConfig & { isLoaded: boolean } {
  const q = useQuery({
    queryKey: ['public-config'],
    queryFn: getPublicConfig,
    staleTime: 5 * 60_000,
  });
  return { ...(q.data ?? PUBLIC_CONFIG_FALLBACK), isLoaded: q.data != null };
}
