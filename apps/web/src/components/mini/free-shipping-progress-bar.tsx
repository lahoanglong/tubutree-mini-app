'use client';

// Nguồn: apps/miniapp/src/components/ui/free-shipping-progress-bar.tsx (cùng props, cùng test-id).
import { freeshipProgress } from '@tubutree/app-core/commerce/freeship-progress';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '@/lib/format-vnd';
import { Button } from './button';

export interface FreeShippingProgressBarProps {
  /** Tiền hàng đang chọn (hoặc phần Tubu giao khi giỏ có hàng gian hàng tự giao). */
  base: number;
  threshold: number;
  /** Cờ miễn phí giao của máy chủ, chỉ truyền khi tin được (xem `freeshipProgress`). */
  serverReached?: boolean;
  /** Giỏ có hàng gian hàng tự giao: chữ nói rõ chỉ tính phần hàng Tubu Tree giao. */
  tubuOnly?: boolean;
  /** Một chạm quay lại chọn thêm món, đặt cạnh dòng chữ khi chưa đạt ngưỡng; đạt rồi thì không có nút. Không truyền thì khối giữ nguyên như cũ. */
  onShopMore?: () => void;
}

/**
 * Thanh tiến độ Miễn phí giao hàng ở đầu Giỏ. Chưa đạt: một dòng "Mua thêm … để được Miễn phí giao hàng" và thanh đầy dần (số đo khớp bước tính ở app-core), kèm nút "Mua thêm" nếu có `onShopMore`.
 * Đạt: một dòng chúc mừng màu xanh ngọc, không còn thanh, không còn nút. Khối cao tối thiểu bằng trạng thái chưa đạt (mini.css) nên câu một dòng đổi trạng thái không làm giỏ nhảy.
 */
export function FreeShippingProgressBar({ base, threshold, serverReached, tubuOnly = false, onShopMore }: FreeShippingProgressBarProps) {
  const p = freeshipProgress({ base, threshold, serverReached });
  const text = p.reached
    ? fillCopy(tubuOnly ? 'freeship.reachedTubu' : 'freeship.reached')
    : fillCopy(tubuOnly ? 'freeship.progressTubu' : 'freeship.progress', { price: formatVnd(p.remaining) });
  const showCta = !p.reached && !!onShopMore;
  const label = <p className="tubu-freeship-text">{text}</p>;
  return (
    <div data-testid="freeship-progress" data-reached={p.reached ? 'true' : 'false'} data-cta={onShopMore ? 'true' : undefined} aria-live="polite" className="tubu-freeship">
      {onShopMore ? (
        <div className="tubu-freeship-head">
          {label}
          {showCta && (
            <Button
              variant="secondary"
              className="tubu-freeship-cta"
              data-testid="freeship-shop-more-cta"
              aria-label={fillCopy(tubuOnly ? 'freeship.shopMoreAriaTubu' : 'freeship.shopMoreAria', { price: formatVnd(p.remaining) })}
              onPress={onShopMore}
            >
              {fillCopy('freeship.shopMoreCta')}
            </Button>
          )}
        </div>
      ) : (
        label
      )}
      {!p.reached && (
        <div
          data-testid="freeship-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p.pct}
          aria-label={fillCopy('freeship.barAria', { pct: p.pct })}
          className="tubu-freeship-track"
        >
          <div data-testid="freeship-fill" className="tubu-freeship-fill" style={{ width: `${p.pct}%` }} />
        </div>
      )}
    </div>
  );
}
