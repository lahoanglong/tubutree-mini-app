'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PurchasedItem } from '@tubutree/app-core/api/orders';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { rebuyPricing } from '@tubutree/app-core/rebuy-pricing';
import { homeText, reorderText } from '@/lib/home-text';
import { ui } from '@/lib/guest-ui';
import { usePublicConfig } from '@/lib/use-public-config';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { productHref } from '@/lib/product-href';
import { SubscribeSheet } from '@/app/san-pham/[slug]/subscribe-sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button, Card, Heading, PriceTag, ProductThumb, Text } from '@/components/mini';
import { homeErrorMessage } from '@/components/home/home-block-error';
import { isEndpointMissing } from '@/components/home/home-blocks';
import { useBlockQuery } from '@/components/home/use-block-query';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, type ReorderTarget } from './reorder-types';
import { usePurchasedItems } from './use-purchased-items';
import { ProductCard } from '@/components/mini/product-card';
import { RailCell, RailShell } from '@/components/mini/product-rail';
import { announcePdpNavigation } from '@/components/skeletons/pdp-nav-event';

/** Dùng CHUNG query key ['purchased-items', 10] với Trang chủ khi quyết định thứ tự khối. */
/** Hai nút hàng Mua lại chia đều chỗ; đệm ngang hẹp để nhãn "Định kỳ -17%" không bị cắt dấu ba chấm ở 320px. */
/** Tên luôn chiếm đủ 2 dòng (14px x 1.57) để thẻ cao như nhau với tên ngắn hay dài và khung chờ khớp thẻ thật. */
const NAME_MIN_HEIGHT = 44;
const ACTION_STYLE = { flex: '1 1 0', minWidth: 0, paddingInline: 12 } as const;

export const PURCHASED_RAIL_LIMIT = 10;

/**
 * Món đã mua dưới dạng thẻ sản phẩm: giá của đúng phân loại đã mua. Ghim phân loại để `ProductCard` chỉ xét Giờ vàng của chính phân loại đó
 * và mở trang chi tiết ở phân loại này (`?pv=`), nên giá trên thẻ và giá ở trang là một (cùng luật với `rebuyPricing`).
 */
export function toCardProduct(p: PurchasedItem): ProductCardData {
  return {
    id: p.productId,
    slug: p.slug,
    name: p.variationName ? `${p.productName} · ${p.variationName}` : p.productName,
    brand: p.brand,
    thumbnail: p.thumbnail,
    basePrice: p.price,
    salePrice: p.salePrice,
    repVariationId: p.variationId,
    pinnedVariationId: p.variationId,
    isFeatured: false,
    inStock: p.inStock !== false && p.stock > 0,
  };
}

/** Từ chừng này món trở lên mới dùng kệ cuộn ngang; ít hơn thì thẻ ngang thấp để không để trống nửa màn hình. */
export const COMPACT_MAX_ITEMS = 2;
const COMPACT_CARD_HEIGHT = 168;

/** Thẻ ngang thấp cho kệ Mua lại khi chỉ có 1–2 món (bản web của `CompactRebuyCard` ở Mini App): ảnh nhỏ, tên, phân loại, giá, nút mua lại và đặt định kỳ. */
function CompactRebuyCard({
  item,
  onRebuy,
  onSubscribe,
}: {
  item: PurchasedItem;
  onRebuy: () => void;
  onSubscribe: () => void;
}) {
  const router = useRouter();
  const discountPct = Math.round(usePublicConfig().subscribeDiscountPct * 100);
  const pricing = rebuyPricing(item, useActiveFlashSales());
  const available = item.inStock !== false && item.stock > 0;
  // Chỉ mời "Định kỳ" khi API xác nhận hàng không chỉ bán lẻ; API cũ chưa trả `retailOnly` thì không mời (máy chủ có thể từ chối).
  const subscribable = item.retailOnly === false;
  return (
    <Card variant="raised" padding={12}>
      <button
        type="button"
        aria-label={item.productName}
        className="tubu-press"
        onClick={() => {
          const href = productHref(encodeURIComponent(item.slug), null, item.variationId);
          announcePdpNavigation(href);
          router.push(href);
        }}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 44, padding: 0, border: 'none', background: 'transparent', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}
      >
        <ProductThumb src={item.thumbnail} alt="" size={64} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <Text variant="body-sm" as="span" style={{ fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: NAME_MIN_HEIGHT }}>
            {item.productName}
          </Text>
          {item.variationName && (
            <Text variant="caption" tone="secondary" as="span" style={{ display: 'block' }}>
              {item.variationName}
            </Text>
          )}
          <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            <PriceTag value={pricing.price} compareAt={pricing.compareAt ?? undefined} size="sm" />
            {item.timesBought > 1 && <Badge tone="brand" size="sm">{reorderText.timesBought(item.timesBought)}</Badge>}
          </span>
        </span>
      </button>
      {available ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button variant="secondary" onPress={onRebuy} style={ACTION_STYLE}>
            {homeCopy.reorder.buy}
          </Button>
          {subscribable && (
            <Button variant="ghost" onPress={onSubscribe} style={ACTION_STYLE}>
              {homeCopy.reorder.subscribe(discountPct)}
            </Button>
          )}
        </div>
      ) : (
        <Text variant="caption" tone="secondary" as="p" style={{ marginTop: 10 }}>
          {reorderText.unavailable}
        </Text>
      )}
    </Card>
  );
}

/**
 * Kệ "Mua lại": SP khách đã nhận hàng, mới mua trước. Khách mới / chưa đăng nhập / API cũ (404) / lỗi ở lần tải đầu → không render
 * gì (Trang chủ tự dựng khối lỗi "Thử lại" cho lỗi thật). Làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện kệ cũ kèm một dòng báo nhẹ + "Thử lại",
 * không để kệ biến mất im lặng. Mua lại = 2 chạm rồi tự sang giỏ.
 *
 * `target` là state (chỉ đổi khi chạm nút) nên danh tính ổn định — ReorderSheet khởi tạo lại lựa chọn theo danh tính `target`.
 */
export function PurchasedRail({ restoring = false }: { restoring?: boolean }) {
  const router = useRouter();
  const q = useBlockQuery(usePurchasedItems(PURCHASED_RAIL_LIMIT));
  const [target, setTarget] = useState<ReorderTarget | null>(null);
  const [subscribeFor, setSubscribeFor] = useState<PurchasedItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (restoring || q.isLoading) {
    // Khớp khung kệ thật (tiêu đề + hàng thẻ) để dữ liệu về không đẩy nội dung bên dưới.
    return (
      <div data-testid="purchased-rail-loading" aria-hidden="true" style={{ paddingBottom: 12 }}>
        <div style={{ padding: '4px 0 8px' }}>
          <Skeleton width={96} height={24} />
        </div>
        <Skeleton width="100%" height={COMPACT_CARD_HEIGHT} rounded="rounded-card" />
      </div>
    );
  }
  const items = q.data?.items ?? [];
  // Chưa có món nào: lỗi thật (không phải API cũ 404) vẫn hiện khối lỗi kèm "Thử lại", khách cũ không thấy kệ biến mất im lặng.
  if (items.length === 0 && !(q.isError && !isEndpointMissing(q.error))) return null;

  return (
    <section aria-label={reorderText.railTitle} style={{ paddingBottom: 12 }}>
      <div style={{ padding: '4px 0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Heading variant="title-sm" as="h2">
          {reorderText.railTitle}
        </Heading>
        <button
          type="button"
          className="tubu-press"
          onClick={() => router.push('/tai-khoan/don-hang?tab=delivered')}
          style={{ minHeight: 44, margin: '-10px -4px', padding: '0 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <Text variant="label" tone="brand">
            {homeText.seeAll}
          </Text>
        </button>
      </div>
      {q.isError && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-stone-700">{homeErrorMessage(q.error)}</p>
          <button
            type="button"
            disabled={q.isFetching}
            aria-busy={q.isFetching || undefined}
            aria-label={homeText.retryLabel(reorderText.railTitle)}
            onClick={() => void q.refetch()}
            className={`${ui.btnSecondary} flex-none`}
          >
            {homeText.retry}
          </button>
        </div>
      )}
      {items.length === 0 ? null : items.length <= COMPACT_MAX_ITEMS ? (
        <div className="flex flex-col gap-2.5 md:grid md:grid-cols-2 md:gap-4">
          {items.map((p) => (
            <CompactRebuyCard key={p.variationId} item={p} onRebuy={() => setTarget(itemReorderTarget(p))} onSubscribe={() => setSubscribeFor(p)} />
          ))}
        </div>
      ) : (
        <RailShell label="Sản phẩm đã mua">
          {/* Có món mua nhiều lần thì mọi thẻ giữ dòng ghi chú ('' giữ chỗ), không thì giá lệch 16px giữa thẻ có và không có ghi chú. */}
          {items.map((p) => (
            <RailCell key={p.variationId} variant="rail-md">
              <ProductCard
                product={toCardProduct(p)}
                variant="rail-md"
                showWishlist={false}
                note={p.timesBought > 1 ? reorderText.timesBought(p.timesBought) : items.some((x) => x.timesBought > 1) ? '' : undefined}
                addLabel={reorderText.cardCta}
                onAdd={p.inStock !== false && p.stock > 0 ? () => setTarget(itemReorderTarget(p)) : undefined}
              />
            </RailCell>
          ))}
        </RailShell>
      )}
      {notice && (
        <p role="status" className="mt-2 text-sm text-stone-700">
          {notice}
        </p>
      )}
      <ReorderSheet target={target} navigateToCart onClose={() => setTarget(null)} />
      {subscribeFor && (
        <SubscribeSheet visible onClose={() => setSubscribeFor(null)} onNotice={setNotice} variationId={subscribeFor.variationId} quantity={1} />
      )}
    </section>
  );
}
