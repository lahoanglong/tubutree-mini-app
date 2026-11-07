import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '../../utils/format';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductThumb } from './product-thumb';
import { ScrollRow } from './scroll-row';
import { SectionTitle } from './section-title';
import '../../css/freeship.css';

export interface FreeshipAddonItem {
  slug: string;
  name: string;
  thumbnail: string | null;
  price: number;
  compareAt?: number | null;
  variationId: string;
}

export interface FreeshipAddonRailProps {
  items: readonly FreeshipAddonItem[];
  /** Món đang được thêm: nút của thẻ này khoá và báo bận, các thẻ khác vẫn bấm được. */
  busySlug?: string | null;
  onAdd: (item: FreeshipAddonItem) => void;
}

/**
 * Dải gợi ý món bù đơn dưới thanh Miễn phí giao hàng: thẻ rộng cố định, một chạm "+ Thêm" đưa món vào giỏ (một cái đúng phân loại đại diện của thẻ).
 * Giá gạch chỉ do `PriceTag` vẽ. Không có món thì không vẽ gì; chọn món (ít nhất 3) là việc của `pickFreeshipAddons` ở app-core.
 */
export function FreeshipAddonRail({ items, busySlug = null, onAdd }: FreeshipAddonRailProps) {
  if (items.length === 0) return null;
  const title = fillCopy('freeship.addonsTitle');
  return (
    <section data-testid="freeship-addons" className="tubu-addon">
      <div className="tubu-addon-title">
        <SectionTitle>{title}</SectionTitle>
      </div>
      <ScrollRow label={title} className="tubu-addon-row">
        <div className="tubu-addon-track">
          {items.map((item) => {
            const busy = busySlug === item.slug;
            return (
              <div key={item.slug} data-testid="freeship-addon" data-slug={item.slug} className="tubu-addon-card">
                <ProductThumb src={item.thumbnail} alt="" size={72} />
                <span className="tubu-addon-name">{item.name}</span>
                <span className="tubu-addon-price">
                  <PriceTag value={item.price} compareAt={item.compareAt} size="sm" layout="stack" tone={item.compareAt && item.compareAt > item.price ? 'deal' : 'default'} />
                </span>
                <Button
                  variant="secondary"
                  className="tubu-addon-add"
                  data-testid="freeship-add"
                  aria-label={fillCopy('freeship.addAria', { name: item.name, price: formatVnd(item.price) })}
                  aria-busy={busy}
                  disabled={busy}
                  onPress={() => onAdd(item)}
                >
                  {fillCopy('freeship.add')}
                </Button>
              </div>
            );
          })}
        </div>
      </ScrollRow>
    </section>
  );
}
