'use client';

// Nguồn: FreeshipBoosterRail ở apps/miniapp/src/components/cart/freeship-booster/freeship-booster-rail.tsx (cùng cờ, cùng nguồn, cùng luật chọn món).
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { fetchFreeshipUpsell, freeshipUpsellParams, freeshipUpsellQueryKey } from '@tubutree/app-core/api/upsell';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { coreHttp } from '@/lib/core-http';
import { usePublicConfig } from '@/lib/use-public-config';

/** Tiền tố khoá query của `GET /upsell/freeship`: làm mới mọi khoảng thiếu cùng lúc khi máy chủ từ chối một món (món vừa hết hàng). */
export const FREESHIP_UPSELL_QUERY_PREFIX = ['upsell', 'freeship'] as const;

/**
 * Thẻ nguồn của dải mua thêm ở Giỏ; `remaining` là số còn thiếu tới mốc kế tiếp (Miễn phí giao hàng hoặc quà dùng thử 0đ). Cờ `commerce.freeship_booster_enabled` bật:
 * `GET /upsell/freeship` (đã xếp ở máy chủ, `booster` true để nơi gọi giữ thứ tự và dùng cửa sổ 45.000đ). Tắt, API cũ, cấu hình lỗi hay `/upsell/freeship` lỗi (cờ vừa tắt mà cấu hình còn trong bộ nhớ đệm thì máy chủ
 * trả 404): kệ Bán chạy nhất như trước (cùng khoá với Trang chủ). Còn chờ cấu hình thì chưa trả thẻ nào, kể cả khi kệ Bán chạy đã có sẵn từ Trang chủ, để dải không
 * hiện món cũ rồi đổi sang món mới. Đổi khoảng thiếu thì giữ thẻ cũ tới khi danh sách mới về.
 */
export function useFreeshipBoosterCards(remaining: number, lines: readonly { slug: string }[]): { booster: boolean; cards: readonly ProductCard[]; bestKey: readonly unknown[]; pending: boolean } {
  const cfg = usePublicConfig();
  const flagOn = cfg.isLoaded && cfg.freeshipBoosterEnabled === true;
  const params = flagOn ? freeshipUpsellParams(remaining, lines) : null;
  const upsell = useQuery({
    queryKey: params ? freeshipUpsellQueryKey(params) : [...FREESHIP_UPSELL_QUERY_PREFIX, 'off'],
    queryFn: () => fetchFreeshipUpsell(coreHttp, params!),
    enabled: params !== null,
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const booster = flagOn && !upsell.isError;
  const bestQuery = homeBestSellerQuery(coreHttp);
  const best = useQuery({ ...bestQuery, enabled: !cfg.isPending && !booster, staleTime: 60_000, retry: false });
  const cards = cfg.isPending ? [] : booster ? (upsell.data ?? []) : (best.data?.data ?? []);
  const pending = cfg.isPending || (booster ? upsell.isPending : best.isPending);
  return { booster, cards, bestKey: bestQuery.queryKey, pending };
}
