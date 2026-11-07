'use client';

// Nguồn: apps/miniapp/src/components/ui/free-shipping-progress-bar.tsx (cùng props, cùng test-id).
import { freeshipProgress } from '@tubutree/app-core/commerce/freeship-progress';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '@/lib/format-vnd';

export interface FreeShippingProgressBarProps {
  /** Tiền hàng đang chọn (hoặc phần Tubu giao khi giỏ có hàng gian hàng tự giao). */
  base: number;
  threshold: number;
  /** Cờ miễn phí giao của máy chủ, chỉ truyền khi tin được (xem `freeshipProgress`). */
  serverReached?: boolean;
  /** Giỏ có hàng gian hàng tự giao: chữ nói rõ chỉ tính phần hàng Tubu Tree giao. */
  tubuOnly?: boolean;
}

/**
 * Thanh tiến độ Miễn phí giao hàng ở đầu Giỏ. Chưa đạt: một dòng "Mua thêm … để được Miễn phí giao hàng" và thanh đầy dần (số đo khớp bước tính ở app-core).
 * Đạt: một dòng chúc mừng màu xanh ngọc, không còn thanh. Khối cao tối thiểu bằng trạng thái chưa đạt (mini.css) nên đổi trạng thái không làm giỏ nhảy.
 */
export function FreeShippingProgressBar({ base, threshold, serverReached, tubuOnly = false }: FreeShippingProgressBarProps) {
  const p = freeshipProgress({ base, threshold, serverReached });
  return (
    <div data-testid="freeship-progress" data-reached={p.reached ? 'true' : 'false'} aria-live="polite" className="tubu-freeship">
      {p.reached ? (
        <p className="tubu-freeship-text">{fillCopy(tubuOnly ? 'freeship.reachedTubu' : 'freeship.reached')}</p>
      ) : (
        <>
          <p className="tubu-freeship-text">{fillCopy(tubuOnly ? 'freeship.progressTubu' : 'freeship.progress', { price: formatVnd(p.remaining) })}</p>
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
        </>
      )}
    </div>
  );
}
