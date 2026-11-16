'use client';

import { createContext, type MouseEvent } from 'react';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';

/** Đường thêm giỏ nhanh mà Trang chủ cấp cho mọi thẻ sản phẩm bên dưới nó; `null` (mặc định) thì thẻ không có nút ＋. */
export interface ProductCardQuickAdd {
  /** `origin` là phần tử để vẽ hiệu ứng bay vào giỏ (nút vừa chạm). */
  add: (product: ProductCard, origin: Element | null) => void;
  /** Sản phẩm đang được thêm: nút của đúng thẻ đó báo bận. */
  busyId: string | null;
}

export const ProductCardQuickAddContext = createContext<ProductCardQuickAdd | null>(null);

export interface QuickAddButtonProps {
  /** Tên sản phẩm, để tên truy cập nói rõ nút thêm món nào. */
  name: string;
  busy: boolean;
  onPress: (origin: Element) => void;
}

/**
 * Nút ＋ nổi ở góc dưới ảnh thẻ (cùng kiểu nút giỏ nhanh ở trang Yêu thích): vùng chạm 44px trong suốt bọc vòng trắng 32px. Dấu cộng là MỘT thẻ svg
 * để mỗi thẻ trên Trang chủ chỉ thêm một nút vào DOM. Bận thì báo `aria-disabled` chứ không `disabled`, kẻo rớt focus giữa lúc đang thêm.
 */
export function QuickAddButton({ name, busy, onPress }: QuickAddButtonProps) {
  return (
    <button
      type="button"
      aria-label={fillCopy('card.quickAdd', { name })}
      aria-busy={busy}
      aria-disabled={busy || undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        if (!busy) onPress(e.currentTarget);
      }}
      className="inline-flex h-11 w-11 items-center justify-center text-stone-700"
    >
      <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-stone-0 shadow-e1 ${busy ? 'opacity-60' : ''}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </span>
    </button>
  );
}
