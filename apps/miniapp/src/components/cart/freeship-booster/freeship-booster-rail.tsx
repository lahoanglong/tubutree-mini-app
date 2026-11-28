import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { fetchFreeshipUpsell, freeshipUpsellParams, freeshipUpsellQueryKey } from '@tubutree/app-core/api/upsell';
import { pickAovAddons, type AovUpsellGoal } from '@tubutree/app-core/cart/aov-upsell';
import { FREESHIP_BOOSTER_WINDOW } from '@tubutree/app-core/commerce/freeship-progress';
import { Box } from '../../ui/box';
import { usePublicConfig } from '../../../hooks/use-public-config';
import { coreHttp } from '../../../services/core-http';
import { fetchActiveFlashSales } from '../../../services/shop-api';
import { cardAddTarget } from '../../../utils/card-add-target';
import { serverNow } from '../../../utils/server-clock';
import { homeBestSellerQuery } from '../../home/home-best-seller-query';
import { FreeshipAddonRail, type FreeshipAddonItem } from '../../ui/freeship-addon-rail';

export interface FreeshipBoosterRailProps {
  /** Mốc kế tiếp (`aovUpsellGoal`): Miễn phí giao hàng hoặc quà dùng thử 0đ; dòng đầu dải và số còn thiếu gửi cho `GET /upsell/freeship`. */
  goal: AovUpsellGoal;
  /** Các dòng giỏ HIỆN CÓ: món đã trong giỏ không được gợi ý lại. */
  lines: readonly { slug: string; variationId: string }[];
  /** Quà dùng thử 0đ (`aovGiftExclusions`): không gợi ý khách trả tiền cho món quà. */
  exclude?: { slugs: ReadonlySet<string>; variationIds: ReadonlySet<string> };
  busySlug?: string | null;
  onAdd: (item: FreeshipAddonItem) => void;
  /** Dải có hiện không: true đủ món, false không (nguồn đã về hay lỗi, hoặc dải rời màn), null còn chờ nguồn. Giỏ dùng cho `aovGiftLockedRowShown`. */
  onShownChange?: (shown: boolean | null) => void;
}

/**
 * Dải gợi ý mua thêm món nhỏ ở đầu Giỏ (tubu-w7-02): nhắm mốc kế tiếp (Miễn phí giao hàng, rồi quà dùng thử 0đ; dòng đầu theo `aovUpsellGoal().headline`), tối đa 2 món
 * giá không quá 120.000đ (`pickAovAddons`). Cờ `commerce.freeship_booster_enabled` bật: món lấy từ `GET /upsell/freeship` với `gap` là số còn thiếu (giá tới số
 * còn thiếu + 45.000đ, bán chạy trước, giữ thứ tự máy chủ). Tắt, API cũ, cấu hình lỗi hay `/upsell/freeship` lỗi (cờ vừa tắt mà cấu hình còn trong bộ nhớ đệm
 * thì máy chủ trả 404): món từ kệ Bán chạy nhất (cửa sổ 25.000đ). Cấu hình còn chờ thì chưa vẽ gì, kể cả khi kệ Bán chạy đã có sẵn từ Trang chủ, để dải không
 * hiện món cũ rồi đổi. Cả hai nguồn đều được xét lại theo giá Giờ vàng và giỏ mới nhất. Đổi số còn thiếu (vừa thêm món) thì giữ món cũ tới khi danh sách mới
 * về, dải không nháy trống.
 */
export function FreeshipBoosterRail({ goal, lines, exclude, busySlug = null, onAdd, onShownChange }: FreeshipBoosterRailProps) {
  const cfg = usePublicConfig();
  const flagOn = cfg.isLoaded && cfg.freeshipBoosterEnabled === true;
  // Món quà cũng gửi vào `exclude`: máy chủ không tốn chỗ trong danh sách cho món app sẽ bỏ.
  const params = flagOn ? freeshipUpsellParams(goal.shortfall, [...lines, ...[...(exclude?.slugs ?? [])].map((slug) => ({ slug }))]) : null;
  const upsellQ = useQuery({
    queryKey: params ? freeshipUpsellQueryKey(params) : ['upsell', 'freeship', 'off'],
    queryFn: () => fetchFreeshipUpsell(coreHttp, params!),
    enabled: params !== null,
    staleTime: 30_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const booster = flagOn && !upsellQ.isError;
  const bestQ = useQuery({ ...homeBestSellerQuery, enabled: !cfg.isPending && !booster, staleTime: 60_000 });
  const flashQ = useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000 });

  const cards: readonly ProductCard[] = cfg.isPending ? [] : booster ? (upsellQ.data ?? []) : (bestQ.data?.data ?? []);
  const items: FreeshipAddonItem[] = pickAovAddons(
    // Hàng gian hàng tự giao (hoặc gian hàng đang nghỉ) không tính vào mốc của Tubu: thêm vào cũng không bù được khoảng thiếu.
    cards
      .filter((card) => (card.fulfiller?.kind ?? 'TUBU') === 'TUBU')
      .map((card) => {
        const target = cardAddTarget(card, flashQ.data ?? [], serverNow());
        return { slug: card.slug, name: card.name, thumbnail: card.thumbnail, price: target.price, compareAt: target.compareAt, variationId: target.variationId, inStock: card.inStock !== false };
      }),
    {
      shortfall: goal.shortfall,
      inCartSlugs: new Set(lines.map((l) => l.slug)),
      inCartVariationIds: new Set(lines.map((l) => l.variationId)),
      excludeSlugs: exclude?.slugs,
      excludeVariationIds: exclude?.variationIds,
      ...(booster ? { window: FREESHIP_BOOSTER_WINDOW, ranked: true } : {}),
    },
  ).map((c) => ({ slug: c.slug, name: c.name, thumbnail: c.thumbnail, price: c.price, compareAt: c.compareAt, variationId: c.variationId! }));

  const loading = cfg.isPending || (booster ? upsellQ.isPending : bestQ.isPending);
  const shown = items.length > 0 ? true : loading ? null : false;
  useEffect(() => {
    if (!onShownChange) return undefined;
    onShownChange(shown);
    return () => onShownChange(false);
  }, [shown, onShownChange]);

  if (shown !== true) return null;
  return (
    <Box px={3} pt={2}>
      <FreeshipAddonRail title={goal.headline} stage={goal.stage} items={items} busySlug={busySlug} onAdd={onAdd} collapsible />
    </Box>
  );
}
