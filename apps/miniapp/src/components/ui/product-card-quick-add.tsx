import { createContext, type MouseEvent } from 'react';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';

/**
 * Nơi cắm nút ＋ thêm nhanh trên thẻ sản phẩm: thẻ không có phân loại nên việc tải chi tiết, hỏi bảng chọn và ghi giỏ do nơi cung cấp context lo (Trang chủ:
 * `HomeQuickAddProvider`). Không có context thì thẻ không vẽ nút. `busyId` là sản phẩm đang được thêm.
 */
export interface ProductCardQuickAdd {
  add: (product: ProductCardData, origin: Element | null) => void;
  busyId: string | null;
}

export const ProductCardQuickAddContext = createContext<ProductCardQuickAdd | null>(null);

export interface QuickAddButtonProps {
  name: string;
  busy: boolean;
  onPress: (origin: Element) => void;
}

/**
 * Vòng ＋ 32px (`--space-stack-xl`) mà vùng chạm giãn ra 44×44 bằng `tubu-hit-44-square`, cùng cỡ với tim ở góc đối diện của ảnh thẻ (ProductTile đặt vị trí).
 * Một nút + một svg: mỗi thẻ trên Trang chủ chỉ thêm ba nút vào DOM.
 */
export function QuickAddButton({ name, busy, onPress }: QuickAddButtonProps) {
  return (
    <button
      type="button"
      className="tubu-hit-44-square"
      aria-label={fillCopy('card.quickAdd', { name })}
      aria-busy={busy}
      aria-disabled={busy || undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        onPress(e.currentTarget);
      }}
      style={{
        width: 'var(--space-stack-xl)',
        height: 'var(--space-stack-xl)',
        margin: 'var(--space-stack-xs)',
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        background: 'var(--color-bg-surface)',
        boxShadow: 'var(--elevation-1)',
        color: 'var(--color-text-secondary)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}
