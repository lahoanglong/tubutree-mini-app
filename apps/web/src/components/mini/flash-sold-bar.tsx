'use client';

// Nguồn: apps/miniapp/src/components/ui/flash-sold-bar.tsx
import { flashSoldText } from '@tubutree/app-core/commerce/flash-sold';
import { useEffect, useState } from 'react';

export interface FlashSoldBarProps {
  /** Phần trăm suất đã bán, 0–100; số rác coi như chưa bán. */
  soldPct: number;
  soldOut?: boolean;
}

/**
 * Thanh % đã bán của Giờ vàng (polish PL-08). Cam trên rãnh chỉ đạt 1,85:1 nên thanh chỉ để trang trí (`aria-hidden`);
 * chữ luôn hiện và mang thông tin ("Vừa mở bán", "Đã bán 68%", "Sắp hết", "Đã bán hết"), a11y B3. Chữ đè lên thanh dùng stone-900
 * (đạt trên cả cam lẫn rãnh). Phần đã bán dựng bằng scaleX để chạy một lần lúc vào màn mà không đo lại bố cục.
 */
export function FlashSoldBar({ soldPct, soldOut = false }: FlashSoldBarProps) {
  const ratio = Number.isFinite(soldPct) ? Math.min(1, Math.max(0, soldPct / 100)) : 0;
  // Vẽ 0 ở lần đầu rồi mới lên đúng mức để transition chạy lúc khối hiện ra.
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(true), []);
  return (
    <div data-testid="flash-sold-bar" data-state={soldOut ? 'soldout' : undefined} style={{ position: 'relative', height: 16 }}>
      <div
        data-testid="flash-sold-track"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 'var(--radius-pill)', background: soldOut ? 'var(--color-track)' : 'var(--color-flash-bg)' }}
      >
        {!soldOut && (
          <div
            data-testid="flash-sold-fill"
            style={{
              width: '100%',
              height: '100%',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--color-flash-solid-bg)',
              transformOrigin: 'left',
              transform: `scaleX(${shown ? ratio : 0})`,
              transitionProperty: 'transform',
              transitionDuration: '600ms',
              transitionTimingFunction: 'var(--p-ease-out)',
            }}
          />
        )}
      </div>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 8px',
          fontSize: 'var(--type-label-size)',
          fontWeight: 600,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          color: soldOut ? 'var(--color-text-secondary)' : 'var(--color-flash-solid-fg)',
        }}
      >
        {flashSoldText(soldPct, soldOut)}
      </span>
    </div>
  );
}
