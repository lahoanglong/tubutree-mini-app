import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AOV_ADDON_MAX } from '@tubutree/app-core/cart/aov-upsell';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '../../utils/format';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductThumb } from './product-thumb';
import { SectionTitle } from './section-title';
import '../../css/freeship.css';
import '../../css/declutter.css';

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
  /** Tiêu đề dải; không truyền thì "Gợi ý mua thêm cho đủ Miễn phí giao hàng". Giỏ truyền `aovUpsellGoal().headline` (mốc quà có số còn thiếu, số đều `tabular-nums`). */
  title?: string;
  /** Mốc dải đang nhắm (`AovStage`): ghi ra `data-stage` để kiểm và đo, không đổi cách vẽ. */
  stage?: 'freeship' | 'gift';
  /** Món đang được thêm: nút của thẻ này khoá và báo bận, các thẻ khác vẫn bấm được. */
  busySlug?: string | null;
  onAdd: (item: FreeshipAddonItem) => void;
  /**
   * Giỏ (w47-01): dải gập sẵn sau một dòng "Gợi ý thêm để được Miễn phí giao hàng ▾" (mốc quà thì dòng là tiêu đề có số còn thiếu); chạm mới mở thẻ.
   * Không truyền thì dải mở sẵn có tiêu đề như cũ.
   */
  collapsible?: boolean;
}

/**
 * Gợi ý món bù đơn dưới thanh tiến độ của Giỏ (tubu-w13-01): tối đa 2 thẻ gọn xếp dọc, không cuộn ngang. Mỗi thẻ một hàng: ảnh 48, tên hai dòng
 * và giá, nút "+ Thêm" 44px đưa món vào giỏ một chạm (đúng phân loại đại diện của thẻ). Giá gạch chỉ do `PriceTag` vẽ. Không có món thì không
 * vẽ gì; chọn món là việc của `pickAovAddons` (Giỏ) ở app-core, dải chỉ cắt thêm ở `AOV_ADDON_MAX` cho chắc.
 */
export function FreeshipAddonRail({ items, title: titleProp, stage, busySlug = null, onAdd, collapsible = false }: FreeshipAddonRailProps) {
  const [open, setOpen] = useState(!collapsible);
  const listId = useId();
  if (items.length === 0) return null;
  const title = titleProp ?? fillCopy('freeship.addonsTitle');
  const toggleLabel = stage === 'gift' ? title : fillCopy('freeship.boosterToggle');
  return (
    <section data-testid="freeship-addons" data-stage={stage} aria-label={title} aria-busy={busySlug !== null || undefined} className="tubu-addon">
      {collapsible ? (
        // Mẫu accordion: tiêu đề bọc nút, trình đọc màn hình vẫn nhảy theo tiêu đề tới dải.
        <h3 className="tubu-addon-heading">
          <button
            type="button"
            data-testid="freeship-addons-toggle"
            aria-expanded={open}
            aria-controls={listId}
            className="tubu-addon-toggle tubu-press"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="tubu-addon-toggle-text">{toggleLabel}</span>
            <ChevronDown size={16} aria-hidden="true" className="tubu-addon-chevron" />
          </button>
        </h3>
      ) : (
        <div className="tubu-addon-title">
          <SectionTitle>{title}</SectionTitle>
        </div>
      )}
      <ul id={listId} hidden={!open} className="tubu-addon-list">
        {items.slice(0, AOV_ADDON_MAX).map((item) => {
          const busy = busySlug === item.slug;
          return (
            <li key={item.slug} data-testid="freeship-addon" data-slug={item.slug} className="tubu-addon-card">
              <ProductThumb src={item.thumbnail} alt="" size={48} />
              <div className="tubu-addon-body">
                <span className="tubu-addon-name">{item.name}</span>
                <span className="tubu-addon-price">
                  <PriceTag value={item.price} compareAt={item.compareAt} size="sm" tone={item.compareAt && item.compareAt > item.price ? 'deal' : 'default'} />
                </span>
              </div>
              <Button
                variant="secondary"
                className="tubu-addon-add"
                data-testid="freeship-add"
                aria-label={fillCopy('freeship.addAria', { name: item.name, price: formatVnd(item.price) })}
                loading={busy}
                onPress={() => onAdd(item)}
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
