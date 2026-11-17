import type { CSSProperties, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { fetchProductCompare, type CompareItem } from '@tubutree/app-core/api/product-compare';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { coreHttp } from '../../services/core-http';
import { formatVnd } from '../../utils/format';
import { haptic } from '../../utils/haptic';
import { Button } from '../ui/button';
import { PriceTag } from '../ui/price-tag';
import { SectionTitle } from '../ui/section-title';
import { Text } from '../ui/text';

const STALE_MS = 10 * 60_000;
const MISSING = '—';

// Bảng cố định cột và chữ được ngắt ở bất kỳ đâu: tên dài hay giá bảy chữ số ở 360px xuống dòng trong ô, không đẩy trang tràn ngang.
const TABLE: CSSProperties = { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', marginTop: 'var(--space-stack-sm)' };
const CELL: CSSProperties = {
  padding: 'var(--space-stack-xs) var(--space-inline-xs)',
  verticalAlign: 'top',
  textAlign: 'left',
  overflowWrap: 'anywhere',
  borderTop: '1px solid var(--color-border-subtle)',
};
const ROW_HEAD: CSSProperties = { ...CELL, fontWeight: 'inherit' };
const COL_HEAD: CSSProperties = { ...CELL, borderTop: 'none' };
const CLAMP_3: CSSProperties = { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

function Row({ label, cells }: { label: string; cells: ReactNode[] }) {
  return (
    <tr>
      <th scope="row" style={ROW_HEAD}>
        <Text variant="caption" tone="tertiary">
          {label}
        </Text>
      </th>
      {cells.map((c, i) => (
        <td key={i} style={CELL}>
          {c}
        </td>
      ))}
    </tr>
  );
}

const value = (text: string | null | undefined) => (
  <Text variant="caption" numeric>
    {text || MISSING}
  </Text>
);

/**
 * "So với món tương tự": món đang xem và tối đa 2 món cùng phân khúc (`GET /products/:slug/compare`). Lỗi nào (gồm 404 khi cờ
 * `catalog.pdp_compare_enabled` tắt) hay không có món để so thì không vẽ gì: bảng là thông tin thêm, không đáng một thông báo lỗi.
 */
export function PdpCompare({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ['product-compare', slug],
    queryFn: () => fetchProductCompare(coreHttp, slug),
    retry: false,
    staleTime: STALE_MS,
  });
  if (!data?.current || !Array.isArray(data.others) || data.others.length === 0) return null;

  const cols: CompareItem[] = [data.current, ...data.others.slice(0, 2)];
  const per = data.current.unitPrice?.per ?? null;
  const showSize = cols.some((c) => !!c.size);
  const showIngredients = cols.some((c) => (c.keyIngredients ?? []).length > 0);
  const title = fillCopy('pdp.compareTitle');

  return (
    <section
      data-pdp-block="compare"
      aria-label={title}
      style={{ marginTop: 'var(--space-stack-sm)', padding: 'var(--space-inset-page)', background: 'var(--color-bg-surface)' }}
    >
      <SectionTitle block>{title}</SectionTitle>
      <table style={TABLE}>
        <colgroup>
          <col style={{ width: '22%' }} />
          {cols.map((c) => (
            <col key={c.productId} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td style={COL_HEAD} />
            {cols.map((c, i) => (
              <th key={c.productId} scope="col" style={COL_HEAD}>
                <Text variant="label" tone={i === 0 ? 'brand' : 'primary'} as="span" style={CLAMP_3}>
                  {i === 0 ? fillCopy('pdp.compareThis') : c.name}
                </Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label={fillCopy('pdp.comparePrice')} cells={cols.map((c) => <PriceTag key={c.productId} value={c.price} size="sm" />)} />
          {per && (
            <Row
              label={fillCopy(per === '100ml' ? 'pdp.compareUnit100ml' : 'pdp.compareUnit100g')}
              cells={cols.map((c) => value(c.unitPrice && c.unitPrice.per === per ? formatVnd(c.unitPrice.value) : null))}
            />
          )}
          {showSize && <Row label={fillCopy('pdp.compareSize')} cells={cols.map((c) => value(c.size))} />}
          {showIngredients && <Row label={fillCopy('pdp.compareIngredients')} cells={cols.map((c) => value((c.keyIngredients ?? []).join(', ')))} />}
          <tr>
            <td style={CELL} />
            {cols.map((c, i) => (
              <td key={c.productId} style={CELL}>
                {i > 0 && (
                  <Button
                    variant="ghost"
                    fullWidth
                    aria-label={fillCopy('pdp.compareViewSpoken', { name: c.name })}
                    onPress={() => {
                      haptic('light');
                      navigate(`/product/${c.slug}`);
                    }}
                    style={{ minWidth: 0 }}
                  >
                    {fillCopy('pdp.compareView')}
                  </Button>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
