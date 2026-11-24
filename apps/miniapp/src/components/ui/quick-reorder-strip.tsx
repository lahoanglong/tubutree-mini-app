import { QUICK_REORDER_CARD_HEIGHT } from '@tubutree/app-core/home-layout';
import { quickReorderAddAllAria, type QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import { fillBootCopy } from '@tubutree/app-core/shop-copy-boot';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { formatVnd } from '../../utils/format';
import { Badge } from './badge';
import { Button } from './button';
import { PriceTag } from './price-tag';
import { ProductThumb } from './product-thumb';
import { ScrollRow } from './scroll-row';
import { SectionHeader } from './section-header';
import '../../css/quick-reorder.css';

/** Nhãn dài (ô đã đổi sang túi Refill) được xuống dòng trong khung ảnh thay vì bị cắt. */
const WRAP = { whiteSpace: 'normal', display: 'inline-block' } as const;

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
  /** Chạm "Báo khi có" của ô hết hàng (`soldOut`): đăng ký, hay huỷ khi đang chờ. Không truyền thì ô hết hàng chỉ ghi "Tạm hết hàng". */
  onNotify?: (item: QuickReorderItem) => void;
  /** variationId của ô hết hàng đang chờ máy chủ trả lời lệnh báo hàng về. */
  notifyBusyKey?: string | null;
}

/**
 * Dải "Mua lại món quen" ở Trang chủ: hàng thẻ ngang, mỗi thẻ có "+ Thêm" một chạm, tiêu đề có "Thêm lại tất cả". Thẻ cao đúng
 * `QUICK_REORDER_CARD_HEIGHT` (khung chờ của Trang chủ đọc cùng số, nên dải thật thế chỗ khung chờ mà không làm trang nhảy).
 * Giá gạch chỉ do `PriceTag` vẽ. Chọn món (tối đa 8, tối thiểu 2 món còn hàng) là việc của `buildQuickReorderItems` ở app-core; rỗng thì không vẽ gì.
 * Ô hết hàng (cờ báo hàng về bật) đứng cuối dải: nhãn "Tạm hết hàng" trên ảnh và nút "Báo khi có" ở chỗ "+ Thêm" (công tắc `aria-pressed`, đang chờ thì
 * "Đang chờ hàng"); không vào "Thêm lại tất cả" và không bị khoá theo lệnh giỏ đang bay.
 */
export function QuickReorderStrip({
  items,
  busyKey = null,
  busyAll = false,
  onAdd,
  onAddAll,
  onOpen,
  onNotify,
  notifyBusyKey = null,
}: QuickReorderStripProps) {
  if (items.length === 0) return null;
  const title = fillBootCopy('quickReorder.title');
  // Một lệnh bay mỗi lúc: nút khác khoá hẳn thay vì xếp hàng, vì lệnh sau có thể thành "đã có trong giỏ" ngoài ý khách.
  const locked = busyAll || busyKey !== null;
  return (
    <section data-testid="quick-reorder" aria-label={title} aria-busy={locked || undefined}>
      <div className="tubu-quick-head">
        <SectionHeader
          title={title}
          action={{
            label: fillBootCopy('quickReorder.addAll'),
            spoken: quickReorderAddAllAria(items, formatVnd),
            disabled: locked,
            busy: busyAll,
            onPress: () => {
              if (!locked) onAddAll();
            },
          }}
        />
      </div>
      <ScrollRow label={title} className="tubu-quick-row">
        <div className="tubu-quick-track">
          {items.map((item) => {
            const busy = busyKey === item.variationId;
            const badge = item.soldOut
              ? fillCopy('stock.out')
              : (item.badge ??
                (item.savePct > 0
                  ? `-${item.savePct}%`
                  : item.timesBought > 1
                    ? fillBootCopy('quickReorder.timesBought', { n: item.timesBought })
                    : null));
            return (
              <div key={item.key} className="tubu-quick-cell">
                <div
                  data-testid="quick-reorder-card"
                  data-variation-id={item.variationId}
                  className="tubu-quick-card"
                  style={{ height: QUICK_REORDER_CARD_HEIGHT }}
                >
                  <button
                    type="button"
                    className="tubu-press tubu-hit-44 tubu-quick-open"
                    onClick={() => onOpen(item)}
                  >
                    <span className="tubu-quick-thumb">
                      <ProductThumb src={item.thumbnail} alt="" size={108} />
                      {badge && (
                        <span className="tubu-quick-badge">
                          <Badge tone={item.soldOut ? 'neutral' : item.savePct > 0 ? 'promo' : 'brand'} size="sm" style={item.badge ? WRAP : undefined}>
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
                  {item.soldOut ? (
                    <Button
                      variant={item.restockWaiting ? 'ghost' : 'secondary'}
                      className="tubu-quick-add"
                      data-testid="quick-reorder-notify"
                      data-variation-id={item.variationId}
                      aria-label={fillCopy('wishlist.restock.bell', { name: item.name })}
                      aria-pressed={item.restockWaiting === true}
                      loading={notifyBusyKey === item.variationId}
                      disabled={!onNotify}
                      onPress={() => onNotify?.(item)}
                    >
                      {fillCopy(!onNotify ? 'stock.out' : item.restockWaiting ? 'quickReorder.notifyOn' : 'quickReorder.notify')}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      className="tubu-quick-add"
                      data-testid="quick-reorder-add"
                      data-variation-id={item.variationId}
                      aria-label={
                        item.addAria ??
                        fillBootCopy('quickReorder.addAria', {
                          name: item.name,
                          price: formatVnd(item.price),
                        })
                      }
                      loading={busy}
                      disabled={locked && !busy}
                      onPress={() => onAdd(item)}
                    >
                      {item.addLabel ?? fillBootCopy('quickReorder.add')}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollRow>
    </section>
  );
}
