// Nguồn: apps/miniapp/src/components/ui/shop-stats-row.tsx
import type { ShopStat } from '@tubutree/app-core/commerce/shop-stats';

/**
 * Hàng số liệu dưới đầu shop (critique-store ST-02): 1 đến 4 ô chia đều, số đậm và nhãn nhỏ ngăn bằng vạch mảnh. Mỗi ô đọc cả câu
 * (`spoken`: "4,6 sao"), vì nhãn nhìn thấy ("Đánh giá") và số rời nhau không đủ nghĩa. Rỗng thì không vẽ.
 */
export function ShopStatsRow({ stats }: { stats: ShopStat[] }) {
  if (stats.length === 0) return null;
  return (
    <div style={{ display: 'flex', margin: '12px 16px 0', borderTop: '1px solid var(--color-border-subtle)', borderBottom: '1px solid var(--color-border-subtle)' }}>
      {stats.map((s, i) => (
        <div
          key={s.label}
          data-testid="shop-stat"
          role="group"
          aria-label={s.spoken}
          style={{
            flex: '1 1 0', minWidth: 0, minHeight: 48, padding: '6px 4px', textAlign: 'center',
            borderLeft: i === 0 ? 'none' : '1px solid var(--color-border-subtle)',
          }}
        >
          <span aria-hidden="true" style={{ display: 'block', fontFamily: 'var(--font-ui)', fontSize: 'var(--type-body-md-size)', lineHeight: 'var(--type-body-md-lh)', fontWeight: 700, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.value}
          </span>
          <span aria-hidden="true" style={{ display: 'block', fontSize: 'var(--type-caption-size)', lineHeight: 'var(--type-caption-lh)', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.label}
          </span>
        </div>
      ))}
    </div>
  );
}
