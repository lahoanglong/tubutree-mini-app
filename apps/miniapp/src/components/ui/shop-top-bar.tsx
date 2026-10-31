import { useEffect, useState } from 'react';
import { SHOP_COVER_HEIGHT } from './shop-header';

export interface ShopTopBarProps {
  title: string;
  /** Cuộn quá mức này (px) thì hiện tên shop; mặc định khi bìa đã trôi hết dưới thanh. */
  threshold?: number;
}

/**
 * Tên shop trên thanh đầu khi khách cuộn qua bìa (critique-store ST-04): mất ngữ cảnh "đang ở shop nào" là lỗi cũ. Nút lùi và nền đặc
 * của thanh là của `BackButton` (cùng vùng cố định); thanh này chỉ thêm chữ ở giữa, chừa 56px trái cho nút lùi và 96px phải cho viên
 * thuốc của Zalo, và không bắt chạm.
 */
export function ShopTopBar({ title, threshold = SHOP_COVER_HEIGHT - 56 }: ShopTopBarProps) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Cuộn xảy ra ở .zaui-page chứ không ở window; sự kiện scroll không nổi bọt nên bắt ở pha capture. Hàng ngang, sheet cũng phát scroll:
    // chỉ vùng cuộn của trang quyết định.
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Element) {
        if (t.classList.contains('zaui-page')) setShown(t.scrollTop > threshold);
      } else {
        setShown(window.scrollY > threshold);
      }
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [threshold]);
  return (
    <div
      data-testid="shop-top-bar"
      aria-hidden={!shown}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 'calc(var(--safe-top) + 56px)', zIndex: 199,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 96px 0 64px',
        opacity: shown ? 1 : 0, transition: 'opacity 150ms', pointerEvents: 'none',
      }}
    >
      <span style={{ display: 'block', width: '100%', textAlign: 'center', paddingBottom: 15, fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)', lineHeight: '26px', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {title}
      </span>
    </div>
  );
}
