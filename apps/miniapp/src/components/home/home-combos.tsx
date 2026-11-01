import type { ComboView } from '@tubutree/app-core/commerce/bundle-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ComboCard } from '../ui/combo-card';
import { RailShell } from '../ui/product-rail';
import { SectionHeader } from '../ui/section-header';
import { useBundleAdd } from '../product/use-bundle-add';

/** Bề rộng một thẻ combo trong kệ: chừa lề phải để thấy một góc thẻ kế tiếp (gợi ý vuốt), không vượt 288px ở màn rộng. */
const CELL_WIDTH = 'min(288px, calc(100vw - 56px))';

export interface HomeCombosProps {
  /** Đã qua `composeHomeShelves` (≥2 combo, ≤4); dưới mức tối thiểu thì rỗng và khối ẩn hẳn, không giữ chỗ. */
  views: readonly ComboView[];
}

/** Combo tiết kiệm (khối `combos` của Trang chủ, sau Bán chạy nhất): mỗi thẻ một combo toàn sàn, "Thêm cả combo" vào giỏ ngay tại Trang chủ. */
export function HomeCombos({ views }: HomeCombosProps) {
  const { add, busyId } = useBundleAdd();
  if (views.length === 0) return null;
  const title = fillCopy('combo.homeTitle');
  return (
    <section aria-label={title} data-testid="home-combos">
      <div style={{ padding: '0 16px' }}>
        <SectionHeader title={title} />
      </div>
      <RailShell label={`${title}, vuốt ngang để xem thêm`}>
        {views.map((v) => (
          <div key={v.id} style={{ flex: '0 0 auto', width: CELL_WIDTH, display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ComboCard
                title={v.title}
                items={v.items}
                pct={v.pct}
                total={v.total}
                comboTotal={v.comboTotal}
                busy={busyId === v.id}
                onAddAll={() => add({ id: v.id, lines: v.lines, errorKey: 'shop.comboError', successText: fillCopy('shop.comboAdded') })}
              />
            </div>
          </div>
        ))}
      </RailShell>
    </section>
  );
}
