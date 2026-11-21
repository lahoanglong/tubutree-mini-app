'use client';

import { useRef } from 'react';
import { PDP_PURCHASED_LIMIT, pdpRebuy } from '@tubutree/app-core/commerce/pdp-info';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useQuickAdd } from '@/app/tai-khoan/yeu-thich/quick-add';
import { useProductStock } from '@/components/pdp-stock';
import { usePurchasedItems } from '@/components/reorder/use-purchased-items';
import { useAuthPhase } from '@/lib/auth-phase';
import { ui } from '@/lib/guest-ui';
import { phoneSecondary } from '@/lib/phone-ui';
import { variationLabel } from '@/lib/variation-label';

/** Danh sách món đã mua (`purchasedItemsQuery` thêm giới hạn ở cuối khoá): bị từ chối vì phân loại đã đổi thì tải lại đúng danh sách này. */
const PURCHASED_ITEMS_KEY = ['purchased-items'] as const;

/**
 * Dòng "Bạn đã mua ngày dd/mm · Mua lại" (khách đã đăng nhập có đơn đã giao chứa sản phẩm này; `pdpRebuy` của app-core chọn lần mua gần nhất).
 * Một chạm thêm đúng phân loại lần trước, số lượng 1, qua đường giỏ nhanh dùng chung với dải "Mua lại món quen" (`useQuickAdd`: ghi giỏ vào cache,
 * thông báo nổi, khoá chạm đúp, tải lại danh sách khi máy chủ từ chối). Phân loại đó hết hàng hay không còn trên trang thì không có dòng.
 * Nút phụ, không phải nút chính: nút mua chính của trang vẫn là "Thêm vào giỏ".
 * Gói Refill của chai là khối riêng ngay sau dòng này (`PdpRefillOfferBlock`, cho mọi khách), không nằm trong dòng.
 */
export function PdpRebuyRow({
  productId,
  slug,
  productName,
  variations,
  blocked = false,
}: {
  productId: string;
  slug: string;
  productName: string;
  variations: readonly { id: string; name: string; stock: number }[];
  /** Gian hàng tạm nghỉ/ngừng bán: không mời mua lại. */
  blocked?: boolean;
}) {
  const authed = useAuthPhase() === 'authenticated';
  const purchased = usePurchasedItems(PDP_PURCHASED_LIMIT);
  const stock = useProductStock(slug).data;
  const quick = useQuickAdd('repurchase', PURCHASED_ITEMS_KEY);
  const button = useRef<HTMLButtonElement>(null);
  const live = variations.map((v) => ({ id: v.id, stock: stock?.[v.id] ?? v.stock }));
  const rebuy = authed && !blocked ? pdpRebuy(purchased.data?.items, productId, live) : null;
  // Không có dòng thì không để lại phần tử rỗng (dải Đặt định kỳ ẩn khi rỗng); lời báo lỗi của lần bấm vừa rồi vẫn hiện nếu dòng vừa mất vì danh sách tải lại.
  if (!rebuy) return quick.notice ? <>{quick.feedback}</> : null;
  const variation = variations.find((v) => v.id === rebuy.variationId);
  const name = variationLabel(variation?.name ?? '', variations.length) || productName;
  const busy = quick.busyId === rebuy.variationId;
  return (
    <>
      <div data-pdp-block="rebuy" className="mt-3 flex min-h-11 items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-[var(--color-text-secondary)] tabular-nums">{fillCopy('pdp.rebuyLine', { date: rebuy.dateLabel })}</p>
        <button
          ref={button}
          type="button"
          data-testid="pdp-rebuy"
          aria-label={fillCopy('pdp.rebuySpoken', { name, date: rebuy.dateLabel })}
          aria-busy={busy || undefined}
          aria-disabled={busy || undefined}
          onClick={() => void quick.addVariation(rebuy.variationId, { origin: button.current })}
          className={`${ui.btnSecondary} ${phoneSecondary} flex-none`}
        >
          {fillCopy('pdp.rebuyCta')}
        </button>
      </div>
      {quick.feedback}
    </>
  );
}
