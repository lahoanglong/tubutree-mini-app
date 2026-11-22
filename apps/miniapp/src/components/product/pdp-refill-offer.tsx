import { useEffect } from 'react';
import type { PdpRefillOfferView } from '@tubutree/app-core/refill/refill-saving';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { trackEvent } from '../../services/analytics';
import { Button } from '../ui/button';
import '../../css/refill-offer.css';

export interface PdpRefillOfferProps {
  /** Thẻ do `pdpRefillOffer` (app-core) dựng: tiêu đề có số tiết kiệm khi so được, dòng phụ số chai thay và giá gói. */
  view: PdpRefillOfferView;
  /** Lệnh "+ Thêm" của thẻ này đang chạy. */
  busy: boolean;
  /** Một lệnh ghi giỏ khác của trang đang chạy (chung khoá): báo bằng aria-disabled, không `disabled`, để nút đang giữ focus không rớt focus. */
  blocked?: boolean;
  onAdd: (view: PdpRefillOfferView) => void;
  /** Mở trang gói Refill. */
  onOpen: (slug: string) => void;
  /**
   * Nơi đặt thẻ (`refill_swap_shown.surface`): `pdp` (mặc định) và `order` ghi một lần hiện mỗi thẻ; `landing` (trang Tiết kiệm với Refill, nhiều thẻ)
   * không ghi ở thẻ, trang ghi một lần cho cả danh sách.
   */
  surface?: 'pdp' | 'landing' | 'order';
}

/**
 * Thẻ gói Refill ở trang chi tiết chai đã ghép cặp (tubu-w13-01), thay cho liên kết "Đổi sang túi Refill" cũ dưới dòng Mua lại: MỘT khối, cho mọi khách.
 * Trái: "Chọn túi Refill 10L tiết kiệm 470.000đ (~34%)" và "Thay thế 20 chai nhựa · 890.000đ" (chạm mở trang gói). Phải: "+ Thêm" 44px thêm gói vào giỏ
 * một chạm. Nút mua chính của trang vẫn là "Thêm vào giỏ" của chai.
 */
export function PdpRefillOffer({ view, busy, blocked, onAdd, onOpen, surface = 'pdp' }: PdpRefillOfferProps) {
  const id = view.productId;
  useEffect(() => {
    if (surface !== 'landing') trackEvent('refill_swap_shown', 'miniapp', { surface });
  }, [id, surface]);
  return (
    <div data-pdp-block="refill" data-testid="pdp-refill" className="tubu-refill-offer">
      <div className="tubu-refill-offer-card">
        <button type="button" data-testid="pdp-refill-open" className="tubu-refill-offer-main tubu-hit-44" onClick={() => onOpen(view.slug)}>
          <span className="tubu-refill-offer-title">{view.title}</span>
          <span className="tubu-refill-offer-meta">{view.meta}</span>
        </button>
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
