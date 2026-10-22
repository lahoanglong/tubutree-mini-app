'use client';

import { useQuery } from '@tanstack/react-query';
import type { PublicConfig } from '@tubutree/app-core/api/config';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { coreHttp } from './core-http';

/**
 * Các con số nghiệp vụ do BE cấu hình. Giá trị mặc định chỉ dùng khi request chưa về (hoặc lỗi mạng) để UI không nhấp nháy;
 * BE vẫn là nguồn sự thật khi tính tiền.
 */
export const PUBLIC_CONFIG_FALLBACK: PublicConfig = {
  freeshipThreshold: 199_000,
  subscribeDiscountPct: 0.12,
  affiliateWalletMultiplier: 1.5,
  affiliateMinWithdrawBank: 50_000,
  cashbackHoldDays: 30,
  waste: { enabled: false, dropoff: false, mailin: false, pickup: false },
  // Không hứa ngày giao khi server chưa xác nhận cấu hình.
  shippingEta: null,
};

/** API cũ chưa trả `waste` → lấy cờ tắt từ fallback. */
export function resolvePublicConfig(data: PublicConfig | undefined): PublicConfig {
  return data ? { ...data, waste: data.waste ?? PUBLIC_CONFIG_FALLBACK.waste } : PUBLIC_CONFIG_FALLBACK;
}

/** `isLoaded` = số liệu đến từ server thật; màn nào hứa một con số cụ thể với khách nên chờ `isLoaded`. */
export function usePublicConfig(): PublicConfig & { isLoaded: boolean } {
  const q = useQuery({ ...publicConfigQuery(coreHttp), staleTime: 5 * 60_000 });
  return { ...resolvePublicConfig(q.data), isLoaded: q.data != null };
}

/** Đóng khi chưa biết: lối vào AI chỉ hiện sau khi server xác nhận bật. */
export function useAiAdvisorEnabled(): boolean {
  const cfg = usePublicConfig();
  return cfg.isLoaded && cfg.aiAdvisorEnabled === true;
}
