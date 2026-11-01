import { ChevronRight } from 'lucide-react';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { haptic } from '../../utils/haptic';
import { ProductThumb } from '../ui/product-thumb';

export interface ShopCategoriesTabProps {
  collections: { id: string; title: string; items: { product: { thumbnail: string | null } }[] }[];
  /** Mở tab Sản phẩm đã lọc theo bộ này. */
  onOpen: (collectionId: string) => void;
}

const THUMBS = 4;
const THUMB = 48;

/** Tab "Danh mục": mỗi bộ sưu tập một dòng, dải tối đa 4 ảnh, tên, số món. Mọi bộ có mặt ở đây, kể cả bộ thứ 7 trở đi không lên tab Shop. */
export function ShopCategoriesTab({ collections, onOpen }: ShopCategoriesTabProps) {
  if (collections.length === 0) return null;
  return (
    <ul role="list" style={{ listStyle: 'none', margin: 0, padding: '4px 16px 0' }}>
      {collections.map((c) => {
        const count = fillCopy('shop.categoryCount', { n: c.items.length });
        return (
          <li key={c.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
            <button
              type="button"
              className="tubu-press"
              aria-label={`${c.title}, ${count}`}
              onClick={() => {
                haptic('light');
                onOpen(c.id);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 72, padding: '12px 0', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'inherit' }}
            >
              <span aria-hidden="true" style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
                {c.items.slice(0, THUMBS).map((it, i) => (
                  <ProductThumb key={i} src={it.product.thumbnail} alt="" size={THUMB} />
                ))}
              </span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 'var(--type-body-md-size)', lineHeight: 'var(--type-body-md-lh)', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                <span style={{ display: 'block', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-tertiary)' }}>{count}</span>
              </span>
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" color="var(--color-text-tertiary)" style={{ flex: '0 0 auto' }} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
