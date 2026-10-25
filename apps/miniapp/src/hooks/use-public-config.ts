import { useQuery } from '@tanstack/react-query';
import { getPublicConfig, type PublicConfig } from '../services/shop-api';

/**
 * Các con số nghiệp vụ do BE cấu hình. Giá trị mặc định chỉ dùng khi request chưa về
 * (hoặc lỗi mạng) để UI không nhấp nháy — BE vẫn là nguồn sự thật khi tính tiền.
 */
export const PUBLIC_CONFIG_FALLBACK: PublicConfig = {
  freeshipThreshold: 199_000,
  subscribeDiscountPct: 0.12,
  affiliateWalletMultiplier: 1.5,
  cashbackHoldDays: 30,
  waste: { enabled: false, dropoff: false, mailin: false, pickup: false },
  // Không hứa ngày giao khi server chưa xác nhận cấu hình (dự án 4a, Ruling 9).
  shippingEta: null,
};

/** API cũ chưa trả `waste` → lấy cờ tắt từ fallback. */
export function resolvePublicConfig(data: PublicConfig | undefined): PublicConfig {
  return data ? { ...data, waste: data.waste ?? PUBLIC_CONFIG_FALLBACK.waste } : PUBLIC_CONFIG_FALLBACK;
}

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
  return { ...resolvePublicConfig(q.data), isLoaded: q.data != null };
}

/**
 * Đóng khi chưa biết: lối vào AI chỉ hiện sau khi server xác nhận bật. Lỗi mạng hay API cũ → ẩn, vì hiện lối vào
 * rồi dẫn tới trang không trả lời được tệ hơn việc chậm một nhịp mới thấy nút.
 */
export function useAiAdvisorEnabled(): boolean {
  const cfg = usePublicConfig();
  return cfg.isLoaded && cfg.aiAdvisorEnabled === true;
}
