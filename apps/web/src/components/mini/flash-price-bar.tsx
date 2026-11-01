'use client';

// Nguồn: apps/miniapp/src/components/product/flash-price-bar.tsx
import { Zap } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Badge } from './badge';
import { Countdown } from './countdown';
import { FlashSoldBar } from './flash-sold-bar';
import { PriceTag } from './price-tag';

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
  /** Lớp Tailwind cho gốc (bo góc, khoảng cách với ảnh ở máy tính). Chỉ có ở web: Mini không dùng. */
  className?: string;
  /** Lớp cho dòng giá, để trang ẩn dòng này ở máy tính khi giá deal đã nằm ở cột thông tin. Chỉ có ở web. */
  priceRowClassName?: string;
}

/**
 * Thanh Giờ vàng dưới ảnh PDP: giá deal (cam đậm, không đỏ), -x%, "Kết thúc sau …" theo phút (Q3: HH:MM:SS chỉ ở đầu khối Trang chủ),
 * thanh đã bán có chữ. Nền cam rất nhạt để chữ cam đậm đạt tương phản; giá nowrap, hàng đồng hồ co dòng thay vì tràn khổ 375.
 */
export function FlashPriceBar({ price, compareAt, pct, endAt, soldPct, soldOut = false, perUserLimit, onEnd, className, priceRowClassName }: FlashPriceBarProps) {
  return (
    <div data-testid="flash-price-bar" className={className} style={{ background: 'var(--color-flash-bg)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone="flash" size="sm" icon={Zap}>
          {fillCopy('flash.title')}
        </Badge>
        <Countdown endAt={endAt} mode="text" onEnd={onEnd} />
      </div>
      {/* Khối bọc riêng mang lớp ẩn: dòng flex bên trong đặt display inline nên lớp `hidden` trên chính nó không thắng. */}
      <div data-testid="flash-price-row" className={priceRowClassName}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <PriceTag value={price} compareAt={compareAt} size="xl" tone="deal" />
          {pct > 0 && (
            <Badge tone="promo" size="sm">
              -{pct}%
            </Badge>
          )}
        </div>
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
