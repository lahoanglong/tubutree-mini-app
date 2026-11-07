'use client';

// Nguồn: apps/miniapp/src/components/ui/quick-reorder-strip.tsx (cùng props, cùng test-id, cùng lớp tubu-quick-*).
import { QUICK_REORDER_CARD_HEIGHT } from '@tubutree/app-core/home-layout';
import { quickReorderTotal, type QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '@/lib/format-vnd';
import { Badge } from './badge';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductThumb } from './product-thumb';
import { ScrollRow } from './scroll-row';
import { SectionHeader } from './section-header';

export interface QuickReorderStripProps {
  items: readonly QuickReorderItem[];
  /** variationId của món đang thêm một chạm: nút thẻ đó khoá và báo bận, các nút khác khoá để không bay hai lệnh cùng lúc. */
  busyKey?: string | null;
  /** Đang thêm lại tất cả. */
  busyAll?: boolean;
  onAdd: (item: QuickReorderItem) => void;
  onAddAll: () => void;
  /** Chạm thân thẻ: mở chi tiết món ở đúng phân loại đã mua. */
  onOpen: (item: QuickReorderItem) => void;
}

/**
 * Dải "Mua lại món quen" ở Trang chủ: hàng thẻ ngang, mỗi thẻ có "+ Thêm" một chạm, tiêu đề có "Thêm lại tất cả". Thẻ cao đúng
 * `QUICK_REORDER_CARD_HEIGHT` (khung chờ của Trang chủ đọc cùng số, nên dải thật thế chỗ khung chờ mà không làm trang nhảy).
 * Giá gạch chỉ do `PriceTag` vẽ. Chọn món (tối đa 6, tối thiểu 2) là việc của `buildQuickReorderItems` ở app-core; rỗng thì không vẽ gì.
 */
export function QuickReorderStrip({ items, busyKey = null, busyAll = false, onAdd, onAddAll, onOpen }: QuickReorderStripProps) {
  if (items.length === 0) return null;
  const title = fillCopy('quickReorder.title');
  // Một lệnh bay mỗi lúc: nút khác khoá hẳn thay vì xếp hàng, vì lệnh sau có thể thành "đã có trong giỏ" ngoài ý khách.
  const locked = busyAll || busyKey !== null;
  const addAllSpoken = fillCopy('quickReorder.addAllAria', { n: items.length, total: formatVnd(quickReorderTotal(items)) });
  return (
    <section data-testid="quick-reorder" aria-label={title} aria-busy={busyAll || undefined}>
      <div className="tubu-quick-head">
        <SectionHeader
          title={title}
          action={{
            label: fillCopy('quickReorder.addAll'),
            spoken: addAllSpoken,
            onPress: () => {
              if (!locked) onAddAll();
            },
          }}
        />
      </div>
      <ScrollRow label={title} arrows className="tubu-bleed-rail tubu-quick-row">
        <div className="tubu-quick-track">
          {items.map((item) => {
            const busy = busyKey === item.variationId;
            const badge = item.savePct > 0 ? `-${item.savePct}%` : item.timesBought > 1 ? fillCopy('quickReorder.timesBought', { n: item.timesBought }) : null;
            return (
              <div key={item.key} className="tubu-quick-cell">
                <div data-testid="quick-reorder-card" data-variation-id={item.variationId} className="tubu-quick-card" style={{ height: QUICK_REORDER_CARD_HEIGHT }}>
                  <button type="button" className="tubu-press tubu-quick-open min-h-11 min-w-11" onClick={() => onOpen(item)}>
                    <span className="tubu-quick-thumb">
                      <ProductThumb src={item.thumbnail} alt="" size={108} />
                      {badge && (
                        <span className="tubu-quick-badge">
                          <Badge tone={item.savePct > 0 ? 'promo' : 'brand'} size="sm">
                            {badge}
                          </Badge>
                        </span>
                      )}
                    </span>
                    <span className="tubu-quick-name">{item.name}</span>
                    <span className="tubu-quick-price">
                      <PriceTag
                        value={item.price}
                        compareAt={item.compareAt}
                        size="sm"
                        layout="stack"
                        tone={item.compareAt && item.compareAt > item.price ? 'deal' : 'default'}
                      />
                    </span>
                  </button>
                  <Button
                    variant="secondary"
                    className="tubu-quick-add"
                    data-testid="quick-reorder-add"
                    data-variation-id={item.variationId}
                    aria-label={fillCopy('quickReorder.addAria', { name: item.name, price: formatVnd(item.price) })}
                    loading={busy}
                    disabled={locked && !busy}
                    onPress={() => onAdd(item)}
                  >
                    {fillCopy('quickReorder.add')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollRow>
    </section>
  );
}
