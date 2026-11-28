import { useId } from 'react';
import { cartGoalPick, computeCartThresholdProgress, type CartThresholdMilestone } from '@tubutree/app-core/commerce/cart-progress';
import type { CartVoucherUnlock } from '@tubutree/app-core/commerce/cart-voucher-hint';
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
  /**
   * Mốc quà dùng thử (`cartGiftThreshold`, tubu-w13-01): có thì thanh hai mốc (vạch Miễn phí giao hàng giữa thanh, Quà dùng thử ở cuối, nhãn
   * hai mốc dưới thanh) và thanh còn hiện sau khi đã Miễn phí giao hàng, tới khi đủ mốc quà. Thiếu thì một mốc như cũ.
   */
  giftThreshold?: number | null;
  /**
   * Mã sắp mở khoá (`cartVoucherHint().unlock`, w47-01): giỏ chỉ có MỘT thanh mốc. Mốc nào gần hơn (`cartGoalPick`) thì thanh nói mốc đó, cùng một nút
   * "Mua thêm"; thanh Miễn phí giao hàng/Quà đã đạt hết mà còn mã sắp mở khoá thì thanh nói mã.
   */
  voucher?: CartVoucherUnlock | null;
}

function Milestone({ m }: { m: CartThresholdMilestone }) {
  return (
    <li data-testid="freeship-milestone" data-kind={m.kind} data-reached={m.reached ? 'true' : 'false'} className="tubu-freeship-milestone">
      {m.label}
    </li>
  );
}

/**
 * Thanh tiến độ ở đầu Giỏ. Số còn thiếu, phần trăm và các mốc do `computeCartThresholdProgress` (app-core) tính, dùng chung với web. Chưa đạt: một dòng chữ kèm
 * thanh đầy dần (và nút "Mua thêm" nếu có `onShopMore`). Có mốc quà: thanh đo tới mốc quà, vạch giữa thanh là mốc Miễn phí giao hàng, dưới thanh hai nhãn
 * "199.000đ Miễn phí giao hàng" và "299.000đ Quà dùng thử" (mốc đã đạt có dấu ✓). Đạt hết: một dòng chúc mừng, không còn thanh, không còn nút; khối co về
 * dòng gọn cao 36px (freeship.css), không giữ chiều cao của trạng thái chưa đạt.
 */
export function FreeShippingProgressBar({ base, threshold, serverReached, tubuOnly = false, onShopMore, giftThreshold, voucher }: FreeShippingProgressBarProps) {
  const p = computeCartThresholdProgress(base, { freeshipThreshold: threshold, giftThreshold, serverFreeship: serverReached, tubuOnly });
  const voucherTextId = useId();
  if (voucher && cartGoalPick(p, voucher) === 'voucher') {
    return (
      <div data-testid="freeship-progress" data-goal="voucher" data-reached="false" data-cta={onShopMore ? 'true' : undefined} className="tubu-freeship">
        <div className={onShopMore ? 'tubu-freeship-head' : undefined}>
          <p id={voucherTextId} role="status" aria-live="polite" aria-atomic="true" data-testid="cart-voucher-unlock" className="tubu-freeship-text">
            {voucher.text}
          </p>
          {onShopMore && (
            <Button variant="secondary" className="tubu-freeship-cta" data-testid="freeship-shop-more-cta" aria-describedby={voucherTextId} onPress={onShopMore}>
              {fillCopy('freeship.shopMoreCta')}
            </Button>
          )}
        </div>
        <div
          role="progressbar"
          data-testid="cart-voucher-unlock-bar"
          aria-label={voucher.barAria}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={voucher.pct}
          className="tubu-freeship-track"
        >
          <div className="tubu-freeship-fill" style={{ width: `${voucher.pct}%` }} />
        </div>
      </div>
    );
  }
  const showCta = !p.freeship.reached && !!onShopMore;
  const label = (
    <p role="status" aria-live="polite" aria-atomic="true" className="tubu-freeship-text">
      {p.headline}
    </p>
  );
  const track = (
    <div
      role="progressbar"
      data-testid="freeship-bar"
      aria-label={p.barAria}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p.pct}
      className="tubu-freeship-track"
    >
      <div data-testid="freeship-fill" className="tubu-freeship-fill" style={{ width: `${p.pct}%` }} />
    </div>
  );
  return (
    <div
      data-testid="freeship-progress"
      data-goal="progress"
      data-reached={p.freeship.reached ? 'true' : 'false'}
      data-gift={p.gift ? (p.gift.reached ? 'reached' : 'locked') : undefined}
      data-cta={onShopMore ? 'true' : undefined}
      className="tubu-freeship"
    >
      {onShopMore ? (
        <div className="tubu-freeship-head">
          {label}
          {showCta && (
            <Button
              variant="secondary"
              className="tubu-freeship-cta"
              data-testid="freeship-shop-more-cta"
              aria-label={fillCopy(tubuOnly ? 'freeship.shopMoreAriaTubu' : 'freeship.shopMoreAria', { price: formatVnd(p.freeship.remaining) })}
              onPress={onShopMore}
            >
              {fillCopy('freeship.shopMoreCta')}
            </Button>
          )}
        </div>
      ) : (
        label
      )}
      {!p.done &&
        (p.gift ? (
          <div className="tubu-freeship-meter">
            <div className="tubu-freeship-rail">
              {track}
              <span aria-hidden="true" data-testid="freeship-mark" className="tubu-freeship-mark" style={{ left: `${p.freeship.at}%` }} />
            </div>
            <ul data-testid="freeship-milestones" className="tubu-freeship-legend">
              <Milestone m={p.freeship} />
              <Milestone m={p.gift} />
            </ul>
          </div>
        ) : (
          track
        ))}
    </div>
  );
}
