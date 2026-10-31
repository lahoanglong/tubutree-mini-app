import { usePublicConfig } from './use-public-config';

/**
 * Ngưỡng miễn phí giao hàng của khách cho nhãn trên thẻ. Chỉ khi cấu hình đã về từ máy chủ: giá trị mặc định của `usePublicConfig` chỉ để
 * giữ chỗ UI, hứa con số đó lên thẻ rồi đổi ý thì nhãn "Miễn phí giao hàng" chớp rồi tắt.
 */
export function useFreeShipThreshold(): number | null {
  const cfg = usePublicConfig();
  return cfg.isLoaded ? cfg.freeshipThreshold : null;
}
