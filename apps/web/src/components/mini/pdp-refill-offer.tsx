'use client';

// Nguồn: apps/miniapp/src/components/product/pdp-refill-offer.tsx (cùng props trừ `onOpen`, cùng test-id).
import { useEffect } from 'react';
import Link from 'next/link';
import type { PdpRefillOfferView } from '@tubutree/app-core/refill/refill-saving';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { trackWebEvent } from '@/lib/analytics';
import { Button } from './button';

export interface PdpRefillOfferProps {
  /** Thẻ do `pdpRefillOffer` (app-core) dựng: tiêu đề có số tiết kiệm khi so được, dòng phụ số chai thay và giá gói. */
  view: PdpRefillOfferView;
  /** Lệnh "+ Thêm" của thẻ này đang chạy. */
  busy: boolean;
  /** Một lệnh ghi giỏ khác đang chạy: báo bằng aria-disabled, không `disabled`, để nút đang giữ focus không rớt focus. */
  blocked?: boolean;
  onAdd: (view: PdpRefillOfferView) => void;
  /**
   * Nơi đặt thẻ (`refill_swap_shown.surface`): `pdp` (mặc định) và `order` ghi một lần hiện mỗi thẻ; `landing` (trang Tiết kiệm với Refill, nhiều thẻ)
   * không ghi ở thẻ, trang ghi một lần cho cả danh sách.
   */
  surface?: 'pdp' | 'landing' | 'order';
  /** false: nơi đặt tự ghi lần hiện (trang sản phẩm ghi khi dải chọn cách mua có nút Refill, thẻ chỉ hiện khi khách chọn chế độ đó). Mặc định true. */
  trackShown?: boolean;
}

/**
 * Thẻ gói Refill ở trang chi tiết chai đã ghép cặp (tubu-w13-01), thay cho liên kết "Đổi sang túi Refill" cũ dưới dòng Mua lại: MỘT khối, cho mọi khách.
 * Trái: "Chọn túi Refill 10L tiết kiệm 470.000đ (~34%)" và "Thay thế 20 chai nhựa · 890.000đ" (liên kết thật tới trang gói). Phải: "+ Thêm" 44px thêm gói
 * vào giỏ một chạm. Số đo dưới md cùng Mini App (mini.css).
 */
export function PdpRefillOffer({ view, busy, blocked, onAdd, surface = 'pdp', trackShown = true }: PdpRefillOfferProps) {
  const id = view.productId;
  useEffect(() => {
    if (trackShown && surface !== 'landing') trackWebEvent('refill_swap_shown', { surface });
  }, [id, surface, trackShown]);
  return (
    <div data-testid="pdp-refill" className="tubu-refill-offer">
      <div className="tubu-refill-offer-card">
        <Link href={`/san-pham/${encodeURIComponent(view.slug)}`} data-testid="pdp-refill-open" className="tubu-refill-offer-main tubu-hit-44">
          <span className="tubu-refill-offer-title">{view.title}</span>
          <span className="tubu-refill-offer-meta">{view.meta}</span>
        </Link>
        <Button
          variant="secondary"
          className="tubu-refill-offer-add"
          data-testid="pdp-refill-add"
          aria-label={view.addAria}
          aria-disabled={blocked || undefined}
          loading={busy}
          onPress={() => onAdd(view)}
        >
          {fillCopy('freeship.add')}
        </Button>
      </div>
    </div>
  );
}
