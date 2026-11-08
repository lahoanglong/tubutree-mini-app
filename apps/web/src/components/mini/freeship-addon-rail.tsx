'use client';

// Nguồn: apps/miniapp/src/components/ui/freeship-addon-rail.tsx (cùng props, cùng test-id).
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '@/lib/format-vnd';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductThumb } from './product-thumb';
import { ScrollRow } from './scroll-row';
import { SectionTitle } from './section-title';

export interface FreeshipAddonItem {
  slug: string;
  name: string;
  thumbnail: string | null;
  /** Giá khách trả (đúng số thẻ đang hiện). */
  price: number;
  /** Giá gạch của thẻ; chỉ `PriceTag` vẽ. */
  compareAt?: number | null;
  /** Phân loại sẽ vào giỏ khi bấm "+ Thêm". */
  variationId: string;
}

export interface FreeshipAddonRailProps {
  items: readonly FreeshipAddonItem[];
  /** Món đang được thêm: nút khoá và báo bận để bấm liên tiếp không tạo hai lệnh. */
  busySlug?: string | null;
  onAdd: (item: FreeshipAddonItem) => void;
}

/**
 * Gợi ý món bù đơn dưới thanh Miễn phí giao hàng: hàng cuộn ngang các thẻ rộng cố định (ảnh, tên hai dòng, giá, "+ Thêm"), thêm một sản phẩm chỉ một chạm.
 * Rỗng thì không vẽ gì (nơi dùng đã lọc: dưới 3 món hợp lệ thì để rỗng).
 */
export function FreeshipAddonRail({ items, busySlug = null, onAdd }: FreeshipAddonRailProps) {
  if (items.length === 0) return null;
  const title = fillCopy('freeship.addonsTitle');
  return (
    <section data-testid="freeship-addons" aria-label={title} aria-busy={busySlug !== null || undefined} className="tubu-addon">
      <div className="tubu-addon-head">
        <SectionTitle block>{title}</SectionTitle>
      </div>
      <ScrollRow label={title} arrows className="tubu-addon-row">
        {items.map((it) => {
          const busy = busySlug === it.slug;
          const deal = typeof it.compareAt === 'number' && it.compareAt > it.price;
          return (
            <div key={it.slug} data-testid="freeship-addon" data-slug={it.slug} className="tubu-addon-card">
              <ProductThumb src={it.thumbnail} alt="" size={64} />
              <div className="tubu-addon-body">
                <span className="tubu-addon-name">{it.name}</span>
                <div className="tubu-addon-foot">
                  <PriceTag value={it.price} compareAt={it.compareAt} tone={deal ? 'deal' : 'default'} size="sm" layout="stack" />
                  <Button
                    variant="secondary"
                    className="tubu-addon-add"
                    data-testid="freeship-add"
                    loading={busy}
                    aria-label={fillCopy('freeship.addAria', { name: it.name, price: formatVnd(it.price) })}
                    onPress={() => onAdd(it)}
                  >
                    {fillCopy('freeship.add')}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </ScrollRow>
    </section>
  );
}
