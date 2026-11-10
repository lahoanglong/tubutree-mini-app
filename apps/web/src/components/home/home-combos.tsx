'use client';

// Nguồn: apps/miniapp/src/components/home/home-combos.tsx
import type { ComboView } from '@tubutree/app-core/commerce/bundle-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useRouter } from 'next/navigation';
import { ComboCard, RailShell, SectionHeader } from '@/components/mini';
import { bundleKeys } from '@tubutree/app-core/queries/bundle';
import { useBundleAdd } from '@/lib/use-bundle-add';

/** Bề rộng một thẻ combo trong kệ: chừa lề phải để thấy một góc thẻ kế tiếp (gợi ý vuốt), không vượt 288px ở màn rộng. */
const CELL_WIDTH = 'min(288px, calc(100vw - 56px))';

export interface HomeCombosProps {
  /** Đã qua `composeHomeShelves` (≥2 combo, ≤4); dưới mức tối thiểu thì rỗng và khối ẩn hẳn, không giữ chỗ. */
  views: readonly ComboView[];
}

/**
 * Combo tiết kiệm (khối `combos` của Trang chủ, sau Bán chạy nhất): mỗi thẻ một combo toàn sàn, "Thêm cả combo" vào giỏ ngay tại Trang chủ.
 * Rỗng thì không dựng gì (cũng không gọi hook giỏ/định tuyến): phần lớn lượt xem chưa có combo nào.
 */
export function HomeCombos({ views }: HomeCombosProps) {
  return views.length === 0 ? null : <HomeCombosRail views={views} />;
}

function HomeCombosRail({ views }: HomeCombosProps) {
  const { add, busyId, result } = useBundleAdd([bundleKeys.homeCombos]);
  const router = useRouter();
  const title = fillCopy('combo.homeTitle');
  return (
    <section aria-label={title} data-testid="home-combos">
      <SectionHeader title={title} />
      <RailShell label={`${title}, vuốt ngang để xem thêm`}>
        {views.map((v) => {
          // Ưu tiên món còn hàng: combo "tạm hết" vẫn dẫn được tới một món mua được, không thành ngõ cụt.
          const target = v.items.find((it) => it.stock !== 'out') ?? v.items[0];
          return (
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
                  onSeeItems={target?.slug ? () => router.push(`/san-pham/${encodeURIComponent(target.slug)}`) : undefined}
                />
              </div>
            </div>
          );
        })}
      </RailShell>
      <div role="status" className={result ? 'mt-1 text-sm' : 'sr-only'}>
        {result && <p className={result.ok ? 'text-success-fg' : 'text-danger-fg'}>{result.text}</p>}
      </div>
    </section>
  );
}
