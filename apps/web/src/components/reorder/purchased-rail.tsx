'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { PurchasedItem } from '@tubutree/app-core/api/orders';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { formatVnd } from '@/lib/format-vnd';
import { homeText, reorderText } from '@/lib/home-text';
import { ui } from '@/lib/guest-ui';
import { usePublicConfig } from '@/lib/use-public-config';
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

/** Dùng CHUNG query key ['purchased-items', 10] với Trang chủ khi quyết định thứ tự khối. */
/** Hai nút hàng Mua lại chia đều chỗ; đệm ngang hẹp để nhãn "Định kỳ -17%" không bị cắt dấu ba chấm ở 320px. */
/** Tên luôn chiếm đủ 2 dòng (14px x 1.57) để thẻ cao như nhau với tên ngắn hay dài và khung chờ khớp thẻ thật. */
const NAME_MIN_HEIGHT = 44;
const ACTION_STYLE = { flex: '1 1 0', minWidth: 0, paddingInline: 12 } as const;

export const PURCHASED_RAIL_LIMIT = 10;

function RebuyTile({ item, onRebuy }: { item: PurchasedItem; onRebuy: () => void }) {
  const name = item.variationName ? `${item.productName} · ${item.variationName}` : item.productName;
  const onSale = item.salePrice != null && item.salePrice < item.price;
  return (
    <li className="flex w-[148px] flex-none flex-col overflow-hidden rounded-card border border-stone-200 bg-stone-0 shadow-card sm:w-44">
      <Link href={`/san-pham/${encodeURIComponent(item.slug)}`} className="block">
        <div className="aspect-square w-full bg-stone-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {item.thumbnail && <img src={item.thumbnail} alt={name} width={176} height={176} loading="lazy" className="h-full w-full object-cover" />}
        </div>
        <div className="p-2">
          {item.brand && <p className="truncate text-xs text-stone-600">{item.brand}</p>}
          <p className="line-clamp-2 h-8 text-xs leading-4 text-stone-900">{name}</p>
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-sm font-bold text-stone-900">{formatVnd(onSale ? item.salePrice! : item.price)}</span>
            {onSale && <span className="text-xs text-stone-500 line-through">{formatVnd(item.price)}</span>}
          </div>
          <div className="mt-1 min-h-[1.25rem]">
            {item.timesBought > 1 && (
              <Badge tone="brand" size="sm">
                {reorderText.timesBought(item.timesBought)}
              </Badge>
            )}
          </div>
        </div>
      </Link>
      <div className="mt-auto p-2 pt-0">
        {item.inStock !== false && item.stock > 0 ? (
          <button type="button" onClick={onRebuy} className={`${ui.btnSecondary} w-full`}>
            {reorderText.cardCta}
          </button>
        ) : (
          <p className="flex min-h-11 items-center justify-center text-xs text-stone-600">{reorderText.unavailable}</p>
        )}
      </div>
    </li>
  );
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
  const standing = item.salePrice ?? item.price;
  const hasSale = standing < item.price;
  const available = item.inStock !== false && item.stock > 0;
  // Chỉ mời "Định kỳ" khi API xác nhận hàng không chỉ bán lẻ; API cũ chưa trả `retailOnly` thì không mời (máy chủ có thể từ chối).
  const subscribable = item.retailOnly === false;
  return (
    <Card variant="raised" padding={12}>
      <button
        type="button"
        aria-label={item.productName}
        className="tubu-press"
        onClick={() => router.push(`/san-pham/${encodeURIComponent(item.slug)}`)}
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
            <PriceTag value={standing} compareAt={hasSale ? item.price : undefined} size="sm" />
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
        <div className="flex flex-col gap-2.5 md:max-w-xl">
          {items.map((p) => (
            <CompactRebuyCard key={p.variationId} item={p} onRebuy={() => setTarget(itemReorderTarget(p))} onSubscribe={() => setSubscribeFor(p)} />
          ))}
        </div>
      ) : (
        <ul className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-3">
          {items.map((p) => (
            <RebuyTile key={p.variationId} item={p} onRebuy={() => setTarget(itemReorderTarget(p))} />
          ))}
        </ul>
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
