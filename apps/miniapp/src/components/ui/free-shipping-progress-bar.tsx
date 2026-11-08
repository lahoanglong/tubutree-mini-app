import { freeshipProgress } from '@tubutree/app-core/commerce/freeship-progress';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '../../utils/format';
import { Button } from './button';
import '../../css/freeship.css';

export interface FreeShippingProgressBarProps {
  /** Tiền hàng đang chọn; giỏ có hàng gian hàng tự giao thì chỉ phần Tubu giao (xem `tubuOnly`). */
  base: number;
  threshold: number;
  /** Cờ `freeship` của máy chủ, chỉ truyền khi tin được (cả giỏ đang chọn, không dòng hết hàng). */
  serverReached?: boolean;
  /** Giỏ có hàng gian hàng tự giao: câu nói rõ miễn phí giao chỉ tính cho phần hàng Tubu Tree giao. */
  tubuOnly?: boolean;
  /** Một chạm quay lại chọn thêm món, đặt cạnh dòng chữ khi chưa đạt ngưỡng; đạt rồi thì không có nút. Không truyền thì khối giữ nguyên như cũ. */
  onShopMore?: () => void;
}

/**
 * Thanh tiến độ Miễn phí giao hàng ở đầu Giỏ. Số còn thiếu và phần trăm do `freeshipProgress` (app-core) tính, dùng chung với web. Chưa đạt: một dòng chữ kèm thanh đầy dần
 * (và nút "Mua thêm" nếu có `onShopMore`); đạt rồi: một dòng chúc mừng, không còn thanh, không còn nút. Khối giữ chiều cao tối thiểu của trạng thái chưa đạt nên câu một dòng chuyển trạng thái không làm giỏ nhảy.
 */
export function FreeShippingProgressBar({ base, threshold, serverReached, tubuOnly = false, onShopMore }: FreeShippingProgressBarProps) {
  const progress = freeshipProgress({ base, threshold, serverReached });
  const text = progress.reached
    ? fillCopy(tubuOnly ? 'freeship.reachedTubu' : 'freeship.reached')
    : fillCopy(tubuOnly ? 'freeship.progressTubu' : 'freeship.progress', { price: formatVnd(progress.remaining) });
  const showCta = !progress.reached && !!onShopMore;
  const label = (
    <p role="status" className="tubu-freeship-text">
      {text}
    </p>
  );
  return (
    <div data-testid="freeship-progress" data-reached={progress.reached ? 'true' : 'false'} data-cta={onShopMore ? 'true' : undefined} className="tubu-freeship">
      {onShopMore ? (
        <div className="tubu-freeship-head">
          {label}
          {showCta && (
            <Button
              variant="secondary"
              className="tubu-freeship-cta"
              data-testid="freeship-shop-more-cta"
              aria-label={fillCopy(tubuOnly ? 'freeship.shopMoreAriaTubu' : 'freeship.shopMoreAria', { price: formatVnd(progress.remaining) })}
              onPress={onShopMore}
            >
              {fillCopy('freeship.shopMoreCta')}
            </Button>
          )}
        </div>
      ) : (
        label
      )}
      {!progress.reached && (
        <div
          role="progressbar"
          data-testid="freeship-bar"
          aria-label={fillCopy('freeship.barAria', { pct: progress.pct })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.pct}
          className="tubu-freeship-track"
        >
          <div data-testid="freeship-fill" className="tubu-freeship-fill" style={{ width: `${progress.pct}%` }} />
        </div>
      )}
    </div>
  );
}
