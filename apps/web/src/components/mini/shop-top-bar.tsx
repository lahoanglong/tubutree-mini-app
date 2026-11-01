'use client';

// Nguồn: apps/miniapp/src/components/ui/shop-top-bar.tsx
import { useEffect, useState } from 'react';
import { SHOP_COVER_HEIGHT } from './shop-header';

export interface ShopTopBarProps {
  title: string;
  /** Cuộn quá mức này (px) thì hiện tên shop; mặc định khi bìa đã trôi hết dưới thanh. */
  threshold?: number;
}

/**
 * Tên shop trên thanh đầu khi khách cuộn qua bìa. Nền đặc và nút lùi là của `BackButton` (zIndex 39 và 40); thanh này chỉ thêm chữ ở
 * giữa, chừa chỗ cho nút lùi và không bắt chạm. Chỉ có ở khổ điện thoại (từ md trở lên không có `BackButton`, trang tự có thanh
 * đầu của web); `display` nằm ở class chứ không ở style vì style nội tuyến sẽ thắng `md:hidden`. Web cuộn ở `window`, khác Mini App cuộn ở `.zaui-page`.
 */
export function ShopTopBar({ title, threshold = SHOP_COVER_HEIGHT - 56 }: ShopTopBarProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return (
    <div
      data-testid="shop-top-bar"
      className="flex md:hidden"
      aria-hidden={!shown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 'calc(var(--safe-top) + 56px)', zIndex: 40,
        alignItems: 'flex-end', justifyContent: 'center', padding: '0 64px',
        opacity: shown ? 1 : 0, transition: 'opacity 150ms', pointerEvents: 'none',
      }}
    >
      <span style={{ display: 'block', width: '100%', textAlign: 'center', paddingBottom: 15, fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)', lineHeight: '26px', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {title}
      </span>
    </div>
  );
}
