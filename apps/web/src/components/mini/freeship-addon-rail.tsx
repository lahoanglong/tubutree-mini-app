'use client';

// Nguồn: apps/miniapp/src/components/ui/freeship-addon-rail.tsx (cùng props, cùng test-id).
import { AOV_ADDON_MAX } from '@tubutree/app-core/cart/aov-upsell';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '@/lib/format-vnd';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductThumb } from './product-thumb';
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
  /** Tiêu đề dải; không truyền thì "Gợi ý mua thêm cho đủ Miễn phí giao hàng". Giỏ truyền `aovUpsellGoal().headline` (mốc quà có số còn thiếu, số đều `tabular-nums`). */
  title?: string;
  /** Mốc dải đang nhắm (`AovStage`): ghi ra `data-stage` để kiểm và đo, không đổi cách vẽ. */
  stage?: 'freeship' | 'gift';
  /** Món đang được thêm: nút khoá và báo bận để bấm liên tiếp không tạo hai lệnh. Web cho nhiều món bay cùng lúc nên nhận cả danh sách. */
  busySlug?: string | readonly string[] | null;
  onAdd: (item: FreeshipAddonItem) => void;
}

/**
 * Gợi ý món bù đơn dưới thanh tiến độ của Giỏ (tubu-w13-01): tối đa 2 thẻ gọn, không cuộn ngang. Điện thoại: xếp dọc như Mini App (ảnh 48,
 * tên hai dòng và giá, nút "+ Thêm" 44px); từ md: hai thẻ cạnh nhau. Thêm một sản phẩm chỉ một chạm. Rỗng thì không vẽ gì (chọn món là việc
 * của `pickAovAddons`; dải chỉ cắt thêm ở `AOV_ADDON_MAX` cho chắc).
 */
export function FreeshipAddonRail({ items, title: titleProp, stage, busySlug = null, onAdd }: FreeshipAddonRailProps) {
  if (items.length === 0) return null;
  const title = titleProp ?? fillCopy('freeship.addonsTitle');
  const busySlugs = typeof busySlug === 'string' ? [busySlug] : (busySlug ?? []);
  return (
    <section data-testid="freeship-addons" data-stage={stage} aria-label={title} aria-busy={busySlugs.length > 0 || undefined} className="tubu-addon">
      <div className="tubu-addon-head">
        <SectionTitle block>{title}</SectionTitle>
      </div>
      <ul className="tubu-addon-list">
        {items.slice(0, AOV_ADDON_MAX).map((it) => {
          const busy = busySlugs.includes(it.slug);
          const deal = typeof it.compareAt === 'number' && it.compareAt > it.price;
          return (
            <li key={it.slug} data-testid="freeship-addon" data-slug={it.slug} className="tubu-addon-card">
              <ProductThumb src={it.thumbnail} alt="" size={48} />
              <div className="tubu-addon-body">
                <span className="tubu-addon-name">{it.name}</span>
                <span className="tubu-addon-price">
                  <PriceTag value={it.price} compareAt={it.compareAt} tone={deal ? 'deal' : 'default'} size="sm" />
                </span>
              </div>
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
