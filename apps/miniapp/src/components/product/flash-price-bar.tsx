import { Zap } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from '../ui/badge';
import { Countdown } from '../ui/countdown';
import { FlashSoldBar } from '../ui/flash-sold-bar';
import { PriceTag } from '../ui/price-tag';

export interface FlashPriceBarProps {
  price: number;
  compareAt: number | null;
  pct: number;
  endAt: string;
  soldPct: number;
  soldOut?: boolean;
  /** Giới hạn mua mỗi khách; không có (API cũ) thì không hiện dòng. */
  perUserLimit?: number | null;
  /** Hết giờ khi khách đang xem: trang đổi về giá thường mà không cần tải lại. */
  onEnd?: () => void;
}

/**
 * Thanh Giờ vàng dưới ảnh PDP: giá deal (cam đậm, không đỏ), -x%, "Kết thúc sau …" theo phút (Q3: HH:MM:SS chỉ ở đầu khối Trang chủ),
 * thanh đã bán có chữ. Nền cam rất nhạt để chữ cam đậm đạt tương phản; giá nowrap, hàng đồng hồ co dòng thay vì tràn khổ 375.
 */
export function FlashPriceBar({ price, compareAt, pct, endAt, soldPct, soldOut = false, perUserLimit, onEnd }: FlashPriceBarProps) {
  return (
    <div data-testid="flash-price-bar" style={{ background: 'var(--color-flash-bg)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="flash" size="sm" icon={Zap}>
          {fillCopy('flash.title')}
        </Badge>
        <Countdown endAt={endAt} mode="text" onEnd={onEnd} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
        <PriceTag value={price} compareAt={compareAt} size="xl" tone="deal" />
        {pct > 0 && (
          <Badge tone="promo" size="sm">
            -{pct}%
          </Badge>
        )}
      </div>
      <FlashSoldBar soldPct={soldPct} soldOut={soldOut} track="neutral" />
      {perUserLimit != null && perUserLimit > 0 && (
        <span style={{ fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-secondary)' }}>
          {fillCopy('flash.limit', { n: perUserLimit })}
        </span>
      )}
    </div>
  );
}
