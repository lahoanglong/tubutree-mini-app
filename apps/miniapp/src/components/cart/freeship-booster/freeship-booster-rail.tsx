import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { fetchFreeshipUpsell, freeshipUpsellParams, freeshipUpsellQueryKey } from '@tubutree/app-core/api/upsell';
import { FREESHIP_BOOSTER_WINDOW, pickFreeshipAddons } from '@tubutree/app-core/commerce/freeship-progress';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Box } from 'zmp-ui';
import { usePublicConfig } from '../../../hooks/use-public-config';
import { coreHttp } from '../../../services/core-http';
import { fetchActiveFlashSales } from '../../../services/shop-api';
import { cardAddTarget } from '../../../utils/card-add-target';
import { serverNow } from '../../../utils/server-clock';
import { homeBestSellerQuery } from '../../home/home-best-seller-query';
import { FreeshipAddonRail, type FreeshipAddonItem } from '../../ui/freeship-addon-rail';

export interface FreeshipBoosterRailProps {
  /** Số còn thiếu để Miễn phí giao hàng (đồng, > 0). */
  remaining: number;
  /** Các dòng giỏ HIỆN CÓ: món đã trong giỏ không được gợi ý lại. */
  lines: readonly { slug: string; variationId: string }[];
  busySlug?: string | null;
  onAdd: (item: FreeshipAddonItem) => void;
}

/**
 * Dải gợi ý bù đơn dưới thanh Miễn phí giao hàng của Giỏ. Cờ `commerce.freeship_booster_enabled` bật: tiêu đề "Thêm 1 món nhỏ để đủ Miễn phí giao hàng", món lấy từ
 * `GET /upsell/freeship` (giá từ số còn thiếu tới số còn thiếu + 45.000đ, bán chạy trước, giữ thứ tự máy chủ). Tắt, API cũ, cấu hình lỗi hay `/upsell/freeship` lỗi
 * (cờ vừa tắt mà cấu hình còn trong bộ nhớ đệm thì máy chủ trả 404): dải cũ từ kệ Bán chạy nhất (cửa sổ 25.000đ). Cấu hình còn chờ thì chưa vẽ gì, kể cả khi kệ Bán
 * chạy đã có sẵn từ Trang chủ, để dải không hiện món cũ rồi đổi. Cả hai nguồn đều được xét lại theo giá Giờ vàng và giỏ mới nhất (`pickFreeshipAddons`). Đổi số còn
 * thiếu (vừa thêm món) thì giữ món cũ tới khi danh sách mới về, dải không nháy trống.
 */
export function FreeshipBoosterRail({ remaining, lines, busySlug = null, onAdd }: FreeshipBoosterRailProps) {
  const cfg = usePublicConfig();
  const flagOn = cfg.isLoaded && cfg.freeshipBoosterEnabled === true;
  const params = flagOn ? freeshipUpsellParams(remaining, lines) : null;
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
  const items: FreeshipAddonItem[] = pickFreeshipAddons(
    // Hàng gian hàng tự giao (hoặc gian hàng đang nghỉ) không hưởng Miễn phí giao hàng của Tubu: thêm vào cũng không bù được khoảng thiếu.
    cards
      .filter((card) => (card.fulfiller?.kind ?? 'TUBU') === 'TUBU')
      .map((card) => {
        const target = cardAddTarget(card, flashQ.data ?? [], serverNow());
        return { slug: card.slug, name: card.name, thumbnail: card.thumbnail, price: target.price, compareAt: target.compareAt, variationId: target.variationId, inStock: card.inStock !== false };
      }),
    {
      remaining,
      inCartSlugs: new Set(lines.map((l) => l.slug)),
      inCartVariationIds: new Set(lines.map((l) => l.variationId)),
      ...(booster ? { window: FREESHIP_BOOSTER_WINDOW, ranked: true } : {}),
    },
  ).map((c) => ({ slug: c.slug, name: c.name, thumbnail: c.thumbnail, price: c.price, compareAt: c.compareAt, variationId: c.variationId! }));

  if (items.length === 0) return null;
  return (
    <Box px={3} pt={2}>
      <FreeshipAddonRail
        title={booster ? fillCopy('freeship.boosterTitle') : undefined}
        items={items}
        busySlug={busySlug}
        onAdd={onAdd}
      />
    </Box>
  );
}
