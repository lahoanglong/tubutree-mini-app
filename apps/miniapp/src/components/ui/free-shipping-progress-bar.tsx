import { freeshipProgress } from '@tubutree/app-core/commerce/freeship-progress';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '../../utils/format';
import '../../css/freeship.css';

export interface FreeShippingProgressBarProps {
  /** Tiền hàng đang chọn; giỏ có hàng gian hàng tự giao thì chỉ phần Tubu giao (xem `tubuOnly`). */
  base: number;
  threshold: number;
  /** Cờ `freeship` của máy chủ, chỉ truyền khi tin được (cả giỏ đang chọn, không dòng hết hàng). */
  serverReached?: boolean;
  /** Giỏ có hàng gian hàng tự giao: câu nói rõ miễn phí giao chỉ tính cho phần hàng Tubu Tree giao. */
  tubuOnly?: boolean;
}

/**
 * Thanh tiến độ Miễn phí giao hàng ở đầu Giỏ. Số còn thiếu và phần trăm do `freeshipProgress` (app-core) tính, dùng chung với web. Chưa đạt: một dòng chữ kèm thanh đầy dần;
 * đạt rồi: một dòng chúc mừng, không còn thanh. Khối giữ chiều cao tối thiểu của trạng thái chưa đạt nên chuyển trạng thái không làm giỏ nhảy.
 */
export function FreeShippingProgressBar({ base, threshold, serverReached, tubuOnly = false }: FreeShippingProgressBarProps) {
  const progress = freeshipProgress({ base, threshold, serverReached });
  const text = progress.reached
    ? fillCopy(tubuOnly ? 'freeship.reachedTubu' : 'freeship.reached')
    : fillCopy(tubuOnly ? 'freeship.progressTubu' : 'freeship.progress', { price: formatVnd(progress.remaining) });
  return (
    <div data-testid="freeship-progress" data-reached={progress.reached ? 'true' : 'false'} className="tubu-freeship">
      <p role="status" className="tubu-freeship-text">
        {text}
      </p>
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
