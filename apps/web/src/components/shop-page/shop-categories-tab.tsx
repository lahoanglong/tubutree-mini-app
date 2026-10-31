'use client';

// Nguồn: apps/miniapp/src/components/shop-page/shop-categories-tab.tsx
import { ChevronRight } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ProductThumb } from '@/components/mini/product-thumb';

export interface ShopCategoriesTabProps {
  collections: { id: string; title: string; items: { product: { thumbnail?: string | null } }[] }[];
  /** Mở tab Sản phẩm đã lọc theo bộ này. */
  onOpen: (collectionId: string) => void;
}

const THUMBS = 4;

/** Tab "Danh mục": mỗi bộ sưu tập một dòng, dải tối đa 4 ảnh, tên, số món. Mọi bộ có mặt ở đây, kể cả bộ thứ 7 trở đi không lên tab Shop. */
export function ShopCategoriesTab({ collections, onOpen }: ShopCategoriesTabProps) {
  if (collections.length === 0) return null;
  return (
    <ul role="list" className="m-0 list-none px-4 pt-1 md:px-0 lg:grid lg:grid-cols-2 lg:gap-x-6">
      {collections.map((c) => {
        const count = fillCopy('shop.categoryCount', { n: c.items.length });
        return (
          <li key={c.id} className="border-b border-stone-200">
            <button
              type="button"
              aria-label={`${c.title}, ${count}`}
              onClick={() => onOpen(c.id)}
              className="tubu-press flex min-h-[72px] w-full items-center gap-3 py-3 text-left"
            >
              <span aria-hidden="true" className="flex flex-none gap-1">
                {c.items.slice(0, THUMBS).map((it, i) => (
                  <ProductThumb key={i} src={it.product.thumbnail} alt="" size={48} />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--type-body-md-size)] font-semibold text-[color:var(--color-text-primary)]">{c.title}</span>
                <span className="block text-[length:var(--type-caption-size)] text-[color:var(--color-text-tertiary)]">{count}</span>
              </span>
              <ChevronRight className="h-4 w-4 flex-none text-[color:var(--color-text-tertiary)]" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
